/**
 * Worzel LVGL Desktop Simulator
 *
 * Renders the exact ESP32-S3 AMOLED UI (368x448) in an SDL2 window.
 * Mouse acts as touch input. Keyboard shortcuts for testing:
 *
 *   1-5  — Simulate conversation messages (user/assistant alternating)
 *   w    — Toggle WiFi status icon (green/red)
 *   a    — Toggle Auth status icon
 *   s    — Toggle WebSocket status icon
 *   c    — Clear conversation
 *   q    — Quit
 *
 * IMPORTANT: We do NOT call SDL_PollEvent() ourselves. LVGL's SDL driver
 * runs its own event loop inside lv_timer_handler() (sdl_event_handler timer,
 * 5ms period) which dispatches to mouse/keyboard/window handlers. If we
 * consumed events first, LVGL would never see mouse clicks or key presses.
 *
 * Instead, keyboard shortcuts are polled via SDL_GetKeyboardState() in an
 * LVGL timer callback, and SDL_QUIT is checked via SDL_QuitRequested().
 */

#include "sim_ui.h"
#include "lvgl.h"
#include <SDL2/SDL.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

/* Sample conversation for testing */
static const char *sample_messages[] = {
    "> What's the weather like today?",
    "< It's currently 12 degrees and partly cloudy in London. Expected to warm up to 15 by afternoon.",
    "> Can you tell me a joke?",
    "< Why do programmers prefer dark mode? Because light attracts bugs!",
    "> What time is it in Tokyo?",
    "< It's currently 2:30 AM in Tokyo (JST, UTC+9). Probably not the best time to call!",
    "> Tell me about the ESP32-S3",
    "< The ESP32-S3 is a dual-core Xtensa LX7 MCU at 240MHz with WiFi and BLE 5.0. It has up to 8MB PSRAM and hardware vector instructions for AI workloads.",
    "> How do I make sourdough bread?",
    "< Start with a fed starter, mix with flour and water, autolyse for 30 min, add salt, do stretch-and-folds every 30 min for 2 hours, then bulk ferment 4-6 hours.",
};
#define SAMPLE_COUNT (sizeof(sample_messages) / sizeof(sample_messages[0]))
static int sample_idx = 0;

/* Status icon toggle state */
static int wifi_on = 0, auth_on = 0, ws_on = 0;

/* Flag set when quit is requested */
static volatile int quit_requested = 0;

/* Track key state to detect edges (pressed this frame, not held) */
static uint8_t prev_keys[SDL_NUM_SCANCODES] = {0};

/**
 * LVGL timer callback: poll keyboard state for our shortcuts.
 * Runs every 50ms. Detects key-down edges (transition from not-pressed to pressed)
 * so holding a key doesn't repeat.
 */
static void keyboard_shortcut_cb(lv_timer_t *timer) {
    (void)timer;

    if (SDL_QuitRequested()) {
        quit_requested = 1;
        return;
    }

    const uint8_t *keys = SDL_GetKeyboardState(NULL);

    /* Helper macro: detect key-down edge */
    #define KEY_PRESSED(sc) (keys[sc] && !prev_keys[sc])

    if (KEY_PRESSED(SDL_SCANCODE_Q) || KEY_PRESSED(SDL_SCANCODE_ESCAPE)) {
        quit_requested = 1;
    }

    /* Number keys: add sample messages */
    for (int n = 1; n <= 5; n++) {
        if (KEY_PRESSED(SDL_SCANCODE_1 + (n - 1))) {
            for (int i = 0; i < n; i++) {
                uint16_t color = (sample_messages[sample_idx][0] == '>')
                    ? COLOR_CYAN : COLOR_WHITE;
                sim_display_conversation(sample_messages[sample_idx], color);
                sample_idx = (sample_idx + 1) % SAMPLE_COUNT;
            }
        }
    }

    if (KEY_PRESSED(SDL_SCANCODE_W)) {
        wifi_on = !wifi_on;
        sim_display_status(2, "WiFi", wifi_on ? COLOR_GREEN : COLOR_RED);
        printf("[SIM] WiFi: %s\n", wifi_on ? "connected" : "disconnected");
    }
    if (KEY_PRESSED(SDL_SCANCODE_A)) {
        auth_on = !auth_on;
        sim_display_status(4, "Auth", auth_on ? COLOR_GREEN : COLOR_RED);
        printf("[SIM] Auth: %s\n", auth_on ? "authenticated" : "unauthenticated");
    }
    if (KEY_PRESSED(SDL_SCANCODE_S)) {
        ws_on = !ws_on;
        sim_display_status(5, "WS", ws_on ? COLOR_GREEN : COLOR_RED);
        printf("[SIM] WebSocket: %s\n", ws_on ? "connected" : "disconnected");
    }
    if (KEY_PRESSED(SDL_SCANCODE_C)) {
        sim_display_clear();
        printf("[SIM] Conversation cleared\n");
    }

    #undef KEY_PRESSED

    /* Save current state for next frame's edge detection */
    memcpy(prev_keys, keys, SDL_NUM_SCANCODES);
}

int main(int argc, char *argv[]) {
    (void)argc; (void)argv;

    /* Initialize LVGL */
    lv_init();

    /* Create SDL display (exact hardware dimensions) */
    lv_display_t *disp = lv_sdl_window_create(LCD_H_RES, LCD_V_RES);
    if (!disp) {
        fprintf(stderr, "Failed to create SDL display\n");
        return 1;
    }

    /* Create mouse input (simulates touch) */
    lv_indev_t *mouse = lv_sdl_mouse_create();
    (void)mouse;

    /* Build the Worzel UI */
    sim_build_ui();

    /* Show initial welcome text */
    sim_display_conversation("Worzel simulator ready.", COLOR_CYAN);
    sim_display_conversation("Click buttons or press 1-5 for messages.", COLOR_GREY);

    /* Register keyboard shortcut polling timer (50ms = 20Hz, plenty for shortcuts) */
    lv_timer_create(keyboard_shortcut_cb, 50, NULL);

    printf("\n");
    printf("=== Worzel LVGL Simulator ===\n");
    printf("  Window: %dx%d (matches ESP32-S3 AMOLED)\n", LCD_H_RES, LCD_V_RES);
    printf("  Mouse = touch input\n");
    printf("  Keys: 1-5=messages, w/a/s=status icons, c=clear, q=quit\n");
    printf("\n");

    /* Main loop — LVGL handles all SDL events internally */
    while (!quit_requested) {
        lv_timer_handler();
        usleep(5000);  /* 5ms = 200Hz */
    }

    printf("[SIM] Shutting down\n");
    lv_deinit();
    SDL_Quit();
    return 0;
}
