/**
 * LVGL 9.x display for SH8601 AMOLED (Waveshare ESP32-S3 1.8").
 * QSPI interface, 368x448, RGB565. Touch via FT3168 (FT5x06-compatible).
 *
 * Uses esp_lvgl_port for LVGL lifecycle (tick, task, display bridge, touch).
 * Thread-safe: all LVGL calls wrapped in lvgl_port_lock/unlock.
 *
 * Layout: absolute positioning for three zones (no screen-level flex):
 *   Status bar (y=0, 48px) — datetime left, WiFi/Auth/WS icons right
 *   Conversation (y=48, 300px, scrollable) — single label with auto-scroll
 *   Action bar (y=348, 100px) — Talk | Toggle | More buttons
 *
 * Flex is used INSIDE status_bar (row) and action_bar (row) for their
 * children, but NOT on the screen itself — the LVGL default theme
 * (applied by esp_lvgl_port) interferes with screen-level flex timing.
 */

#include "display.h"
#include "board.h"

#include <string.h>
#include <time.h>
#include <sys/time.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "esp_log.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_sh8601.h"
#include "esp_io_expander_tca9554.h"
#include "driver/spi_master.h"

#ifdef BOARD_HAS_LVGL

#include "esp_lvgl_port.h"
#include "esp_lcd_touch_ft5x06.h"
#include "lvgl.h"

static const char *TAG = "display";

static esp_lcd_panel_handle_t panel = NULL;
static esp_lcd_panel_io_handle_t panel_io = NULL;

/* Semaphore signalled by SPI ISR when DMA transfer completes.
 * The flush callback waits on this before calling flush_ready,
 * ensuring the buffer isn't reused while DMA is still reading it. */
static SemaphoreHandle_t flush_sem = NULL;

/* LVGL UI elements */
static lv_obj_t *status_bar = NULL;
static lv_obj_t *lbl_time = NULL;
static lv_obj_t *lbl_icon_wifi = NULL;
static lv_obj_t *lbl_icon_auth = NULL;
static lv_obj_t *lbl_icon_ws   = NULL;
static lv_obj_t *convo_container = NULL;  /* scrollable container */
static lv_obj_t *convo_label = NULL;      /* single label inside container */
static char convo_buf[4096] = "";         /* accumulated conversation text */
static lv_obj_t *action_bar = NULL;
static lv_obj_t *btn_talk = NULL;
static lv_obj_t *btn_toggle = NULL;
static lv_obj_t *btn_more = NULL;

/* UI state */
typedef enum { UI_NORMAL, UI_MENU } ui_state_t;
static ui_state_t ui_state = UI_NORMAL;
static volatile bool hot_mic = false;

/*
 * Status slot mapping (same slots as bitmap version for API compat):
 *   0-1 = Audio/Opus OK  → ignored (boot-only)
 *   2   = WiFi status    → WiFi icon color
 *   3   = IP address     → ignored (serial log only)
 *   4   = Auth status    → Auth icon color
 *   5   = WebSocket      → WS icon color
 *   6   = Ready/hint     → ignored (action bar has own layout now)
 */

#define STATUS_BAR_H  48
#define ACTION_BAR_H  100

/* ---- Font size cycling (tap action bar to toggle) ---- */

static const lv_font_t *font_sizes[] = {
#if LV_FONT_MONTSERRAT_28
    &lv_font_montserrat_28,     /* 0: one below "bearable" */
#endif
#if LV_FONT_MONTSERRAT_30
    &lv_font_montserrat_30,     /* 1: bearable (default) */
#endif
#if LV_FONT_MONTSERRAT_32
    &lv_font_montserrat_32,     /* 2 */
#endif
#if LV_FONT_MONTSERRAT_34
    &lv_font_montserrat_34,     /* 3 */
#endif
#if LV_FONT_MONTSERRAT_36
    &lv_font_montserrat_36,     /* 4: largest */
#endif
};
#define FONT_COUNT (sizeof(font_sizes) / sizeof(font_sizes[0]))
static int font_idx = 0;  /* start at montserrat_28 (~12-13 chars/line on 368px) */

/* Map our RGB565 color codes to pleasant lv_color_t directly.
 * Bypasses bit-manipulation to avoid byte-swap / theme issues. */
static lv_color_t map_color(uint16_t color) {
    if (color == COLOR_GREEN)  return lv_color_make(0x70, 0xD0, 0x70);  /* soft green */
    if (color == COLOR_CYAN)   return lv_color_make(0x80, 0xC8, 0xFF);  /* soft blue */
    if (color == COLOR_YELLOW) return lv_color_make(0xE0, 0xD0, 0x40);  /* warm yellow */
    if (color == COLOR_RED)    return lv_color_make(0xE0, 0x50, 0x50);  /* soft red */
    if (color == COLOR_WHITE)  return lv_color_make(0xEE, 0xEE, 0xEE);  /* off-white */
    if (color == COLOR_GREY)   return lv_color_make(0x99, 0x99, 0x99);
    return lv_color_make(0xDD, 0xDD, 0xDD);
}

/* Callback: "Talk" button — same as hardware PTT (placeholder, wired in main.c) */
static void btn_talk_cb(lv_event_t *e) {
    (void)e;
    ESP_LOGI(TAG, "Talk button pressed");
    /* TODO: wire to recording start/stop via event group or queue */
}

/* Callback: "Toggle" button — hot mic on/off */
static void btn_toggle_cb(lv_event_t *e) {
    (void)e;
    hot_mic = !hot_mic;
    ESP_LOGI(TAG, "Hot mic %s", hot_mic ? "ON" : "OFF");
    if (btn_toggle) {
        lv_obj_set_style_bg_color(btn_toggle,
            hot_mic ? lv_color_make(0x80, 0x20, 0x20) : lv_color_make(40, 40, 55), 0);
    }
}

/* Font size helpers for More menu */
static void font_increase(void) {
    if (FONT_COUNT <= 1) return;
    if (font_idx < (int)FONT_COUNT - 1) font_idx++;
    ESP_LOGI(TAG, "Font size increased to index %d", font_idx);
    if (convo_label) {
        lv_obj_set_style_text_font(convo_label, font_sizes[font_idx], 0);
    }
}

static void font_decrease(void) {
    if (FONT_COUNT <= 1) return;
    if (font_idx > 0) font_idx--;
    ESP_LOGI(TAG, "Font size decreased to index %d", font_idx);
    if (convo_label) {
        lv_obj_set_style_text_font(convo_label, font_sizes[font_idx], 0);
    }
}

/* Show/hide More menu in conversation area */
static void show_menu(void);
static void hide_menu(void);

static void btn_more_cb(lv_event_t *e) {
    (void)e;
    if (ui_state == UI_NORMAL) {
        show_menu();
    } else {
        hide_menu();
    }
}

/* LVGL timer callback: update clock label every 10s */
static void clock_update_cb(lv_timer_t *timer) {
    (void)timer;
    if (!lbl_time) return;
    time_t now;
    time(&now);
    struct tm ti;
    localtime_r(&now, &ti);
    if (ti.tm_year > 100) {  /* year > 2000 means NTP synced */
        char buf[20];
        strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M", &ti);
        lv_label_set_text(lbl_time, buf);
    } else {
        lv_label_set_text(lbl_time, "--:--");
    }
}

/* SPI DMA completion ISR — signals flush_sem so the flush callback
 * knows the buffer is safe to reuse. Registered AFTER lvgl_port_add_disp
 * to override its default callback (which calls flush_ready directly,
 * creating a race with our byte-swapping flush callback). */
static bool IRAM_ATTR flush_done_isr(esp_lcd_panel_io_handle_t io,
                                      esp_lcd_panel_io_event_data_t *edata,
                                      void *user_ctx) {
    BaseType_t woken = pdFALSE;
    if (flush_sem) {
        xSemaphoreGiveFromISR(flush_sem, &woken);
    }
    return (woken == pdTRUE);
}

/* LVGL flush callback: byte-swap RGB565 for SH8601 big-endian QSPI,
 * then wait for DMA completion before signalling flush_ready.
 *
 * Without the wait, LVGL reuses the buffer while SPI DMA is still
 * reading it — corrupting pixels ("white speckles at top of screen").
 * A 368×20 partial render at 40MHz QSPI takes ~0.4ms per transfer,
 * so the wait adds negligible latency. */
static void safe_flush_cb(lv_display_t *disp, const lv_area_t *area, uint8_t *px_map) {
    /* Swap bytes of each RGB565 pixel for big-endian SH8601 */
    int pixel_count = (area->x2 - area->x1 + 1) * (area->y2 - area->y1 + 1);
    uint16_t *p = (uint16_t *)px_map;
    for (int i = 0; i < pixel_count; i++) {
        p[i] = (p[i] >> 8) | (p[i] << 8);
    }

    esp_err_t ret = esp_lcd_panel_draw_bitmap(panel,
        area->x1, area->y1, area->x2 + 1, area->y2 + 1, px_map);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "Display flush failed (%s), skipping frame", esp_err_to_name(ret));
    } else {
        /* Wait for SPI DMA to complete — buffer is safe to reuse after this.
         * 100ms timeout as safety net; actual transfer takes < 1ms. */
        xSemaphoreTake(flush_sem, pdMS_TO_TICKS(100));
    }

    lv_display_flush_ready(disp);
}

/* SH8601 vendor init commands */
static const sh8601_lcd_init_cmd_t init_cmds[] = {
    {0x11, (uint8_t[]){0x00}, 0, 120},                     /* Sleep out */
    {0x44, (uint8_t[]){0x01, 0xD1}, 2, 0},                 /* Tear scanline */
    {0x35, (uint8_t[]){0x00}, 1, 0},                        /* Tearing effect on */
    {0x53, (uint8_t[]){0x20}, 1, 10},                       /* Write CTRL display */
    {0x2A, (uint8_t[]){0x00, 0x00, 0x01, 0x6F}, 4, 0},     /* Column 0-367 */
    {0x2B, (uint8_t[]){0x00, 0x00, 0x01, 0xBF}, 4, 0},     /* Row 0-447 */
    {0x51, (uint8_t[]){0xD0}, 1, 10},                       /* Brightness ~81% */
    {0x29, (uint8_t[]){0x00}, 0, 10},                       /* Display ON */
};

/* Conversation area height: screen minus status bar minus action bar */
#define CONVO_H  (LCD_V_RES - STATUS_BAR_H - ACTION_BAR_H)  /* 448-48-100 = 300 */

/* Build the LVGL UI layout.
 *
 * Absolute positioning for the three main zones — no flex on the screen.
 * The LVGL default theme (applied by esp_lvgl_port) interferes with flex:
 * it adds card styles, the LVGL task resolves flex_grow asynchronously,
 * and the first render happens before sizes are calculated. Result: text
 * appears tiny/squished in top-left. Absolute positioning is deterministic
 * on the very first frame.
 *
 * Flex ROW is still used INSIDE status_bar and action_bar for their
 * children — that works because the parent has an explicit size. */
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
    lv_obj_set_style_pad_left(status_bar, 8, 0);
    lv_obj_set_style_pad_right(status_bar, 8, 0);
    lv_obj_remove_flag(status_bar, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_flex_flow(status_bar, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(status_bar, LV_FLEX_ALIGN_SPACE_BETWEEN,
                          LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    /* DateTime — left */
    lbl_time = lv_label_create(status_bar);
    lv_label_set_text(lbl_time, "--:--");
    lv_obj_set_style_text_color(lbl_time, lv_color_make(0x99, 0x99, 0x99), 0);
    lv_obj_set_style_text_font(lbl_time, &lv_font_montserrat_20, 0);

    /* Status icons — right */
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

    /* Single label for all conversation text */
    convo_label = lv_label_create(convo_container);
    lv_label_set_text(convo_label, "");
    lv_obj_set_width(convo_label, LCD_H_RES - 16);  /* 8px padding each side */
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

    /* Buttons — remove theme styles to avoid grow animation and
     * partial background fills from the default theme. */
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

/* ---- More menu (shown in conversation area) ---- */

static lv_obj_t *menu_panel = NULL;

static void menu_item_cb(lv_event_t *e) {
    const char *item = (const char *)lv_event_get_user_data(e);
    if (!item) return;

    if (strcmp(item, "font+") == 0) {
        font_increase();
    } else if (strcmp(item, "font-") == 0) {
        font_decrease();
    } else if (strcmp(item, "about") == 0) {
        ESP_LOGI(TAG, "About: Worzel voice assistant");
    } else if (strncmp(item, "back", 4) == 0) {
        hide_menu();
    }
}

static void show_menu(void) {
    if (!convo_container) return;
    ui_state = UI_MENU;

    if (lvgl_port_lock(200)) {
        /* Hide conversation, show menu at the same position */
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
            lv_obj_add_event_cb(lbl, menu_item_cb, LV_EVENT_CLICKED,
                                (void*)(items[i]));
        }

        if (btn_more) {
            lv_obj_t *lbl = lv_obj_get_child(btn_more, 0);
            if (lbl) lv_label_set_text(lbl, "Back");
        }

        lvgl_port_unlock();
    }
}

static void hide_menu(void) {
    ui_state = UI_NORMAL;

    if (lvgl_port_lock(200)) {
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
        lvgl_port_unlock();
    }
}

esp_err_t display_init(i2c_master_bus_handle_t i2c_bus) {
    /* Suppress SPI panel IO error spam — transient errors are handled
     * gracefully by the flush callback and don't need log lines. */
    esp_log_level_set("lcd_panel.io.spi", ESP_LOG_NONE);

    /* ---- SH8601 panel init ---- */

    /* Reset display via TCA9554 IO expander (same I2C bus as ES8311) */
    esp_io_expander_handle_t expander = NULL;
    esp_err_t ret = esp_io_expander_new_i2c_tca9554(i2c_bus, LCD_IO_EXPANDER_ADDR, &expander);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "TCA9554 IO expander init failed: %s", esp_err_to_name(ret));
        return ret;
    }

    /* Pins 0-2 as output for display reset */
    esp_io_expander_set_dir(expander, IO_EXPANDER_PIN_NUM_0 | IO_EXPANDER_PIN_NUM_1 |
                            IO_EXPANDER_PIN_NUM_2, IO_EXPANDER_OUTPUT);
    esp_io_expander_set_level(expander, IO_EXPANDER_PIN_NUM_0 | IO_EXPANDER_PIN_NUM_1 |
                              IO_EXPANDER_PIN_NUM_2, 1);
    vTaskDelay(pdMS_TO_TICKS(100));
    esp_io_expander_set_level(expander, IO_EXPANDER_PIN_NUM_0 | IO_EXPANDER_PIN_NUM_1 |
                              IO_EXPANDER_PIN_NUM_2, 0);
    vTaskDelay(pdMS_TO_TICKS(300));
    esp_io_expander_set_level(expander, IO_EXPANDER_PIN_NUM_0 | IO_EXPANDER_PIN_NUM_1 |
                              IO_EXPANDER_PIN_NUM_2, 1);
    vTaskDelay(pdMS_TO_TICKS(200));

    /* QSPI bus */
    spi_bus_config_t bus_cfg = {
        .sclk_io_num = PIN_LCD_QSPI_CLK,
        .data0_io_num = PIN_LCD_QSPI_D0,
        .data1_io_num = PIN_LCD_QSPI_D1,
        .data2_io_num = PIN_LCD_QSPI_D2,
        .data3_io_num = PIN_LCD_QSPI_D3,
        .max_transfer_sz = LCD_H_RES * 20 * sizeof(uint16_t),
        .flags = SPICOMMON_BUSFLAG_QUAD,
    };
    ESP_RETURN_ON_ERROR(spi_bus_initialize(SPI2_HOST, &bus_cfg, SPI_DMA_CH_AUTO),
                        TAG, "QSPI bus init failed");

    /* Panel IO */
    esp_lcd_panel_io_spi_config_t io_cfg = {
        .cs_gpio_num = PIN_LCD_QSPI_CS,
        .dc_gpio_num = -1,
        .spi_mode = 0,
        .pclk_hz = 40 * 1000 * 1000,
        .trans_queue_depth = 3,
        .lcd_cmd_bits = 32,
        .lcd_param_bits = 8,
        .flags = {
            .quad_mode = true,
        },
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi(SPI2_HOST, &io_cfg, &panel_io),
                        TAG, "Panel IO init failed");

    /* SH8601 panel driver */
    sh8601_vendor_config_t vendor_cfg = {
        .init_cmds = init_cmds,
        .init_cmds_size = sizeof(init_cmds) / sizeof(init_cmds[0]),
        .flags = {
            .use_qspi_interface = 1,
        },
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

    /* ---- LVGL port init ---- */
    const lvgl_port_cfg_t lvgl_cfg = {
        .task_priority = 2,     /* just above IDLE — must not starve WiFi/WS */
        .task_stack = 6144,
        .task_affinity = 0,
        .task_max_sleep_ms = 500,
        .timer_period_ms = 30,  /* 33fps is fine for text UI, saves CPU for audio */
    };
    ESP_RETURN_ON_ERROR(lvgl_port_init(&lvgl_cfg), TAG, "LVGL port init failed");

    /* Buffer in internal DMA RAM (not PSRAM) to avoid SPI flush failures. */
    const lvgl_port_display_cfg_t disp_cfg = {
        .io_handle = panel_io,
        .panel_handle = panel,
        .buffer_size = LCD_H_RES * 20,
        .double_buffer = false,
        .hres = LCD_H_RES,
        .vres = LCD_V_RES,
        .flags = {
            .buff_spiram = false,
            .swap_bytes = false,  /* safe_flush_cb does manual byte-swap */
        },
    };
    lv_display_t *lvgl_disp = lvgl_port_add_disp(&disp_cfg);
    if (!lvgl_disp) {
        ESP_LOGE(TAG, "Failed to add display to LVGL port");
        return ESP_FAIL;
    }
    ESP_LOGI(TAG, "LVGL display registered: %dx%d (expected %dx%d)",
             (int)lv_display_get_horizontal_resolution(lvgl_disp),
             (int)lv_display_get_vertical_resolution(lvgl_disp),
             LCD_H_RES, LCD_V_RES);

    /* Replace the default flush callback with our byte-swapping wrapper.
     * Also register our own SPI ISR callback (overriding lvgl_port's) so
     * we can synchronize: flush waits for DMA completion via semaphore
     * before calling flush_ready, preventing buffer corruption. */
    flush_sem = xSemaphoreCreateBinary();
    assert(flush_sem);
    const esp_lcd_panel_io_callbacks_t flush_cbs = {
        .on_color_trans_done = flush_done_isr,
    };
    esp_lcd_panel_io_register_event_callbacks(panel_io, &flush_cbs, NULL);
    lv_display_set_flush_cb(lvgl_disp, safe_flush_cb);

    /* Remove the default theme entirely — it silently applies card styles,
     * button grow animations, and padding that interfere with our explicit
     * layout. The simulator doesn't have this issue because its lv_conf.h
     * initializes the theme differently. */
    lv_display_set_theme(lvgl_disp, NULL);
    ESP_LOGI(TAG, "LVGL theme disabled");

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
            .levels = {
                .reset = 0,
                .interrupt = 0,
            },
            .flags = {
                .swap_xy = 0,
                .mirror_x = 0,
                .mirror_y = 0,
            },
        };
        ret = esp_lcd_touch_new_i2c_ft5x06(touch_io, &touch_cfg, &touch_handle);
    }

    if (ret == ESP_OK && touch_handle) {
        const lvgl_port_touch_cfg_t lvgl_touch_cfg = {
            .disp = lvgl_disp,
            .handle = touch_handle,
        };
        lv_indev_t *touch_indev = lvgl_port_add_touch(&lvgl_touch_cfg);
        if (touch_indev) {
            ESP_LOGI(TAG, "Touch input registered (FT3168 @ 0x%02X, INT=GPIO%d)",
                     TOUCH_I2C_ADDR, PIN_TOUCH_INT);
        } else {
            ESP_LOGW(TAG, "Touch LVGL registration failed");
        }
    } else {
        ESP_LOGW(TAG, "Touch init failed (%s)", esp_err_to_name(ret));
    }
#endif

    /* ---- Build UI ---- */
    if (lvgl_port_lock(0)) {
        build_ui();
        lv_timer_create(clock_update_cb, 10000, NULL);  /* update clock every 10s */

        lv_obj_invalidate(lv_screen_active());

        /* Log — all sizes are explicit now, should match exactly */
        ESP_LOGI(TAG, "LAYOUT: status[0,%d] convo[%d,%d] action[%d,%d] label_w=%d",
                 STATUS_BAR_H, STATUS_BAR_H, CONVO_H,
                 LCD_V_RES - ACTION_BAR_H, ACTION_BAR_H,
                 LCD_H_RES - 16);

        lvgl_port_unlock();
    }

    ESP_LOGI(TAG, "LVGL UI ready (flex column layout)");

    return ESP_OK;
}

void display_status(int slot, const char *text, uint16_t color) {
    if (!status_bar) return;

    if (lvgl_port_lock(500)) {
        lv_color_t c = map_color(color);
        switch (slot) {
        case 2:
            if (lbl_icon_wifi) lv_obj_set_style_text_color(lbl_icon_wifi, c, 0);
            break;
        case 3:  /* IP — serial log only */
            break;
        case 4:
            if (lbl_icon_auth) lv_obj_set_style_text_color(lbl_icon_auth, c, 0);
            break;
        case 5:
            if (lbl_icon_ws) lv_obj_set_style_text_color(lbl_icon_ws, c, 0);
            break;
        case 6:  /* Ready/hint — action bar has own layout now, log only */
            ESP_LOGD(TAG, "status[6]: %s", text ? text : "");
            break;
        default:
            break;
        }
        lvgl_port_unlock();
    }
}

void display_conversation(const char *text, uint16_t color) {
    if (!convo_label || !convo_container || !text || !text[0]) return;
    (void)color;

    /* Append new text to buffer */
    size_t cur_len = strlen(convo_buf);
    size_t add_len = strlen(text);
    if (cur_len + add_len + 2 >= sizeof(convo_buf)) {
        /* Buffer full — drop oldest half */
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

    if (lvgl_port_lock(500)) {
        lv_label_set_text(convo_label, convo_buf);
        /* Scroll to bottom: use actual content height, NOT LV_COORD_MAX
         * which can cause overflow/wraparound in scroll calculations,
         * rendering the label above the container (the "speckles at top" bug). */
        int32_t label_h = lv_obj_get_height(convo_label);
        int32_t cont_h = lv_obj_get_content_height(convo_container);
        if (label_h > cont_h) {
            lv_obj_scroll_to_y(convo_container, label_h - cont_h, LV_ANIM_OFF);
        }
        lv_obj_invalidate(convo_container);
        lvgl_port_unlock();
    }
}

void display_clear(void) {
    if (!convo_label) return;

    convo_buf[0] = '\0';
    if (lvgl_port_lock(0)) {
        lv_label_set_text(convo_label, "");
        lvgl_port_unlock();
    }
}

#elif !defined(BOARD_HAS_DISPLAY)
/* No display at all — stubs (bitmap version is in display_bitmap.c) */

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
