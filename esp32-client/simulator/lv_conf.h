/**
 * LVGL configuration for Worzel desktop simulator.
 * Matches the ESP32 sdkconfig.defaults LVGL settings.
 */

#ifndef LV_CONF_H
#define LV_CONF_H

/* Color depth: 16-bit RGB565 to match ESP32 AMOLED */
#define LV_COLOR_DEPTH 16

/* Memory: use stdlib malloc (no custom allocator needed on desktop) */
#define LV_USE_STDLIB_MALLOC    LV_STDLIB_BUILTIN
#define LV_USE_STDLIB_STRING    LV_STDLIB_BUILTIN
#define LV_USE_STDLIB_SPRINTF   LV_STDLIB_BUILTIN
#define LV_MEM_SIZE             (256 * 1024)

/* Display refresh period (ms) */
#define LV_DEF_REFR_PERIOD 33

/* Input device read period (ms) */
#define LV_DEF_INDEV_READ_PERIOD 30

/* Logging */
#define LV_USE_LOG 1
#define LV_LOG_LEVEL LV_LOG_LEVEL_WARN
#define LV_LOG_PRINTF 1

/* Fonts — match sdkconfig.defaults exactly */
#define LV_FONT_MONTSERRAT_14 1   /* LVGL default font, always needed */
#define LV_FONT_MONTSERRAT_20 1   /* Status bar, action bar buttons */
#define LV_FONT_MONTSERRAT_28 1   /* Conversation text (smallest) */
#define LV_FONT_MONTSERRAT_30 1   /* Conversation text (default) */
#define LV_FONT_MONTSERRAT_32 1   /* Conversation text */
#define LV_FONT_MONTSERRAT_34 1   /* Conversation text */
#define LV_FONT_MONTSERRAT_36 1   /* Conversation text (largest) */

/* Built-in symbols (used for WiFi, eye, call icons) */
#define LV_USE_FONT_PLACEHOLDER 1

/* SDL display driver */
#define LV_USE_SDL 1
#define LV_SDL_WINDOW_TITLE "Worzel Simulator (368x448)"
#define LV_SDL_MOUSEWHEEL_MODE 0  /* 0 = scroll, 1 = zoom */
#define LV_SDL_INCLUDE_PATH <SDL2/SDL.h>

/* OS abstraction — use pthread on Linux */
#define LV_USE_OS   LV_OS_PTHREAD

/* Widgets used by our UI */
#define LV_USE_LABEL    1
#define LV_USE_BTN      1
#define LV_USE_OBJ      1
#define LV_USE_LINE     1

/* Layout */
#define LV_USE_FLEX     1
#define LV_USE_GRID     0

/* We don't need these for now */
#define LV_BUILD_EXAMPLES 0
#define LV_USE_DEMO_WIDGETS 0
#define LV_USE_DEMO_BENCHMARK 0

/* Theme */
#define LV_USE_THEME_DEFAULT 1

#endif /* LV_CONF_H */
