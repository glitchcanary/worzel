/**
 * Minimal boot status display for SH8601 AMOLED (Waveshare ESP32-S3 1.8").
 * QSPI interface, 368x448, RGB565. No LVGL — direct framebuffer + bitmap font.
 */

#include "display.h"
#include "board.h"
#include "font8x8.h"

#include <string.h>
#include "esp_log.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_sh8601.h"
#include "esp_io_expander_tca9554.h"
#include "driver/spi_master.h"

#ifdef BOARD_HAS_DISPLAY

static const char *TAG = "display";

static esp_lcd_panel_handle_t panel = NULL;
static esp_lcd_panel_io_handle_t panel_io = NULL;

/* Font rendering: 2x scale = 16x16 px per character */
#define FONT_SCALE  2
#define CHAR_W      (8 * FONT_SCALE)
#define CHAR_H      (8 * FONT_SCALE)
#define MAX_COLS    (LCD_H_RES / CHAR_W)

/* Push framebuffer in bands to avoid SPI transfer size limits */
#define BAND_ROWS   32

/* Persistent framebuffer in PSRAM (368*448*2 = ~322KB) */
static uint16_t *framebuf = NULL;

/* SH8601 vendor init commands */
static const sh8601_lcd_init_cmd_t init_cmds[] = {
    {0x11, (uint8_t[]){0x00}, 0, 120},                     /* Sleep out */
    {0x44, (uint8_t[]){0x01, 0xD1}, 2, 0},                 /* Tear scanline */
    {0x35, (uint8_t[]){0x00}, 1, 0},                        /* Tearing effect on */
    {0x53, (uint8_t[]){0x20}, 1, 10},                       /* Write CTRL display */
    {0x2A, (uint8_t[]){0x00, 0x00, 0x01, 0x6F}, 4, 0},     /* Column 0-367 */
    {0x2B, (uint8_t[]){0x00, 0x00, 0x01, 0xBF}, 4, 0},     /* Row 0-447 */
    {0x51, (uint8_t[]){0xA0}, 1, 10},                       /* Brightness ~63% */
    {0x29, (uint8_t[]){0x00}, 0, 10},                       /* Display ON */
};

/* Push full framebuffer to display in bands */
static void flush_framebuf(void) {
    for (int y = 0; y < LCD_V_RES; y += BAND_ROWS) {
        int y_end = y + BAND_ROWS;
        if (y_end > LCD_V_RES) y_end = LCD_V_RES;
        esp_lcd_panel_draw_bitmap(panel, 0, y, LCD_H_RES, y_end,
                                   &framebuf[y * LCD_H_RES]);
    }
}

static void draw_char(int px, int py, char c, uint16_t fg, uint16_t bg) {
    if (c < 0x20 || c > 0x7E) c = '?';
    const uint8_t *glyph = font8x8_basic[(int)c];
    for (int row = 0; row < 8; row++) {
        uint8_t bits = glyph[row];
        for (int col = 0; col < 8; col++) {
            uint16_t color = (bits & (1 << col)) ? fg : bg;
            for (int sy = 0; sy < FONT_SCALE; sy++) {
                for (int sx = 0; sx < FONT_SCALE; sx++) {
                    int x = px + col * FONT_SCALE + sx;
                    int y = py + row * FONT_SCALE + sy;
                    if (x >= 0 && x < LCD_H_RES && y >= 0 && y < LCD_V_RES) {
                        framebuf[y * LCD_H_RES + x] = color;
                    }
                }
            }
        }
    }
}

esp_err_t display_init(i2c_master_bus_handle_t i2c_bus) {
    /* Allocate framebuffer in PSRAM */
    size_t fb_size = LCD_H_RES * LCD_V_RES * sizeof(uint16_t);
    framebuf = heap_caps_malloc(fb_size, MALLOC_CAP_SPIRAM);
    if (!framebuf) {
        ESP_LOGE(TAG, "Failed to alloc framebuffer (%d bytes)", fb_size);
        return ESP_ERR_NO_MEM;
    }
    memset(framebuf, 0, fb_size);

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
        .max_transfer_sz = LCD_H_RES * BAND_ROWS * sizeof(uint16_t),
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

    /* Show initial screen */
    display_clear();
    display_status(0, "Worzel", COLOR_GREEN);
    display_status(1, BOARD_NAME, COLOR_GREY);

    return ESP_OK;
}

void display_status(int row, const char *text, uint16_t color) {
    if (!framebuf || !panel || row < 0) return;

    int py = (row + 1) * CHAR_H;  /* row 0 starts at y=CHAR_H (top margin) */
    if (py + CHAR_H > LCD_V_RES) return;

    /* Clear the row */
    int px_start = CHAR_W;  /* left margin */
    for (int y = py; y < py + CHAR_H; y++) {
        for (int x = 0; x < LCD_H_RES; x++) {
            framebuf[y * LCD_H_RES + x] = COLOR_BLACK;
        }
    }

    /* Draw text */
    for (int i = 0; text[i] && (i + 1) < MAX_COLS; i++) {
        draw_char(px_start + i * CHAR_W, py, text[i], color, COLOR_BLACK);
    }

    /* Push the updated row band to display (y coords must be even) */
    int y_start = py & ~1;
    int y_end = (py + CHAR_H + 1) & ~1;
    if (y_end > LCD_V_RES) y_end = LCD_V_RES;
    esp_lcd_panel_draw_bitmap(panel, 0, y_start, LCD_H_RES, y_end,
                               &framebuf[y_start * LCD_H_RES]);
}

void display_clear(void) {
    if (!framebuf || !panel) return;
    memset(framebuf, 0, LCD_H_RES * LCD_V_RES * sizeof(uint16_t));
    flush_framebuf();
}

#else /* !BOARD_HAS_DISPLAY */

esp_err_t display_init(i2c_master_bus_handle_t i2c_bus) {
    (void)i2c_bus;
    return ESP_OK;
}

void display_status(int row, const char *text, uint16_t color) {
    (void)row; (void)text; (void)color;
}

void display_clear(void) {}

#endif
