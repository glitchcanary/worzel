/**
 * LVGL 9.x display for SH8601 AMOLED (Waveshare ESP32-S3 1.8").
 * QSPI interface, 368x448, RGB565. Touch via FT3168 (FT5x06-compatible).
 *
 * Uses esp_lvgl_port for LVGL lifecycle (tick, task, display bridge, touch).
 * Thread-safe: all LVGL calls wrapped in lvgl_port_lock/unlock.
 *
 * Layout:
 *   Status bar (32px top): "Worzel" + spaced WiFi/Auth/WS icons
 *   Conversation (376px middle): scrollable, touch-scrollable, auto-scroll
 *   Action bar (38px bottom): icon + "Push to talk", tap to cycle font size
 */

#include "display.h"
#include "board.h"

#include <string.h>
#include <time.h>
#include <sys/time.h>
#include "freertos/FreeRTOS.h"
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

/* LVGL UI elements */
static lv_obj_t *status_bar = NULL;
static lv_obj_t *lbl_title = NULL;
static lv_obj_t *lbl_time = NULL;
static lv_obj_t *lbl_icon_wifi = NULL;
static lv_obj_t *lbl_icon_auth = NULL;
static lv_obj_t *lbl_icon_ws   = NULL;
static lv_obj_t *convo_area = NULL;
static lv_obj_t *action_bar = NULL;
static lv_obj_t *lbl_action = NULL;

/*
 * Status slot mapping (same slots as bitmap version for API compat):
 *   0-1 = Audio/Opus OK  → ignored (boot-only)
 *   2   = WiFi status    → WiFi icon color
 *   3   = IP address     → ignored (serial log only)
 *   4   = Auth status    → Auth icon color
 *   5   = WebSocket      → WS icon color
 *   6   = Ready/hint     → action bar text
 */

#define STATUS_BAR_H  32
#define ACTION_BAR_H  38

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
static int font_idx = 1;  /* start at montserrat_30 (bearable) */

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

/* Callback: tap action bar to cycle conversation font size */
static void font_cycle_cb(lv_event_t *e) {
    (void)e;
    if (FONT_COUNT <= 1) return;
    font_idx = (font_idx + 1) % (int)FONT_COUNT;
    ESP_LOGI(TAG, "Font size cycled to index %d", font_idx);

    /* Update all existing conversation labels */
    uint32_t count = lv_obj_get_child_count(convo_area);
    for (uint32_t i = 0; i < count; i++) {
        lv_obj_t *child = lv_obj_get_child(convo_area, i);
        lv_obj_set_style_text_font(child, font_sizes[font_idx], 0);
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

/* LVGL flush callback: byte-swap, send to panel, ALWAYS signal flush_ready.
 *
 * Three things this does that the esp_lvgl_port default doesn't handle:
 *
 * 1. Byte-swap RGB565: ESP32 is little-endian, SH8601 QSPI expects big-endian.
 *    Although swap_bytes=true is set in the display config, replacing the flush
 *    callback loses esp_lvgl_port's swap logic, so we must do it ourselves.
 *
 * 2. Error resilience: if SPI fails, we log and skip rather than hanging.
 *
 * 3. Unconditional flush_ready: the SPI ISR may never fire after an error,
 *    causing LVGL to spin forever in wait_for_flushing() (watchdog crash).
 *    We always signal completion. Double-calling is harmless in LVGL 9. */
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

/* Helper: strip LVGL theme then set geometry + background.
 * MUST set size/align AFTER lv_obj_remove_style_all() because
 * LVGL 9 stores size and position as style properties. */
static void style_container(lv_obj_t *obj, lv_color_t bg,
                             int32_t w, int32_t h,
                             lv_align_t align, int32_t x_ofs, int32_t y_ofs) {
    lv_obj_remove_style_all(obj);
    lv_obj_set_size(obj, w, h);
    lv_obj_align(obj, align, x_ofs, y_ofs);
    lv_obj_set_style_bg_color(obj, bg, 0);
    lv_obj_set_style_bg_opa(obj, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(obj, 0, 0);
    lv_obj_set_style_radius(obj, 0, 0);
    lv_obj_set_style_pad_all(obj, 0, 0);
    lv_obj_set_scrollbar_mode(obj, LV_SCROLLBAR_MODE_OFF);
}

/* Build the LVGL UI layout.
 *
 * Creation order matters for z-order: later children draw on top.
 * convo_area is created FIRST (lowest z-order) so its background
 * can never cover status_bar or action_bar content. */
static void build_ui(void) {
    lv_obj_t *scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_black(), 0);
    lv_obj_set_style_pad_all(scr, 0, 0);

    lv_color_t bar_bg = lv_color_make(20, 20, 30);

    /* ---- Conversation area (middle, scrollable) — created FIRST (lowest z) ---- */
    int convo_h = LCD_V_RES - STATUS_BAR_H - 1 - 1 - ACTION_BAR_H;
    convo_area = lv_obj_create(scr);
    style_container(convo_area, lv_color_black(),
                    LCD_H_RES, convo_h, LV_ALIGN_TOP_LEFT, 0, STATUS_BAR_H + 1);
    /* Transparent background — screen is already black, so text renders
     * directly over the black screen. Avoids opaque bg covering children
     * during partial LVGL redraws with small draw buffer. */
    lv_obj_set_style_bg_opa(convo_area, LV_OPA_TRANSP, 0);
    lv_obj_set_style_pad_left(convo_area, 8, 0);
    lv_obj_set_style_pad_right(convo_area, 8, 0);
    lv_obj_set_style_pad_top(convo_area, 4, 0);
    lv_obj_set_style_pad_bottom(convo_area, 4, 0);
    lv_obj_set_flex_flow(convo_area, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(convo_area, LV_FLEX_ALIGN_START,
                          LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_add_flag(convo_area, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scrollbar_mode(convo_area, LV_SCROLLBAR_MODE_AUTO);

    /* ---- Status bar (top) ---- */
    status_bar = lv_obj_create(scr);
    style_container(status_bar, bar_bg,
                    LCD_H_RES, STATUS_BAR_H, LV_ALIGN_TOP_LEFT, 0, 0);
    lv_obj_remove_flag(status_bar, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_pad_left(status_bar, 16, 0);
    lv_obj_set_style_pad_right(status_bar, 16, 0);
    lv_obj_set_flex_flow(status_bar, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(status_bar, LV_FLEX_ALIGN_SPACE_BETWEEN,
                          LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    /* Title "Worzel" — left */
    lbl_title = lv_label_create(status_bar);
    lv_label_set_text(lbl_title, "Worzel");
    lv_obj_set_style_text_color(lbl_title, lv_color_make(0x50, 0xC8, 0x50), 0);
    lv_obj_set_style_text_font(lbl_title, &lv_font_montserrat_14, 0);

    /* Clock — center (ISO 8601 date + time, updated by LVGL timer) */
    lbl_time = lv_label_create(status_bar);
    lv_label_set_text(lbl_time, "--:--");
    lv_obj_set_style_text_color(lbl_time, lv_color_make(0x99, 0x99, 0x99), 0);
    lv_obj_set_style_text_font(lbl_time, &lv_font_montserrat_14, 0);

    /* Status icons — right side, montserrat_14, spaced.
     * Start dim grey; display_status() colors them. */
    lv_color_t icon_off = lv_color_make(0x55, 0x55, 0x55);

    lbl_icon_wifi = lv_label_create(status_bar);
    lv_label_set_text(lbl_icon_wifi, LV_SYMBOL_WIFI);
    lv_obj_set_style_text_color(lbl_icon_wifi, icon_off, 0);
    lv_obj_set_style_text_font(lbl_icon_wifi, &lv_font_montserrat_14, 0);

    lbl_icon_auth = lv_label_create(status_bar);
    lv_label_set_text(lbl_icon_auth, LV_SYMBOL_EYE_OPEN);
    lv_obj_set_style_text_color(lbl_icon_auth, icon_off, 0);
    lv_obj_set_style_text_font(lbl_icon_auth, &lv_font_montserrat_14, 0);
    lv_obj_set_style_pad_left(lbl_icon_auth, 8, 0);

    lbl_icon_ws = lv_label_create(status_bar);
    lv_label_set_text(lbl_icon_ws, LV_SYMBOL_CALL);
    lv_obj_set_style_text_color(lbl_icon_ws, icon_off, 0);
    lv_obj_set_style_text_font(lbl_icon_ws, &lv_font_montserrat_14, 0);
    lv_obj_set_style_pad_left(lbl_icon_ws, 8, 0);

    /* ---- Thin separator ---- */
    lv_obj_t *sep1 = lv_obj_create(scr);
    style_container(sep1, lv_color_make(50, 50, 50),
                    LCD_H_RES, 1, LV_ALIGN_TOP_LEFT, 0, STATUS_BAR_H);
    lv_obj_remove_flag(sep1, LV_OBJ_FLAG_SCROLLABLE);

    /* ---- Action bar (bottom) — tap to cycle font size ---- */
    action_bar = lv_obj_create(scr);
    style_container(action_bar, bar_bg,
                    LCD_H_RES, ACTION_BAR_H, LV_ALIGN_BOTTOM_LEFT, 0, 0);
    lv_obj_remove_flag(action_bar, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(action_bar, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(action_bar, font_cycle_cb, LV_EVENT_CLICKED, NULL);

    lbl_action = lv_label_create(action_bar);
    lv_label_set_text(lbl_action, "");
    lv_obj_set_style_text_color(lbl_action, lv_color_make(0xEE, 0xEE, 0xEE), 0);
    if (FONT_COUNT > 0 && font_idx < (int)FONT_COUNT) {
        lv_obj_set_style_text_font(lbl_action, font_sizes[font_idx], 0);
    }
    lv_obj_center(lbl_action);

    /* ---- Separator above action bar ---- */
    lv_obj_t *sep2 = lv_obj_create(scr);
    style_container(sep2, lv_color_make(50, 50, 50),
                    LCD_H_RES, 1, LV_ALIGN_BOTTOM_LEFT, 0, -ACTION_BAR_H);
    lv_obj_remove_flag(sep2, LV_OBJ_FLAG_SCROLLABLE);
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
    ESP_LOGI(TAG, "LVGL display registered");

    /* Replace the default flush callback with our safe wrapper.
     * esp_lvgl_port's default relies on the SPI ISR to call flush_ready,
     * but if a single SPI error corrupts driver state, the ISR may never
     * fire and LVGL hangs forever in wait_for_flushing() (watchdog crash).
     * Our wrapper always signals completion. swap_bytes=true in disp_cfg
     * means byte-swapping is already done before our callback runs. */
    lv_display_set_flush_cb(lvgl_disp, safe_flush_cb);

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
        lvgl_port_unlock();
    }

    ESP_LOGI(TAG, "LVGL UI ready (%d font sizes available)", (int)FONT_COUNT);
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
        case 6:
            if (lbl_action) {
                /* Prepend audio icon to action bar text */
                if (text && text[0]) {
                    char buf[128];
                    snprintf(buf, sizeof(buf), LV_SYMBOL_AUDIO "  %s", text);
                    lv_label_set_text(lbl_action, buf);
                } else {
                    lv_label_set_text(lbl_action, "");
                }
                lv_obj_set_style_text_color(lbl_action, c, 0);
            }
            break;
        default:
            break;
        }
        lvgl_port_unlock();
    }
}

void display_conversation(const char *text, uint16_t color) {
    if (!convo_area || !text || !text[0]) return;

    /* Audio playback is decoupled to its own task+queue, so blocking
     * the WS handler here won't cause stutter. Use a generous timeout
     * to survive touch-scroll events (touch processing holds the LVGL
     * mutex longer than usual). */
    if (lvgl_port_lock(500)) {
        lv_obj_t *lbl = lv_label_create(convo_area);
        lv_label_set_text(lbl, text);
        lv_obj_set_width(lbl, LCD_H_RES - 24);
        lv_label_set_long_mode(lbl, LV_LABEL_LONG_WRAP);
        lv_obj_set_style_text_color(lbl, map_color(color), 0);
        if (FONT_COUNT > 0 && font_idx < (int)FONT_COUNT) {
            lv_obj_set_style_text_font(lbl, font_sizes[font_idx], 0);
        }
        lv_obj_set_style_pad_bottom(lbl, 6, 0);

        /* Force layout update so LVGL knows the new child's position */
        lv_obj_update_layout(convo_area);

        uint32_t count = lv_obj_get_child_count(convo_area);
        int32_t cont_h = lv_obj_get_content_height(convo_area);
        int32_t scroll_y = lv_obj_get_scroll_y(convo_area);
        ESP_LOGI(TAG, "convo: label #%lu [%.30s] color=0x%04X cont_h=%ld scroll_y=%ld",
                 (unsigned long)count, text, color, (long)cont_h, (long)scroll_y);

        /* Scroll to make the newly added label visible.
         * Previous approach used lv_obj_scroll_to_y(LV_COORD_MAX) which
         * can overshoot when LVGL doesn't clamp the extreme value. */
        lv_obj_scroll_to_view(lbl, LV_ANIM_OFF);

        lvgl_port_unlock();
    }
}

void display_clear(void) {
    if (!convo_area) return;

    if (lvgl_port_lock(0)) {
        lv_obj_clean(convo_area);
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
