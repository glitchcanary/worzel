/**
 * Minimal boot status display for Worzel ESP32 client.
 * SH8601 AMOLED via QSPI, 8x8 bitmap font, no LVGL.
 */

#ifndef WORZEL_DISPLAY_H
#define WORZEL_DISPLAY_H

#include "esp_err.h"
#include "driver/i2c_master.h"

/* Colors (RGB565) */
#define COLOR_BLACK   0x0000
#define COLOR_WHITE   0xFFFF
#define COLOR_GREEN   0x07E0
#define COLOR_RED     0xF800
#define COLOR_YELLOW  0xFFE0
#define COLOR_CYAN    0x07FF
#define COLOR_GREY    0x7BEF

/**
 * Initialize the display hardware (QSPI bus, IO expander reset, SH8601 panel).
 * Must be called after I2C bus is initialized (shares bus with ES8311).
 */
esp_err_t display_init(i2c_master_bus_handle_t i2c_bus);

/**
 * Show a status line at the given row (0-based).
 * Text is rendered in the given color on a black background.
 * Rows 0-27 are available (16px high each on 448px display).
 */
void display_status(int row, const char *text, uint16_t color);

/**
 * Clear the entire display to black.
 */
void display_clear(void);

#endif /* WORZEL_DISPLAY_H */
