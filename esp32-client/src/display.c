/**
 * LVGL 9.x display for SH8601 AMOLED (Waveshare ESP32-S3 1.8").
 * QSPI interface, 368x448, RGB565. Touch via FT3168 (FT5x06-compatible).
 *
 * Uses esp_lvgl_port for LVGL lifecycle (tick, task, display bridge, touch).
 * Thread-safe: all LVGL calls wrapped in lvgl_port_lock/unlock.
 *
 * Layout:
 *   Status bar (~40px top): "Worzel" + WiFi/Auth/WS status
 *   Conversation (middle): scrollable, touch-enabled, auto-scroll
 *   Action bar (~36px bottom): state hint text
 */

#include "display.h"
#include "board.h"

#include <string.h>
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
static lv_obj_t *lbl_status[4] = {0};  /* WiFi, IP, Auth, WS */
static lv_obj_t *convo_area = NULL;
static lv_obj_t *action_bar = NULL;
static lv_obj_t *lbl_action = NULL;

/*
 * Status slot mapping (same slots as bitmap version for API compat):
 *   0 = Audio: OK       → ignored (boot-only)
 *   1 = Opus: OK        → ignored (boot-only)
 *   2 = WiFi status     → status bar label 0
 *   3 = IP address      → status bar label 1
 *   4 = Auth status     → status bar label 2
 *   5 = WebSocket       → status bar label 3
 *   6 = Ready/hint      → action bar
 */
#define SLOT_TO_STATUS(s)  ((s) - 2)  /* slots 2-5 → labels 0-3 */

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

/* Convert our RGB565 color defines to lv_color_t */
static lv_color_t to_lv_color(uint16_t rgb565) {
    uint8_t r = (rgb565 >> 11) & 0x1F;
    uint8_t g = (rgb565 >> 5) & 0x3F;
    uint8_t b = rgb565 & 0x1F;
    return lv_color_make((r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2));
}

/* Compact status labels shown in the top bar */

/* Build the LVGL UI layout */
static void build_ui(void) {
    lv_obj_t *scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_black(), 0);
    lv_obj_set_style_pad_all(scr, 0, 0);

    /* ---- Status bar (top ~40px) ---- */
    status_bar = lv_obj_create(scr);
    lv_obj_set_size(status_bar, LCD_H_RES, 40);
    lv_obj_align(status_bar, LV_ALIGN_TOP_LEFT, 0, 0);
    lv_obj_set_style_bg_color(status_bar, lv_color_make(20, 20, 30), 0);
    lv_obj_set_style_bg_opa(status_bar, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(status_bar, 0, 0);
    lv_obj_set_style_radius(status_bar, 0, 0);
    lv_obj_set_style_pad_left(status_bar, 8, 0);
    lv_obj_set_style_pad_right(status_bar, 8, 0);
    lv_obj_set_style_pad_top(status_bar, 4, 0);
    lv_obj_set_scrollbar_mode(status_bar, LV_SCROLLBAR_MODE_OFF);
    lv_obj_set_flex_flow(status_bar, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(status_bar, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    /* Title */
    lbl_title = lv_label_create(status_bar);
    lv_label_set_text(lbl_title, "Worzel");
    lv_obj_set_style_text_color(lbl_title, lv_color_make(0x47, 0xE0 >> 2, 0x00), 0);  /* green-ish */
    lv_obj_set_style_text_color(lbl_title, lv_color_make(0x50, 0xC8, 0x50), 0);
    lv_obj_set_style_text_font(lbl_title, &lv_font_montserrat_14, 0);
    lv_obj_set_flex_grow(lbl_title, 1);

    /* Status labels (compact, in status bar: WiFi, IP, Auth, WS) */
    for (int i = 0; i < 4; i++) {
        lbl_status[i] = lv_label_create(status_bar);
        lv_label_set_text(lbl_status[i], "");
        lv_obj_set_style_text_color(lbl_status[i], lv_color_make(0x99, 0x99, 0x99), 0);
        lv_obj_set_style_text_font(lbl_status[i], &lv_font_montserrat_14, 0);
    }

    /* ---- Separator line ---- */
    lv_obj_t *sep1 = lv_obj_create(scr);
    lv_obj_set_size(sep1, LCD_H_RES, 1);
    lv_obj_align(sep1, LV_ALIGN_TOP_LEFT, 0, 40);
    lv_obj_set_style_bg_color(sep1, lv_color_make(60, 60, 60), 0);
    lv_obj_set_style_bg_opa(sep1, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(sep1, 0, 0);
    lv_obj_set_style_radius(sep1, 0, 0);
    lv_obj_set_style_pad_all(sep1, 0, 0);

    /* ---- Action bar (bottom ~36px) ---- */
    action_bar = lv_obj_create(scr);
    lv_obj_set_size(action_bar, LCD_H_RES, 36);
    lv_obj_align(action_bar, LV_ALIGN_BOTTOM_LEFT, 0, 0);
    lv_obj_set_style_bg_color(action_bar, lv_color_make(20, 20, 30), 0);
    lv_obj_set_style_bg_opa(action_bar, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(action_bar, 0, 0);
    lv_obj_set_style_radius(action_bar, 0, 0);
    lv_obj_set_style_pad_left(action_bar, 8, 0);
    lv_obj_set_scrollbar_mode(action_bar, LV_SCROLLBAR_MODE_OFF);

    lbl_action = lv_label_create(action_bar);
    lv_label_set_text(lbl_action, "");
    lv_obj_set_style_text_color(lbl_action, lv_color_make(0xCC, 0xCC, 0xCC), 0);
    lv_obj_set_style_text_font(lbl_action, &lv_font_montserrat_14, 0);
    lv_obj_center(lbl_action);

    /* ---- Separator line above action bar ---- */
    lv_obj_t *sep2 = lv_obj_create(scr);
    lv_obj_set_size(sep2, LCD_H_RES, 1);
    lv_obj_align(sep2, LV_ALIGN_BOTTOM_LEFT, 0, -36);
    lv_obj_set_style_bg_color(sep2, lv_color_make(60, 60, 60), 0);
    lv_obj_set_style_bg_opa(sep2, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(sep2, 0, 0);
    lv_obj_set_style_radius(sep2, 0, 0);
    lv_obj_set_style_pad_all(sep2, 0, 0);

    /* ---- Conversation area (middle, scrollable) ---- */
    /* Height: 448 - 40 (status) - 1 (sep) - 1 (sep) - 36 (action) = 370px */
    convo_area = lv_obj_create(scr);
    lv_obj_set_size(convo_area, LCD_H_RES, 448 - 40 - 1 - 1 - 36);
    lv_obj_align(convo_area, LV_ALIGN_TOP_LEFT, 0, 41);
    lv_obj_set_style_bg_color(convo_area, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(convo_area, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(convo_area, 0, 0);
    lv_obj_set_style_radius(convo_area, 0, 0);
    lv_obj_set_style_pad_left(convo_area, 8, 0);
    lv_obj_set_style_pad_right(convo_area, 8, 0);
    lv_obj_set_style_pad_top(convo_area, 4, 0);
    lv_obj_set_style_pad_bottom(convo_area, 4, 0);
    lv_obj_set_flex_flow(convo_area, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(convo_area, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_add_flag(convo_area, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scrollbar_mode(convo_area, LV_SCROLLBAR_MODE_AUTO);
}

esp_err_t display_init(i2c_master_bus_handle_t i2c_bus) {
    /* ---- SH8601 panel init (preserved from bitmap version) ---- */

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
        .max_transfer_sz = LCD_H_RES * 50 * sizeof(uint16_t),
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
        .trans_queue_depth = 10,
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
    const lvgl_port_cfg_t lvgl_cfg = ESP_LVGL_PORT_INIT_CONFIG();
    ESP_RETURN_ON_ERROR(lvgl_port_init(&lvgl_cfg), TAG, "LVGL port init failed");

    /* Register display with LVGL port */
    const lvgl_port_display_cfg_t disp_cfg = {
        .io_handle = panel_io,
        .panel_handle = panel,
        .buffer_size = LCD_H_RES * 50,
        .double_buffer = false,
        .hres = LCD_H_RES,
        .vres = LCD_V_RES,
        .flags = {
            .buff_spiram = true,
            .swap_bytes = false,
        },
    };
    lv_display_t *lvgl_disp = lvgl_port_add_disp(&disp_cfg);
    if (!lvgl_disp) {
        ESP_LOGE(TAG, "Failed to add display to LVGL port");
        return ESP_FAIL;
    }
    ESP_LOGI(TAG, "LVGL display registered");

    /* ---- Touch init (FT3168 / FT5x06-compatible) ---- */
#ifdef PIN_TOUCH_INT
    esp_lcd_touch_handle_t touch_handle = NULL;
    esp_lcd_panel_io_i2c_config_t touch_io_cfg = ESP_LCD_TOUCH_IO_I2C_FT5x06_CONFIG();
    touch_io_cfg.scl_speed_hz = 400000;  /* must set explicitly — macro leaves it 0 */
    esp_lcd_panel_io_handle_t touch_io = NULL;

    /* Create I2C IO for touch (on same bus as ES8311) */
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
            ESP_LOGW(TAG, "Touch LVGL registration failed — continuing without touch");
        }
    } else {
        ESP_LOGW(TAG, "Touch init failed (%s) — continuing without touch", esp_err_to_name(ret));
    }
#endif

    /* ---- Build UI ---- */
    if (lvgl_port_lock(0)) {
        build_ui();
        lvgl_port_unlock();
    }

    ESP_LOGI(TAG, "LVGL UI ready");
    return ESP_OK;
}

void display_status(int slot, const char *text, uint16_t color) {
    if (!convo_area) return;

    if (lvgl_port_lock(0)) {
        if (slot == 6 && lbl_action) {
            /* Slot 6 = "Ready" hint → action bar */
            lv_label_set_text(lbl_action, text ? text : "");
            lv_obj_set_style_text_color(lbl_action, to_lv_color(color), 0);
        } else if (slot >= 2 && slot <= 5) {
            /* Slots 2-5 = WiFi/IP/Auth/WS → status bar labels 0-3 */
            int idx = SLOT_TO_STATUS(slot);
            if (idx >= 0 && idx < 4 && lbl_status[idx]) {
                lv_label_set_text(lbl_status[idx], text ? text : "");
                lv_obj_set_style_text_color(lbl_status[idx], to_lv_color(color), 0);
            }
        }
        /* Slots 0-1 (Audio/Opus) silently ignored — boot-time only */
        lvgl_port_unlock();
    }
}

void display_conversation(const char *text, uint16_t color) {
    if (!convo_area || !text || !text[0]) return;

    if (lvgl_port_lock(0)) {
        lv_obj_t *lbl = lv_label_create(convo_area);
        lv_label_set_text(lbl, text);
        lv_obj_set_width(lbl, LCD_H_RES - 24);  /* account for padding */
        lv_label_set_long_mode(lbl, LV_LABEL_LONG_WRAP);
        lv_obj_set_style_text_color(lbl, to_lv_color(color), 0);
        lv_obj_set_style_text_font(lbl, &lv_font_montserrat_14, 0);
        lv_obj_set_style_pad_bottom(lbl, 4, 0);

        /* Auto-scroll to bottom */
        lv_obj_scroll_to_y(convo_area, LV_COORD_MAX, LV_ANIM_ON);

        lvgl_port_unlock();
    }
}

void display_clear(void) {
    if (!convo_area) return;

    if (lvgl_port_lock(0)) {
        /* Delete all children of conversation area */
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
