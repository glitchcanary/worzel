/**
 * LVGL 9.x display for SH8601 AMOLED (Waveshare ESP32-S3 1.8").
 * QSPI interface, 368x448, RGB565. Touch via FT3168 (FT5x06-compatible).
 *
 * Manual LVGL init — no esp_lvgl_port. The esp_lvgl_port abstraction
 * silently applies themes, registers conflicting ISR callbacks, and
 * causes rendering corruption on QSPI displays. This file follows
 * the same pattern as lvgl-tests/main.c which renders correctly.
 *
 * Thread-safe: all LVGL calls wrapped in display_lock/display_unlock.
 *
 * Layout: absolute positioning for three zones:
 *   Status bar (y=0, 48px) — datetime left, WiFi/Auth/WS icons right
 *   Conversation (y=48, 300px, scrollable) — single label with auto-scroll
 *   Action bar (y=348, 100px) — Talk | Toggle | More buttons
 */

#include "display.h"
#include "board.h"

#include <string.h>
#include <unistd.h>
#include <time.h>
#include <sys/time.h>
#include <sys/lock.h>
#include <sys/param.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "esp_log.h"
#include "esp_check.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_sh8601.h"
#include "esp_io_expander_tca9554.h"
#include "driver/spi_master.h"

#ifdef BOARD_HAS_LVGL

#include "esp_lcd_touch_ft5x06.h"
#include "lvgl.h"

static const char *TAG = "display";

static esp_lcd_panel_handle_t panel = NULL;
static esp_lcd_panel_io_handle_t panel_io = NULL;

/* DMA completion semaphore — signalled by SPI ISR when transfer finishes */
static SemaphoreHandle_t flush_sem = NULL;

/* LVGL thread safety — replaces lvgl_port_lock/unlock */
static _lock_t lvgl_api_lock;

/* Public lock/unlock for other tasks (display_conversation, display_status) */
static bool display_lock(uint32_t timeout_ms) {
    _lock_acquire(&lvgl_api_lock);
    return true;
    (void)timeout_ms; /* _lock_acquire always blocks */
}

static void display_unlock(void) {
    _lock_release(&lvgl_api_lock);
}

/* LVGL UI elements */
static lv_obj_t *status_bar = NULL;
static lv_obj_t *lbl_time = NULL;
static lv_obj_t *lbl_icon_wifi = NULL;
static lv_obj_t *lbl_icon_auth = NULL;
static lv_obj_t *lbl_icon_ws   = NULL;
static lv_obj_t *convo_container = NULL;
static lv_obj_t *convo_label = NULL;
static char convo_buf[4096] = "";
static lv_obj_t *action_bar = NULL;
static lv_obj_t *btn_talk = NULL;
static lv_obj_t *btn_toggle = NULL;
static lv_obj_t *btn_more = NULL;

/* UI state */
typedef enum { UI_NORMAL, UI_MENU } ui_state_t;
static ui_state_t ui_state = UI_NORMAL;
static volatile bool hot_mic = false;

#define STATUS_BAR_H  48
#define ACTION_BAR_H  100
#define CONVO_H       (LCD_V_RES - STATUS_BAR_H - ACTION_BAR_H)

/* 50 lines = 11.2% of screen — Espressif recommends 10-25% for good perf.
   Each buffer: 368 * 50 * 2 = 36,800 bytes. Two buffers = 73.6KB.
   If internal RAM is too tight (check heap log at boot), reduce to 40. */
#define LVGL_DRAW_BUF_LINES   50
#define LVGL_TICK_PERIOD_MS    2
#define LVGL_TASK_MAX_DELAY_MS 500
#define LVGL_TASK_MIN_DELAY_MS (1000 / CONFIG_FREERTOS_HZ)
#define LVGL_TASK_STACK_SIZE   (12 * 1024)
#define LVGL_TASK_PRIORITY     2

/* ---- Font size cycling ---- */

static const lv_font_t *font_sizes[] = {
#if LV_FONT_MONTSERRAT_28
    &lv_font_montserrat_28,
#endif
#if LV_FONT_MONTSERRAT_30
    &lv_font_montserrat_30,
#endif
#if LV_FONT_MONTSERRAT_32
    &lv_font_montserrat_32,
#endif
#if LV_FONT_MONTSERRAT_34
    &lv_font_montserrat_34,
#endif
#if LV_FONT_MONTSERRAT_36
    &lv_font_montserrat_36,
#endif
};
#define FONT_COUNT (sizeof(font_sizes) / sizeof(font_sizes[0]))
static int font_idx = 0;

/* ---- Color mapping ---- */

static lv_color_t map_color(uint16_t color) {
    /* Colorblind-accessible: brightness + blue/amber hue instead of red/green */
    if (color == COLOR_GREEN)  return lv_color_make(0x80, 0xC8, 0xFF); /* bright blue — OK/connected */
    if (color == COLOR_CYAN)   return lv_color_make(0x80, 0xC8, 0xFF);
    if (color == COLOR_YELLOW) return lv_color_make(0xF0, 0xB0, 0x30); /* amber — in progress */
    if (color == COLOR_RED)    return lv_color_make(0x55, 0x55, 0x55); /* dim grey — error/off */
    if (color == COLOR_WHITE)  return lv_color_make(0xEE, 0xEE, 0xEE);
    if (color == COLOR_GREY)   return lv_color_make(0x99, 0x99, 0x99);
    return lv_color_make(0xDD, 0xDD, 0xDD);
}

/* ---- Button callbacks ---- */

static void btn_talk_cb(lv_event_t *e) {
    (void)e;
    ESP_LOGI(TAG, "Talk button pressed");
}

static void btn_toggle_cb(lv_event_t *e) {
    (void)e;
    hot_mic = !hot_mic;
    ESP_LOGI(TAG, "Hot mic %s", hot_mic ? "ON" : "OFF");
    if (btn_toggle) {
        lv_obj_set_style_bg_color(btn_toggle,
            hot_mic ? lv_color_make(0x80, 0x20, 0x20) : lv_color_make(40, 40, 55), 0);
    }
}

static void font_increase(void) {
    if (FONT_COUNT <= 1) return;
    if (font_idx < (int)FONT_COUNT - 1) font_idx++;
    if (convo_label) {
        lv_obj_set_style_text_font(convo_label, font_sizes[font_idx], 0);
    }
}

static void font_decrease(void) {
    if (FONT_COUNT <= 1) return;
    if (font_idx > 0) font_idx--;
    if (convo_label) {
        lv_obj_set_style_text_font(convo_label, font_sizes[font_idx], 0);
    }
}

static void show_menu(void);
static void hide_menu(void);

static void btn_more_cb(lv_event_t *e) {
    (void)e;
    if (ui_state == UI_NORMAL) show_menu();
    else hide_menu();
}

/* ---- Clock update (LVGL timer callback) ---- */

static void clock_update_cb(lv_timer_t *timer) {
    (void)timer;
    if (!lbl_time) return;
    time_t now;
    time(&now);
    struct tm ti;
    localtime_r(&now, &ti);
    if (ti.tm_year > 100) {
        char buf[20];
        strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M", &ti);
        lv_label_set_text(lbl_time, buf);
    } else {
        lv_label_set_text(lbl_time, "--:--");
    }
}

/* ---- Touch read callback ---- */

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
static void touch_read_cb(lv_indev_t *indev, lv_indev_data_t *data) {
    esp_lcd_touch_handle_t touch = (esp_lcd_touch_handle_t)lv_indev_get_user_data(indev);
    if (!touch) {
        data->state = LV_INDEV_STATE_RELEASED;
        return;
    }

    /* Suppress I2C error log spam — FT5x06 NACKs when idle (no touch).
       The driver logs every NACK at ERROR level. Temporarily mute all
       I2C-related tags during the polling read, then restore. */
    esp_log_level_set("FT5x06", ESP_LOG_NONE);
    esp_log_level_set("i2c.master", ESP_LOG_NONE);
    esp_log_level_set("lcd_panel.io.i2c", ESP_LOG_NONE);

    esp_err_t err = esp_lcd_touch_read_data(touch);

    esp_log_level_set("FT5x06", ESP_LOG_ERROR);
    esp_log_level_set("i2c.master", ESP_LOG_ERROR);
    esp_log_level_set("lcd_panel.io.i2c", ESP_LOG_ERROR);

    if (err != ESP_OK) {
        data->state = LV_INDEV_STATE_RELEASED;
        return;
    }

    uint16_t x[1], y[1], strength[1];
    uint8_t count = 0;
    /* get_coordinates is deprecated in favour of get_data, but get_data's
       esp_lcd_touch_point_data_t isn't defined in this component version */
    if (esp_lcd_touch_get_coordinates(touch, x, y, strength, &count, 1) && count > 0) {
        data->point.x = x[0];
        data->point.y = y[0];
        data->state = LV_INDEV_STATE_PRESSED;
    } else {
        data->state = LV_INDEV_STATE_RELEASED;
    }
}
#pragma GCC diagnostic pop

/* ---- DMA flush with semaphore ----
 *
 * flush_cb starts the DMA transfer, then blocks on flush_sem until the
 * ISR signals completion. This yields the CPU during the transfer (good
 * for watchdog feeding) while still using double buffers. LVGL renders
 * into the next buffer after flush_ready is called. */

static bool IRAM_ATTR flush_done_isr(esp_lcd_panel_io_handle_t io,
                                      esp_lcd_panel_io_event_data_t *edata,
                                      void *user_ctx) {
    BaseType_t woken = pdFALSE;
    xSemaphoreGiveFromISR(flush_sem, &woken);
    return woken;
}

static void lvgl_flush_cb(lv_display_t *disp, const lv_area_t *area, uint8_t *px_map) {
    /* No byte-swap needed — LV_COLOR_FORMAT_RGB565_SWAPPED makes LVGL
       render directly in the SH8601's big-endian byte order. */
    esp_lcd_panel_draw_bitmap(panel,
        area->x1, area->y1, area->x2 + 1, area->y2 + 1, px_map);
    /* Block until DMA completes — yields CPU, feeds watchdog */
    xSemaphoreTake(flush_sem, portMAX_DELAY);
    lv_display_flush_ready(disp);
}

/* ---- LVGL tick callback ---- */

static void lvgl_tick_cb(void *arg) {
    lv_tick_inc(LVGL_TICK_PERIOD_MS);
}

/* ---- LVGL task (runs lv_timer_handler in a loop) ---- */

static void lvgl_task(void *arg) {
    ESP_LOGI(TAG, "LVGL task started");
    uint32_t time_till_next_ms = 0;
    while (1) {
        _lock_acquire(&lvgl_api_lock);
        time_till_next_ms = lv_timer_handler();
        _lock_release(&lvgl_api_lock);
        time_till_next_ms = MAX(time_till_next_ms, LVGL_TASK_MIN_DELAY_MS);
        time_till_next_ms = MIN(time_till_next_ms, LVGL_TASK_MAX_DELAY_MS);
        usleep(1000 * time_till_next_ms);
    }
}

/* ---- SH8601 vendor init commands ---- */

static const sh8601_lcd_init_cmd_t init_cmds[] = {
    {0x11, (uint8_t[]){0x00}, 0, 120},
    {0x44, (uint8_t[]){0x01, 0xD1}, 2, 0},
    {0x35, (uint8_t[]){0x00}, 1, 0},
    {0x53, (uint8_t[]){0x20}, 1, 10},
    {0x2A, (uint8_t[]){0x00, 0x00, 0x01, 0x6F}, 4, 0},
    {0x2B, (uint8_t[]){0x00, 0x00, 0x01, 0xBF}, 4, 0},
    {0x51, (uint8_t[]){0xD0}, 1, 10},
    {0x29, (uint8_t[]){0x00}, 0, 10},
};

/* ---- Build the UI layout ---- */

/*
 * INCREMENTAL UI REBUILD — Step 1: Three-zone layout.
 * Absolute positioning, no flex, no buttons, no scrolling.
 * Tests whether lv_obj_create containers with remove_style_all
 * cause the rendering corruption.
 */

static void build_ui(void) {
    lv_obj_t *scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_all(scr, 0, 0);
    lv_obj_remove_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

    lv_color_t bar_bg = lv_color_make(20, 20, 30);

    /* ---- Status bar (top, fixed) ---- */
    status_bar = lv_obj_create(scr);
    lv_obj_remove_style_all(status_bar);
    lv_obj_set_pos(status_bar, 0, 0);
    lv_obj_set_size(status_bar, LCD_H_RES, STATUS_BAR_H);
    lv_obj_set_style_bg_color(status_bar, bar_bg, 0);
    lv_obj_set_style_bg_opa(status_bar, LV_OPA_COVER, 0);
    lv_obj_remove_flag(status_bar, LV_OBJ_FLAG_SCROLLABLE);

    /* Labels placed with absolute positioning (no flex) */
    lbl_time = lv_label_create(status_bar);
    lv_label_set_text(lbl_time, "--:--");
    lv_obj_set_style_text_color(lbl_time, lv_color_make(0x99, 0x99, 0x99), 0);
    lv_obj_set_style_text_font(lbl_time, &lv_font_montserrat_20, 0);
    lv_obj_set_pos(lbl_time, 8, 12);

    lv_color_t icon_off = lv_color_make(0x55, 0x55, 0x55);

    lbl_icon_wifi = lv_label_create(status_bar);
    lv_label_set_text(lbl_icon_wifi, LV_SYMBOL_WIFI);
    lv_obj_set_style_text_color(lbl_icon_wifi, icon_off, 0);
    lv_obj_set_style_text_font(lbl_icon_wifi, &lv_font_montserrat_28, 0);
    lv_obj_set_pos(lbl_icon_wifi, LCD_H_RES - 120, 8);

    lbl_icon_auth = lv_label_create(status_bar);
    lv_label_set_text(lbl_icon_auth, LV_SYMBOL_EYE_OPEN);
    lv_obj_set_style_text_color(lbl_icon_auth, icon_off, 0);
    lv_obj_set_style_text_font(lbl_icon_auth, &lv_font_montserrat_28, 0);
    lv_obj_set_pos(lbl_icon_auth, LCD_H_RES - 76, 8);

    lbl_icon_ws = lv_label_create(status_bar);
    lv_label_set_text(lbl_icon_ws, LV_SYMBOL_CALL);
    lv_obj_set_style_text_color(lbl_icon_ws, icon_off, 0);
    lv_obj_set_style_text_font(lbl_icon_ws, &lv_font_montserrat_28, 0);
    lv_obj_set_pos(lbl_icon_ws, LCD_H_RES - 36, 8);

    /* ---- Conversation area (middle, NOT scrollable yet) ---- */
    convo_container = lv_obj_create(scr);
    lv_obj_remove_style_all(convo_container);
    lv_obj_set_pos(convo_container, 0, STATUS_BAR_H);
    lv_obj_set_size(convo_container, LCD_H_RES, CONVO_H);
    lv_obj_set_style_bg_color(convo_container, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(convo_container, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_all(convo_container, 8, 0);
    lv_obj_remove_flag(convo_container, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_clip_corner(convo_container, true, 0);

    convo_label = lv_label_create(convo_container);
    lv_label_set_text(convo_label, "Step 1: Three zones\n"
                                    "No flex, no buttons\n"
                                    "No scrolling yet");
    lv_obj_set_width(convo_label, LCD_H_RES - 16);
    lv_label_set_long_mode(convo_label, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_color(convo_label, lv_color_make(0xEE, 0xEE, 0xEE), 0);
    lv_obj_set_style_text_font(convo_label, font_sizes[font_idx], 0);
    lv_obj_set_pos(convo_label, 0, 0);

    /* ---- Action bar (bottom, fixed) — just a label, no buttons ---- */
    action_bar = lv_obj_create(scr);
    lv_obj_remove_style_all(action_bar);
    lv_obj_set_pos(action_bar, 0, LCD_V_RES - ACTION_BAR_H);
    lv_obj_set_size(action_bar, LCD_H_RES, ACTION_BAR_H);
    lv_obj_set_style_bg_color(action_bar, bar_bg, 0);
    lv_obj_set_style_bg_opa(action_bar, LV_OPA_COVER, 0);
    lv_obj_remove_flag(action_bar, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t *lbl_placeholder = lv_label_create(action_bar);
    lv_label_set_text(lbl_placeholder, "Talk    Toggle    More");
    lv_obj_set_style_text_color(lbl_placeholder, lv_color_make(0xEE, 0xEE, 0xEE), 0);
    lv_obj_set_style_text_font(lbl_placeholder, &lv_font_montserrat_28, 0);
    lv_obj_center(lbl_placeholder);

    btn_talk = NULL;
    btn_toggle = NULL;
    btn_more = NULL;
}

#if 0 /* Complex UI — restore after diagnostic */
static void build_ui_complex(void) {
    lv_obj_t *scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_all(scr, 0, 0);
    lv_obj_remove_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

    lv_color_t bar_bg = lv_color_make(20, 20, 30);

    /* ---- Status bar (top, fixed) ---- */
    status_bar = lv_obj_create(scr);
    lv_obj_remove_style_all(status_bar);
    lv_obj_set_pos(status_bar, 0, 0);
    lv_obj_set_size(status_bar, LCD_H_RES, STATUS_BAR_H);
    lv_obj_set_style_bg_color(status_bar, bar_bg, 0);
    lv_obj_set_style_bg_opa(status_bar, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_left(status_bar, 8, 0);
    lv_obj_set_style_pad_right(status_bar, 8, 0);
    lv_obj_remove_flag(status_bar, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_flex_flow(status_bar, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(status_bar, LV_FLEX_ALIGN_SPACE_BETWEEN,
                          LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    lbl_time = lv_label_create(status_bar);
    lv_label_set_text(lbl_time, "--:--");
    lv_obj_set_style_text_color(lbl_time, lv_color_make(0x99, 0x99, 0x99), 0);
    lv_obj_set_style_text_font(lbl_time, &lv_font_montserrat_20, 0);

    lv_color_t icon_off = lv_color_make(0x55, 0x55, 0x55);

    lbl_icon_wifi = lv_label_create(status_bar);
    lv_label_set_text(lbl_icon_wifi, LV_SYMBOL_WIFI);
    lv_obj_set_style_text_color(lbl_icon_wifi, icon_off, 0);
    lv_obj_set_style_text_font(lbl_icon_wifi, &lv_font_montserrat_28, 0);

    lbl_icon_auth = lv_label_create(status_bar);
    lv_label_set_text(lbl_icon_auth, LV_SYMBOL_EYE_OPEN);
    lv_obj_set_style_text_color(lbl_icon_auth, icon_off, 0);
    lv_obj_set_style_text_font(lbl_icon_auth, &lv_font_montserrat_28, 0);
    lv_obj_set_style_pad_left(lbl_icon_auth, 6, 0);

    lbl_icon_ws = lv_label_create(status_bar);
    lv_label_set_text(lbl_icon_ws, LV_SYMBOL_CALL);
    lv_obj_set_style_text_color(lbl_icon_ws, icon_off, 0);
    lv_obj_set_style_text_font(lbl_icon_ws, &lv_font_montserrat_28, 0);
    lv_obj_set_style_pad_left(lbl_icon_ws, 6, 0);

    /* ---- Conversation area (middle, scrollable) ---- */
    convo_container = lv_obj_create(scr);
    lv_obj_remove_style_all(convo_container);
    lv_obj_set_pos(convo_container, 0, STATUS_BAR_H);
    lv_obj_set_size(convo_container, LCD_H_RES, CONVO_H);
    lv_obj_set_style_bg_color(convo_container, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(convo_container, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_all(convo_container, 8, 0);
    lv_obj_set_style_pad_top(convo_container, 4, 0);
    lv_obj_set_scrollbar_mode(convo_container, LV_SCROLLBAR_MODE_OFF);
    lv_obj_add_flag(convo_container, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scroll_dir(convo_container, LV_DIR_VER);

    convo_label = lv_label_create(convo_container);
    lv_label_set_text(convo_label, "");
    lv_obj_set_width(convo_label, LCD_H_RES - 16);
    lv_label_set_long_mode(convo_label, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_color(convo_label, lv_color_make(0xEE, 0xEE, 0xEE), 0);
    lv_obj_set_style_text_font(convo_label, font_sizes[font_idx], 0);

    /* ---- Action bar (bottom, fixed) ---- */
    action_bar = lv_obj_create(scr);
    lv_obj_remove_style_all(action_bar);
    lv_obj_set_pos(action_bar, 0, LCD_V_RES - ACTION_BAR_H);
    lv_obj_set_size(action_bar, LCD_H_RES, ACTION_BAR_H);
    lv_obj_set_style_bg_color(action_bar, bar_bg, 0);
    lv_obj_set_style_bg_opa(action_bar, LV_OPA_COVER, 0);
    lv_obj_remove_flag(action_bar, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_flex_flow(action_bar, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(action_bar, LV_FLEX_ALIGN_SPACE_EVENLY,
                          LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    lv_color_t btn_bg = lv_color_make(40, 40, 55);
    lv_color_t btn_text = lv_color_make(0xEE, 0xEE, 0xEE);
    int btn_w = (LCD_H_RES - 40) / 3;
    int btn_h = ACTION_BAR_H - 16;

    btn_talk = lv_btn_create(action_bar);
    lv_obj_remove_style_all(btn_talk);
    lv_obj_set_size(btn_talk, btn_w, btn_h);
    lv_obj_set_style_bg_color(btn_talk, btn_bg, 0);
    lv_obj_set_style_bg_opa(btn_talk, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(btn_talk, lv_color_make(60, 60, 80), LV_STATE_PRESSED);
    lv_obj_set_style_radius(btn_talk, 8, 0);
    lv_obj_add_event_cb(btn_talk, btn_talk_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t *lbl_talk = lv_label_create(btn_talk);
    lv_label_set_text(lbl_talk, "Talk");
    lv_obj_set_style_text_color(lbl_talk, btn_text, 0);
    lv_obj_set_style_text_font(lbl_talk, &lv_font_montserrat_28, 0);
    lv_obj_center(lbl_talk);

    btn_toggle = lv_btn_create(action_bar);
    lv_obj_remove_style_all(btn_toggle);
    lv_obj_set_size(btn_toggle, btn_w, btn_h);
    lv_obj_set_style_bg_color(btn_toggle, btn_bg, 0);
    lv_obj_set_style_bg_opa(btn_toggle, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(btn_toggle, lv_color_make(60, 60, 80), LV_STATE_PRESSED);
    lv_obj_set_style_radius(btn_toggle, 8, 0);
    lv_obj_add_event_cb(btn_toggle, btn_toggle_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t *lbl_toggle = lv_label_create(btn_toggle);
    lv_label_set_text(lbl_toggle, "Toggle");
    lv_obj_set_style_text_color(lbl_toggle, btn_text, 0);
    lv_obj_set_style_text_font(lbl_toggle, &lv_font_montserrat_28, 0);
    lv_obj_center(lbl_toggle);

    btn_more = lv_btn_create(action_bar);
    lv_obj_remove_style_all(btn_more);
    lv_obj_set_size(btn_more, btn_w, btn_h);
    lv_obj_set_style_bg_color(btn_more, btn_bg, 0);
    lv_obj_set_style_bg_opa(btn_more, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(btn_more, lv_color_make(60, 60, 80), LV_STATE_PRESSED);
    lv_obj_set_style_radius(btn_more, 8, 0);
    lv_obj_add_event_cb(btn_more, btn_more_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t *lbl_more = lv_label_create(btn_more);
    lv_label_set_text(lbl_more, "More");
    lv_obj_set_style_text_color(lbl_more, btn_text, 0);
    lv_obj_set_style_text_font(lbl_more, &lv_font_montserrat_28, 0);
    lv_obj_center(lbl_more);
}
#endif /* Complex UI */

/* ---- More menu ---- */

static lv_obj_t *menu_panel = NULL;

static void menu_item_cb(lv_event_t *e) {
    const char *item = (const char *)lv_event_get_user_data(e);
    if (!item) return;
    if (strcmp(item, "font+") == 0) font_increase();
    else if (strcmp(item, "font-") == 0) font_decrease();
    else if (strcmp(item, "about") == 0) ESP_LOGI(TAG, "About: Worzel voice assistant");
    else if (strncmp(item, "back", 4) == 0) hide_menu();
}

static void show_menu(void) {
    if (!convo_container) return;
    ui_state = UI_MENU;

    lv_obj_add_flag(convo_container, LV_OBJ_FLAG_HIDDEN);

    menu_panel = lv_obj_create(lv_screen_active());
    lv_obj_remove_style_all(menu_panel);
    lv_obj_set_pos(menu_panel, 0, STATUS_BAR_H);
    lv_obj_set_size(menu_panel, LCD_H_RES, CONVO_H);
    lv_obj_set_style_bg_color(menu_panel, lv_color_make(10, 10, 15), 0);
    lv_obj_set_style_bg_opa(menu_panel, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_all(menu_panel, 16, 0);
    lv_obj_remove_flag(menu_panel, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_flex_flow(menu_panel, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(menu_panel, LV_FLEX_ALIGN_START,
                          LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);

    static const char *items[] = {"about", "font+", "font-", "back " LV_SYMBOL_LEFT};
    for (int i = 0; i < 4; i++) {
        lv_obj_t *lbl = lv_label_create(menu_panel);
        lv_label_set_text(lbl, items[i]);
        lv_obj_set_style_text_color(lbl, lv_color_make(0xEE, 0xEE, 0xEE), 0);
        lv_obj_set_style_text_font(lbl, &lv_font_montserrat_28, 0);
        lv_obj_set_style_pad_bottom(lbl, 20, 0);
        lv_obj_add_flag(lbl, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_add_event_cb(lbl, menu_item_cb, LV_EVENT_CLICKED, (void*)(items[i]));
    }

    if (btn_more) {
        lv_obj_t *lbl = lv_obj_get_child(btn_more, 0);
        if (lbl) lv_label_set_text(lbl, "Back");
    }
}

static void hide_menu(void) {
    ui_state = UI_NORMAL;

    if (menu_panel) {
        lv_obj_delete(menu_panel);
        menu_panel = NULL;
    }
    if (convo_container) {
        lv_obj_remove_flag(convo_container, LV_OBJ_FLAG_HIDDEN);
    }
    if (btn_more) {
        lv_obj_t *lbl = lv_obj_get_child(btn_more, 0);
        if (lbl) lv_label_set_text(lbl, "More");
    }
}

/* ---- display_init ---- */

esp_err_t display_init(i2c_master_bus_handle_t i2c_bus) {
    esp_log_level_set("lcd_panel.io.spi", ESP_LOG_NONE);

    /* ---- Display reset via TCA9554 IO expander ---- */
    esp_io_expander_handle_t expander = NULL;
    esp_err_t ret = esp_io_expander_new_i2c_tca9554(i2c_bus, LCD_IO_EXPANDER_ADDR, &expander);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "TCA9554 IO expander init failed: %s", esp_err_to_name(ret));
        return ret;
    }
    esp_io_expander_set_dir(expander,
        IO_EXPANDER_PIN_NUM_0 | IO_EXPANDER_PIN_NUM_1 | IO_EXPANDER_PIN_NUM_2,
        IO_EXPANDER_OUTPUT);
    esp_io_expander_set_level(expander,
        IO_EXPANDER_PIN_NUM_0 | IO_EXPANDER_PIN_NUM_1 | IO_EXPANDER_PIN_NUM_2, 1);
    vTaskDelay(pdMS_TO_TICKS(100));
    esp_io_expander_set_level(expander,
        IO_EXPANDER_PIN_NUM_0 | IO_EXPANDER_PIN_NUM_1 | IO_EXPANDER_PIN_NUM_2, 0);
    vTaskDelay(pdMS_TO_TICKS(300));
    esp_io_expander_set_level(expander,
        IO_EXPANDER_PIN_NUM_0 | IO_EXPANDER_PIN_NUM_1 | IO_EXPANDER_PIN_NUM_2, 1);
    vTaskDelay(pdMS_TO_TICKS(200));

    /* ---- QSPI bus ---- */
    spi_bus_config_t bus_cfg = {
        .sclk_io_num = PIN_LCD_QSPI_CLK,
        .data0_io_num = PIN_LCD_QSPI_D0,
        .data1_io_num = PIN_LCD_QSPI_D1,
        .data2_io_num = PIN_LCD_QSPI_D2,
        .data3_io_num = PIN_LCD_QSPI_D3,
        .max_transfer_sz = LCD_H_RES * LVGL_DRAW_BUF_LINES * sizeof(uint16_t),
        .flags = SPICOMMON_BUSFLAG_QUAD,
    };
    ESP_RETURN_ON_ERROR(spi_bus_initialize(SPI2_HOST, &bus_cfg, SPI_DMA_CH_AUTO),
                        TAG, "QSPI bus init failed");

    /* ---- Panel IO ---- */
    esp_lcd_panel_io_spi_config_t io_cfg = {
        .cs_gpio_num = PIN_LCD_QSPI_CS,
        .dc_gpio_num = -1,
        .spi_mode = 0,
        .pclk_hz = 40 * 1000 * 1000,
        .trans_queue_depth = 10,
        .lcd_cmd_bits = 32,
        .lcd_param_bits = 8,
        .flags = { .quad_mode = true },
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi(SPI2_HOST, &io_cfg, &panel_io),
                        TAG, "Panel IO init failed");

    /* ---- SH8601 panel ---- */
    sh8601_vendor_config_t vendor_cfg = {
        .init_cmds = init_cmds,
        .init_cmds_size = sizeof(init_cmds) / sizeof(init_cmds[0]),
        .flags = { .use_qspi_interface = 1 },
    };
    esp_lcd_panel_dev_config_t panel_cfg = {
        .reset_gpio_num = GPIO_NUM_NC,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
        .vendor_config = &vendor_cfg,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_sh8601(panel_io, &panel_cfg, &panel),
                        TAG, "SH8601 panel init failed");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_reset(panel), TAG, "Panel reset failed");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_init(panel), TAG, "Panel init failed");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_disp_on_off(panel, true), TAG, "Panel on failed");

    ESP_LOGI(TAG, "SH8601 AMOLED ready (%dx%d)", LCD_H_RES, LCD_V_RES);

    /* ---- Manual LVGL init (no esp_lvgl_port) ---- */
    lv_init();

    lv_display_t *display = lv_display_create(LCD_H_RES, LCD_V_RES);

    /* Semaphore for DMA flush synchronization */
    flush_sem = xSemaphoreCreateBinary();

    /* Draw buffers: 50 lines = 11.2% of screen (Espressif recommends 10-25%).
       MUST use PSRAM — internal RAM is too scarce (~80KB free, shared with
       mbedTLS ~50KB, audio tasks, WiFi). ESP32-S3 GDMA can access PSRAM
       (CONFIG_SOC_PSRAM_DMA_CAPABLE). PSRAM is slower than internal but
       the larger buffer (fewer flush cycles) more than compensates. */
    size_t draw_buf_sz = LCD_H_RES * LVGL_DRAW_BUF_LINES * sizeof(lv_color16_t);
    void *buf1 = heap_caps_malloc(draw_buf_sz, MALLOC_CAP_SPIRAM);
    void *buf2 = heap_caps_malloc(draw_buf_sz, MALLOC_CAP_SPIRAM);
    assert(buf1 && buf2);
    ESP_LOGI(TAG, "Draw buffers: %zu bytes x2, %d lines (PSRAM)", draw_buf_sz, LVGL_DRAW_BUF_LINES);
    lv_display_set_buffers(display, buf1, buf2, draw_buf_sz, LV_DISPLAY_RENDER_MODE_PARTIAL);

    /* RGB565_SWAPPED: LVGL renders in big-endian byte order matching the
       SH8601 panel natively — eliminates the per-pixel byte-swap in flush */
    lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565_SWAPPED);
    lv_display_set_flush_cb(display, lvgl_flush_cb);

    /* DMA completion ISR — signals flush_sem so flush_cb can unblock */
    const esp_lcd_panel_io_callbacks_t cbs = {
        .on_color_trans_done = flush_done_isr,
    };
    ESP_ERROR_CHECK(esp_lcd_panel_io_register_event_callbacks(panel_io, &cbs, NULL));

    /* LVGL tick timer */
    const esp_timer_create_args_t tick_args = {
        .callback = &lvgl_tick_cb,
        .name = "lvgl_tick",
    };
    esp_timer_handle_t tick_timer = NULL;
    ESP_ERROR_CHECK(esp_timer_create(&tick_args, &tick_timer));
    ESP_ERROR_CHECK(esp_timer_start_periodic(tick_timer, LVGL_TICK_PERIOD_MS * 1000));

    /* Start LVGL task */
    xTaskCreate(lvgl_task, "LVGL", LVGL_TASK_STACK_SIZE, NULL, LVGL_TASK_PRIORITY, NULL);

    ESP_LOGI(TAG, "LVGL initialized (manual, no esp_lvgl_port)");

    /* ---- Touch init (FT3168 / FT5x06-compatible) ---- */
#ifdef PIN_TOUCH_INT
    esp_lcd_touch_handle_t touch_handle = NULL;
    esp_lcd_panel_io_i2c_config_t touch_io_cfg = ESP_LCD_TOUCH_IO_I2C_FT5x06_CONFIG();
    touch_io_cfg.scl_speed_hz = 400000;
    esp_lcd_panel_io_handle_t touch_io = NULL;

    ret = esp_lcd_new_panel_io_i2c(i2c_bus, &touch_io_cfg, &touch_io);
    if (ret == ESP_OK) {
        esp_lcd_touch_config_t touch_cfg = {
            .x_max = LCD_H_RES,
            .y_max = LCD_V_RES,
            .rst_gpio_num = GPIO_NUM_NC,
            .int_gpio_num = PIN_TOUCH_INT,
            .levels = { .reset = 0, .interrupt = 0 },
            .flags = { .swap_xy = 0, .mirror_x = 0, .mirror_y = 0 },
        };
        ret = esp_lcd_touch_new_i2c_ft5x06(touch_io, &touch_cfg, &touch_handle);
    }

    if (ret == ESP_OK && touch_handle) {
        /* Register touch as LVGL input device */
        lv_indev_t *touch_indev = lv_indev_create();
        lv_indev_set_type(touch_indev, LV_INDEV_TYPE_POINTER);
        lv_indev_set_user_data(touch_indev, touch_handle);
        lv_indev_set_read_cb(touch_indev, touch_read_cb);
        ESP_LOGI(TAG, "Touch controller initialized (FT3168 @ 0x%02X)", TOUCH_I2C_ADDR);
    } else {
        ESP_LOGW(TAG, "Touch init failed (%s) — touch disabled", esp_err_to_name(ret));
    }
#endif

    /* ---- Build UI ---- */
    _lock_acquire(&lvgl_api_lock);
    build_ui();
    lv_timer_create(clock_update_cb, 10000, NULL);
    _lock_release(&lvgl_api_lock);

    ESP_LOGI(TAG, "LVGL UI ready");
    return ESP_OK;
}

/* ---- Public API ---- */

void display_status(int slot, const char *text, uint16_t color) {
    if (!status_bar) return;

    if (display_lock(500)) {
        lv_color_t c = map_color(color);
        switch (slot) {
        case 2:
            if (lbl_icon_wifi) lv_obj_set_style_text_color(lbl_icon_wifi, c, 0);
            break;
        case 3: break;
        case 4:
            if (lbl_icon_auth) lv_obj_set_style_text_color(lbl_icon_auth, c, 0);
            break;
        case 5:
            if (lbl_icon_ws) lv_obj_set_style_text_color(lbl_icon_ws, c, 0);
            break;
        case 6:
            ESP_LOGD(TAG, "status[6]: %s", text ? text : "");
            break;
        default: break;
        }
        display_unlock();
    }
}

void display_conversation(const char *text, uint16_t color) {
    if (!convo_label || !text || !text[0]) return;
    (void)color;

    /* Append new text to buffer */
    size_t cur_len = strlen(convo_buf);
    size_t add_len = strlen(text);
    if (cur_len + add_len + 2 >= sizeof(convo_buf)) {
        size_t half = sizeof(convo_buf) / 2;
        char *nl = strchr(convo_buf + half, '\n');
        if (nl) {
            size_t keep = strlen(nl + 1);
            memmove(convo_buf, nl + 1, keep + 1);
        } else {
            convo_buf[0] = '\0';
        }
        cur_len = strlen(convo_buf);
    }
    if (cur_len > 0) {
        convo_buf[cur_len++] = '\n';
    }
    memcpy(convo_buf + cur_len, text, add_len + 1);

    if (display_lock(500)) {
        lv_label_set_text(convo_label, convo_buf);
        if (convo_container) {
            int32_t label_h = lv_obj_get_height(convo_label);
            int32_t cont_h = lv_obj_get_content_height(convo_container);
            if (label_h > cont_h) {
                lv_obj_scroll_to_y(convo_container, label_h - cont_h, LV_ANIM_OFF);
            }
            lv_obj_invalidate(convo_container);
        } else {
            lv_obj_invalidate(convo_label);
        }
        display_unlock();
    }
}

void display_clear(void) {
    if (!convo_label) return;
    convo_buf[0] = '\0';
    if (display_lock(0)) {
        lv_label_set_text(convo_label, "");
        display_unlock();
    }
}

#elif !defined(BOARD_HAS_DISPLAY)
/* No display at all — stubs */

esp_err_t display_init(i2c_master_bus_handle_t i2c_bus) {
    (void)i2c_bus;
    return ESP_OK;
}

void display_status(int slot, const char *text, uint16_t color) {
    (void)slot; (void)text; (void)color;
}

void display_conversation(const char *text, uint16_t color) {
    (void)text; (void)color;
}

void display_clear(void) {}

#endif
