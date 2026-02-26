/**
 * Simulator UI — shared display logic for desktop and ESP32.
 *
 * This mirrors the public API from display.h but without ESP-IDF dependencies.
 * The UI-building code is extracted from display.c.
 */

#ifndef SIM_UI_H
#define SIM_UI_H

#include "lvgl.h"
#include <stdint.h>

/* Display dimensions — match the hardware (Waveshare S3 AMOLED 1.8") */
#define LCD_H_RES 368
#define LCD_V_RES 448

/* Colors (RGB565) — same as display.h */
#define COLOR_BLACK   0x0000
#define COLOR_WHITE   0xFFFF
#define COLOR_GREEN   0x47E0
#define COLOR_RED     0xF800
#define COLOR_YELLOW  0xFE60
#define COLOR_CYAN    0x5FFF
#define COLOR_GREY    0x9CD3

/**
 * Build the LVGL UI layout (status bar, conversation area, action bar).
 * Call after lv_init() and display creation.
 */
void sim_build_ui(void);

/**
 * Update a status icon color.
 * Slot 2=WiFi, 4=Auth, 5=WebSocket.
 */
void sim_display_status(int slot, const char *text, uint16_t color);

/**
 * Append text to the conversation area.
 */
void sim_display_conversation(const char *text, uint16_t color);

/**
 * Clear conversation area.
 */
void sim_display_clear(void);

#endif /* SIM_UI_H */
