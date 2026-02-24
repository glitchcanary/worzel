/**
 * Zone-based display for SH8601 AMOLED (Waveshare ESP32-S3 1.8").
 * QSPI interface, 368x448, RGB565. No LVGL — direct framebuffer + bitmap font.
 *
 * Three zones:
 *   Header (y 0-55):     "Worzel" at 4x, board name at 2x
 *   Status (y 56-191):   8 slots at 2x (WiFi, Auth, WS, etc.)
 *   Conversation (y 192-447): STT/TTS at 2x with word-wrap + scrolling ring buffer
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

/* Zone layout (pixel coordinates) */
#define ZONE_HEADER_Y     0
#define ZONE_HEADER_H    56    /* 32px title + 16px subtitle + 8px gap */
#define ZONE_STATUS_Y    56
#define ZONE_STATUS_H   136    /* 8 slots x 16px + 8px padding */
#define ZONE_CONVO_Y    192
#define ZONE_CONVO_H    256    /* 448 - 192 */

/* Font constants */
#define HEADER_SCALE     4     /* 32px per char */
#define STATUS_SCALE     2     /* 16px per char */
#define CONVO_SCALE      2     /* 16px per char — 1x is unreadable on 1.8" */
#define STATUS_CHAR_H   (8 * STATUS_SCALE)  /* 16px */
#define CONVO_CHAR_W    (8 * CONVO_SCALE)   /* 16px */
#define CONVO_CHAR_H    (8 * CONVO_SCALE)   /* 16px */
#define CONVO_COLS      (LCD_H_RES / CONVO_CHAR_W)           /* 23 chars at 2x */
#define CONVO_LINES     (ZONE_CONVO_H / CONVO_CHAR_H)        /* 16 lines at 2x */
#define STATUS_MAX_COLS (LCD_H_RES / (8 * STATUS_SCALE))     /* 23 chars */

#define LEFT_MARGIN     8  /* pixels */

/* Push framebuffer in bands to avoid SPI transfer size limits */
#define BAND_ROWS   32

/* Persistent framebuffer in PSRAM (368*448*2 = ~322KB) */
static uint16_t *framebuf = NULL;

/* Conversation ring buffer */
typedef struct {
    char text[48];    /* max CONVO_COLS + 2 for safety */
    uint16_t color;
} convo_line_t;

static convo_line_t convo_buf[CONVO_LINES];
static int convo_head = 0;   /* next write position */
static int convo_count = 0;  /* number of lines in buffer */

/* Separator color */
#define COLOR_SEPARATOR 0x3186  /* dark grey */

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

/* Push full framebuffer to display in bands */
static void flush_framebuf(void) {
    for (int y = 0; y < LCD_V_RES; y += BAND_ROWS) {
        int y_end = y + BAND_ROWS;
        if (y_end > LCD_V_RES) y_end = LCD_V_RES;
        esp_lcd_panel_draw_bitmap(panel, 0, y, LCD_H_RES, y_end,
                                   &framebuf[y * LCD_H_RES]);
    }
}

/* Push a specific Y range to the display */
static void flush_region(int y_start, int y_end) {
    if (!panel || !framebuf) return;
    /* Align to even boundaries (display requirement) */
    y_start &= ~1;
    y_end = (y_end + 1) & ~1;
    if (y_end > LCD_V_RES) y_end = LCD_V_RES;
    if (y_start >= y_end) return;
    esp_lcd_panel_draw_bitmap(panel, 0, y_start, LCD_H_RES, y_end,
                               &framebuf[y_start * LCD_H_RES]);
}

/* Draw a single character at arbitrary scale (1-4) */
static void draw_char_scaled(int px, int py, char c, int scale, uint16_t fg, uint16_t bg) {
    if (c < 0x20 || c > 0x7E) c = '?';
    const uint8_t *glyph = font8x8_basic[(int)c];
    for (int row = 0; row < 8; row++) {
        uint8_t bits = glyph[row];
        for (int col = 0; col < 8; col++) {
            uint16_t color = (bits & (1 << col)) ? fg : bg;
            for (int sy = 0; sy < scale; sy++) {
                for (int sx = 0; sx < scale; sx++) {
                    int x = px + col * scale + sx;
                    int y = py + row * scale + sy;
                    if (x >= 0 && x < LCD_H_RES && y >= 0 && y < LCD_V_RES) {
                        framebuf[y * LCD_H_RES + x] = color;
                    }
                }
            }
        }
    }
}

/* Draw a text string at given position and scale */
static void draw_text(int px, int py, const char *text, int scale, uint16_t fg) {
    int cw = 8 * scale;
    for (int i = 0; text[i]; i++) {
        int x = px + i * cw;
        if (x + cw > LCD_H_RES) break;
        draw_char_scaled(x, py, text[i], scale, fg, COLOR_BLACK);
    }
}

/* Draw a horizontal separator line */
static void draw_hline(int y, uint16_t color) {
    if (y < 0 || y >= LCD_V_RES) return;
    for (int x = 0; x < LCD_H_RES; x++) {
        framebuf[y * LCD_H_RES + x] = color;
    }
}

/* Clear a rectangular region to black */
static void clear_region(int y_start, int height) {
    for (int y = y_start; y < y_start + height && y < LCD_V_RES; y++) {
        for (int x = 0; x < LCD_H_RES; x++) {
            framebuf[y * LCD_H_RES + x] = COLOR_BLACK;
        }
    }
}

/* Render the header zone: "Worzel" at 3x, board name at 2x */
static void render_header(void) {
    clear_region(ZONE_HEADER_Y, ZONE_HEADER_H);
    draw_text(LEFT_MARGIN, ZONE_HEADER_Y + 2, "Worzel", HEADER_SCALE, COLOR_GREEN);
    draw_text(LEFT_MARGIN, ZONE_HEADER_Y + 36, BOARD_NAME, STATUS_SCALE, COLOR_GREY);
    draw_hline(ZONE_HEADER_Y + ZONE_HEADER_H - 1, COLOR_SEPARATOR);
}

/* Redraw the entire conversation zone from the ring buffer */
static void render_conversation(void) {
    clear_region(ZONE_CONVO_Y, ZONE_CONVO_H);

    int start = 0;
    if (convo_count >= CONVO_LINES) {
        start = convo_head;  /* oldest entry is at head when full */
    }

    for (int i = 0; i < convo_count && i < CONVO_LINES; i++) {
        int idx = (start + i) % CONVO_LINES;
        int py = ZONE_CONVO_Y + i * CONVO_CHAR_H;
        if (py + CONVO_CHAR_H > LCD_V_RES) break;
        draw_text(LEFT_MARGIN, py, convo_buf[idx].text, CONVO_SCALE, convo_buf[idx].color);
    }

    flush_region(ZONE_CONVO_Y, ZONE_CONVO_Y + ZONE_CONVO_H);
}

/* Add a line to the conversation ring buffer */
static void convo_push(const char *text, uint16_t color) {
    strncpy(convo_buf[convo_head].text, text, sizeof(convo_buf[0].text) - 1);
    convo_buf[convo_head].text[sizeof(convo_buf[0].text) - 1] = '\0';
    convo_buf[convo_head].color = color;
    convo_head = (convo_head + 1) % CONVO_LINES;
    if (convo_count < CONVO_LINES) convo_count++;
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

    /* Clear and render initial layout */
    display_clear();
    render_header();
    draw_hline(ZONE_CONVO_Y - 1, COLOR_SEPARATOR);
    flush_framebuf();

    return ESP_OK;
}

void display_status(int slot, const char *text, uint16_t color) {
    if (!framebuf || !panel || slot < 0 || slot >= 8) return;

    int py = ZONE_STATUS_Y + slot * STATUS_CHAR_H;
    if (py + STATUS_CHAR_H > ZONE_STATUS_Y + ZONE_STATUS_H) return;

    /* Clear the slot row */
    clear_region(py, STATUS_CHAR_H);

    /* Draw text at 2x scale */
    draw_text(LEFT_MARGIN, py, text, STATUS_SCALE, color);

    /* Push just this row to display */
    flush_region(py, py + STATUS_CHAR_H);
}

void display_conversation(const char *text, uint16_t color) {
    if (!framebuf || !panel || !text || !text[0]) return;

    /* Blank line between messages for readability */
    if (convo_count > 0) {
        convo_push("", COLOR_BLACK);
    }

    int len = strlen(text);
    int max_chars = CONVO_COLS - 1;  /* leave 1 col margin for left padding */

    /* Detect prefix like "> " or "< " for continuation indent */
    int indent = 0;
    if (len >= 2 && (text[0] == '>' || text[0] == '<') && text[1] == ' ') {
        indent = 2;  /* continuation lines get "  " indent */
    }

    /* Word-wrap into lines */
    int pos = 0;
    int first_line = 1;
    while (pos < len) {
        int line_max = first_line ? max_chars : (max_chars - indent);
        int line_len = 0;

        /* Find how many chars fit on this line */
        int remaining = len - pos;
        if (remaining <= line_max) {
            line_len = remaining;
        } else {
            /* Try to break at a space */
            line_len = line_max;
            int last_space = -1;
            for (int i = 0; i < line_len && pos + i < len; i++) {
                if (text[pos + i] == ' ') last_space = i;
            }
            if (last_space > line_max / 3) {
                line_len = last_space + 1;  /* include the space */
            }
        }

        /* Build line with indent for continuations */
        char out[48];
        if (!first_line && indent > 0) {
            memset(out, ' ', indent);
            int copy_len = line_len;
            if (copy_len > (int)sizeof(out) - indent - 1)
                copy_len = sizeof(out) - indent - 1;
            memcpy(out + indent, &text[pos], copy_len);
            out[indent + copy_len] = '\0';
        } else {
            if (line_len > (int)sizeof(out) - 1) line_len = sizeof(out) - 1;
            memcpy(out, &text[pos], line_len);
            out[line_len] = '\0';
        }

        /* Remove trailing spaces */
        int out_len = strlen(out);
        while (out_len > 0 && out[out_len - 1] == ' ') {
            out[--out_len] = '\0';
        }

        convo_push(out, color);
        pos += line_len;
        first_line = 0;

        /* Skip leading spaces on next line */
        while (pos < len && text[pos] == ' ') pos++;
    }

    render_conversation();
}

void display_clear(void) {
    if (!framebuf || !panel) return;
    memset(framebuf, 0, LCD_H_RES * LCD_V_RES * sizeof(uint16_t));
    convo_head = 0;
    convo_count = 0;
    flush_framebuf();
}

#else /* !BOARD_HAS_DISPLAY */

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
