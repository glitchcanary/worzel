/**
 * Display abstraction for Worzel ESP32 client.
 *
 * Two implementations selected by board flags:
 *   BOARD_HAS_LVGL  → display.c (LVGL 9.x with touch, proportional fonts)
 *   BOARD_HAS_DISPLAY (no LVGL) → display_bitmap.c (direct framebuffer + 8x8 font)
 *   Neither → stubs (no display hardware)
 */

#ifndef WORZEL_DISPLAY_H
#define WORZEL_DISPLAY_H

#include "esp_err.h"
#include "driver/i2c_master.h"

/* Colors (RGB565) — used by both LVGL and bitmap implementations */
#define COLOR_BLACK   0x0000
#define COLOR_WHITE   0xFFFF
#define COLOR_GREEN   0x47E0   /* medium green */
#define COLOR_RED     0xF800
#define COLOR_YELLOW  0xFE60   /* warm yellow */
#define COLOR_CYAN    0x5FFF   /* light cyan */
#define COLOR_GREY    0x9CD3   /* light grey */

/**
 * Initialize display hardware and render initial layout.
 * Must be called after I2C bus is initialized (shares bus with ES8311).
 */
esp_err_t display_init(i2c_master_bus_handle_t i2c_bus);

/**
 * Show a status line. Slot numbers (compatible with both implementations):
 *   0 = Audio status (bitmap only, ignored by LVGL)
 *   1 = Opus status  (bitmap only, ignored by LVGL)
 *   2 = WiFi status
 *   3 = IP address
 *   4 = Auth status
 *   5 = WebSocket status
 *   6 = Ready/hint text (LVGL: ignored, log only; bitmap: status row)
 */
void display_status(int slot, const char *text, uint16_t color);

/**
 * Append a message to the conversation area with word-wrapping.
 * LVGL: creates a label in scrollable container with auto-scroll.
 * Bitmap: appends to ring buffer, redraws conversation zone.
 */
void display_conversation(const char *text, uint16_t color);

/**
 * Clear the conversation area.
 */
void display_clear(void);

#endif /* WORZEL_DISPLAY_H */
