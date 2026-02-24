/**
 * Zone-based display for Worzel ESP32 client.
 * SH8601 AMOLED via QSPI, 368x448, RGB565.
 *
 * Three zones:
 *   Header (y 0-47):     "Worzel" title, board name
 *   Status (y 48-175):   8 slots for WiFi/Auth/WS status
 *   Conversation (y 176-447): STT/TTS with word-wrap + scrolling
 */

#ifndef WORZEL_DISPLAY_H
#define WORZEL_DISPLAY_H

#include "esp_err.h"
#include "driver/i2c_master.h"

/* Colors (RGB565) */
#define COLOR_BLACK   0x0000
#define COLOR_WHITE   0xFFFF
#define COLOR_GREEN   0x47E0   /* medium green */
#define COLOR_RED     0xF800
#define COLOR_YELLOW  0xFE60   /* warm yellow */
#define COLOR_CYAN    0x5FFF   /* light cyan */
#define COLOR_GREY    0x9CD3   /* light grey */

/**
 * Initialize display hardware and render header.
 * Must be called after I2C bus is initialized (shares bus with ES8311).
 */
esp_err_t display_init(i2c_master_bus_handle_t i2c_bus);

/**
 * Show a status line in the status zone (slots 0-7).
 * Text is rendered at 2x scale (16px) on black background.
 */
void display_status(int slot, const char *text, uint16_t color);

/**
 * Append a message to the conversation zone with word-wrapping.
 * Text is rendered at 1x scale (8px) and auto-scrolls when full.
 */
void display_conversation(const char *text, uint16_t color);

/**
 * Clear the entire display to black and reset conversation history.
 */
void display_clear(void);

#endif /* WORZEL_DISPLAY_H */
