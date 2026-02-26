/**
 * Worzel UI — clean LVGL 9.x implementation.
 *
 * Standard flex column layout: status bar → conversation → action bar.
 * Uses LVGL's built-in scrolling for conversation text. No z-order tricks,
 * no manual text trimming, no direct-screen-child workarounds.
 *
 * Designed to be identical between simulator and ESP32 hardware.
 */

#include "sim_ui.h"
#include "lvgl.h"

#include <string.h>
#include <stdio.h>
#include <time.h>

/* LVGL UI elements */
static lv_obj_t *status_bar = NULL;
static lv_obj_t *lbl_time = NULL;
static lv_obj_t *lbl_icon_wifi = NULL;
static lv_obj_t *lbl_icon_auth = NULL;
static lv_obj_t *lbl_icon_ws   = NULL;
static lv_obj_t *convo_container = NULL;   /* scrollable container */
static lv_obj_t *convo_label = NULL;       /* single label inside container */
static char convo_buf[4096] = "";
static lv_obj_t *action_bar = NULL;
static lv_obj_t *btn_talk = NULL;
static lv_obj_t *btn_toggle = NULL;
static lv_obj_t *btn_more = NULL;

/* UI state */
typedef enum { UI_NORMAL, UI_MENU } ui_state_t;
static ui_state_t ui_state = UI_NORMAL;
static volatile int hot_mic = 0;

#define STATUS_BAR_H  48
#define ACTION_BAR_H  100

/* ---- Font size cycling ---- */

static const lv_font_t *font_sizes[] = {
#if LV_FONT_MONTSERRAT_28
    &lv_font_montserrat_28,
#endif
#if LV_FONT_MONTSERRAT_30
    &lv_font_montserrat_30,
#endif
#if LV_FONT_MONTSERRAT_32
    &lv_font_montserrat_32,
#endif
#if LV_FONT_MONTSERRAT_34
    &lv_font_montserrat_34,
#endif
#if LV_FONT_MONTSERRAT_36
    &lv_font_montserrat_36,
#endif
};
#define FONT_COUNT (sizeof(font_sizes) / sizeof(font_sizes[0]))
static int font_idx = 0;

/* Map RGB565 color codes to lv_color_t */
static lv_color_t map_color(uint16_t color) {
    if (color == COLOR_GREEN)  return lv_color_make(0x70, 0xD0, 0x70);
    if (color == COLOR_CYAN)   return lv_color_make(0x80, 0xC8, 0xFF);
    if (color == COLOR_YELLOW) return lv_color_make(0xE0, 0xD0, 0x40);
    if (color == COLOR_RED)    return lv_color_make(0xE0, 0x50, 0x50);
    if (color == COLOR_WHITE)  return lv_color_make(0xEE, 0xEE, 0xEE);
    if (color == COLOR_GREY)   return lv_color_make(0x99, 0x99, 0x99);
    return lv_color_make(0xDD, 0xDD, 0xDD);
}

/* Button callbacks */
static void btn_talk_cb(lv_event_t *e) {
    (void)e;
    printf("[SIM] Talk button pressed\n");
}

static void btn_toggle_cb(lv_event_t *e) {
    (void)e;
    hot_mic = !hot_mic;
    printf("[SIM] Hot mic %s\n", hot_mic ? "ON" : "OFF");
    if (btn_toggle) {
        lv_obj_set_style_bg_color(btn_toggle,
            hot_mic ? lv_color_make(0xA0, 0x30, 0x30) : lv_color_make(40, 40, 55), 0);
    }
}

static void font_increase(void) {
    if (FONT_COUNT <= 1) return;
    if (font_idx < (int)FONT_COUNT - 1) font_idx++;
    printf("[SIM] Font size: index %d\n", font_idx);
    if (convo_label)
        lv_obj_set_style_text_font(convo_label, font_sizes[font_idx], 0);
}

static void font_decrease(void) {
    if (FONT_COUNT <= 1) return;
    if (font_idx > 0) font_idx--;
    printf("[SIM] Font size: index %d\n", font_idx);
    if (convo_label)
        lv_obj_set_style_text_font(convo_label, font_sizes[font_idx], 0);
}

/* Menu */
static lv_obj_t *menu_panel = NULL;
static void show_menu(void);
static void hide_menu(void);

static void btn_more_cb(lv_event_t *e) {
    (void)e;
    if (ui_state == UI_NORMAL) show_menu();
    else hide_menu();
}

static void menu_item_cb(lv_event_t *e) {
    const char *item = (const char *)lv_event_get_user_data(e);
    if (!item) return;
    if (strcmp(item, "font+") == 0) font_increase();
    else if (strcmp(item, "font-") == 0) font_decrease();
    else if (strcmp(item, "about") == 0) printf("[SIM] About: Worzel\n");
    else if (strncmp(item, "back", 4) == 0) hide_menu();
}

static void show_menu(void) {
    if (!convo_container) return;
    ui_state = UI_MENU;

    /* Hide conversation, show menu in its place */
    lv_obj_add_flag(convo_container, LV_OBJ_FLAG_HIDDEN);

    /* Create menu as a child of the screen's flex layout would disrupt it,
     * so create inside the (hidden) convo_container's parent at same position.
     * Simpler: just create a panel that replaces convo visually. */
    lv_obj_t *parent = lv_obj_get_parent(convo_container);
    menu_panel = lv_obj_create(parent);
    lv_obj_remove_style_all(menu_panel);
    lv_obj_set_width(menu_panel, lv_pct(100));
    lv_obj_set_flex_grow(menu_panel, 1);
    lv_obj_set_style_bg_color(menu_panel, lv_color_make(10, 10, 15), 0);
    lv_obj_set_style_bg_opa(menu_panel, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_all(menu_panel, 16, 0);
    lv_obj_remove_flag(menu_panel, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_flex_flow(menu_panel, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(menu_panel, LV_FLEX_ALIGN_START,
                          LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);

    /* Move menu_panel to be right after convo_container in the flex order */
    lv_obj_move_to_index(menu_panel, lv_obj_get_index(convo_container) + 1);

    static const char *items[] = {"about", "font+", "font-", "back " LV_SYMBOL_LEFT};
    for (int i = 0; i < 4; i++) {
        lv_obj_t *lbl = lv_label_create(menu_panel);
        lv_label_set_text(lbl, items[i]);
        lv_obj_set_style_text_color(lbl, lv_color_make(0xEE, 0xEE, 0xEE), 0);
        lv_obj_set_style_text_font(lbl, &lv_font_montserrat_28, 0);
        lv_obj_set_style_pad_bottom(lbl, 20, 0);
        lv_obj_add_flag(lbl, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_add_event_cb(lbl, menu_item_cb, LV_EVENT_CLICKED, (void*)(items[i]));
    }

    if (btn_more) {
        lv_obj_t *lbl = lv_obj_get_child(btn_more, 0);
        if (lbl) lv_label_set_text(lbl, "Back");
    }
}

static void hide_menu(void) {
    ui_state = UI_NORMAL;
    if (menu_panel) {
        lv_obj_delete(menu_panel);
        menu_panel = NULL;
    }
    if (convo_container) {
        lv_obj_remove_flag(convo_container, LV_OBJ_FLAG_HIDDEN);
    }
    if (btn_more) {
        lv_obj_t *lbl = lv_obj_get_child(btn_more, 0);
        if (lbl) lv_label_set_text(lbl, "More");
    }
}

/* Clock update */
static void clock_update_cb(lv_timer_t *timer) {
    (void)timer;
    if (!lbl_time) return;
    time_t now;
    time(&now);
    struct tm ti;
    localtime_r(&now, &ti);
    char buf[20];
    strftime(buf, sizeof(buf), "%H:%M", &ti);
    lv_label_set_text(lbl_time, buf);
}

/* ---- Public API ---- */

void sim_build_ui(void) {
    lv_obj_t *scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_all(scr, 0, 0);

    /* Screen is a vertical flex column: status | convo | action */
    lv_obj_set_flex_flow(scr, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(scr, LV_FLEX_ALIGN_START,
                          LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(scr, 0, 0);
    lv_obj_set_style_pad_column(scr, 0, 0);

    lv_color_t bar_bg = lv_color_make(20, 20, 30);

    /* ---- Status bar (fixed height) ---- */
    status_bar = lv_obj_create(scr);
    lv_obj_remove_style_all(status_bar);
    lv_obj_set_width(status_bar, lv_pct(100));
    lv_obj_set_height(status_bar, STATUS_BAR_H);
    lv_obj_set_style_bg_color(status_bar, bar_bg, 0);
    lv_obj_set_style_bg_opa(status_bar, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_left(status_bar, 8, 0);
    lv_obj_set_style_pad_right(status_bar, 8, 0);
    lv_obj_remove_flag(status_bar, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_flex_flow(status_bar, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(status_bar, LV_FLEX_ALIGN_SPACE_BETWEEN,
                          LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    /* DateTime */
    lbl_time = lv_label_create(status_bar);
    lv_label_set_text(lbl_time, "--:--");
    lv_obj_set_style_text_color(lbl_time, lv_color_make(0x99, 0x99, 0x99), 0);
    lv_obj_set_style_text_font(lbl_time, &lv_font_montserrat_20, 0);

    /* Status icons */
    lv_color_t icon_off = lv_color_make(0x55, 0x55, 0x55);

    lbl_icon_wifi = lv_label_create(status_bar);
    lv_label_set_text(lbl_icon_wifi, LV_SYMBOL_WIFI);
    lv_obj_set_style_text_color(lbl_icon_wifi, icon_off, 0);
    lv_obj_set_style_text_font(lbl_icon_wifi, &lv_font_montserrat_28, 0);

    lbl_icon_auth = lv_label_create(status_bar);
    lv_label_set_text(lbl_icon_auth, LV_SYMBOL_EYE_OPEN);
    lv_obj_set_style_text_color(lbl_icon_auth, icon_off, 0);
    lv_obj_set_style_text_font(lbl_icon_auth, &lv_font_montserrat_28, 0);
    lv_obj_set_style_pad_left(lbl_icon_auth, 6, 0);

    lbl_icon_ws = lv_label_create(status_bar);
    lv_label_set_text(lbl_icon_ws, LV_SYMBOL_CALL);
    lv_obj_set_style_text_color(lbl_icon_ws, icon_off, 0);
    lv_obj_set_style_text_font(lbl_icon_ws, &lv_font_montserrat_28, 0);
    lv_obj_set_style_pad_left(lbl_icon_ws, 6, 0);

    /* ---- Conversation area (flex-grow, scrollable) ---- */
    convo_container = lv_obj_create(scr);
    lv_obj_remove_style_all(convo_container);
    lv_obj_set_width(convo_container, lv_pct(100));
    lv_obj_set_flex_grow(convo_container, 1);  /* fill remaining space */
    lv_obj_set_style_bg_color(convo_container, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(convo_container, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_all(convo_container, 8, 0);
    lv_obj_set_style_pad_top(convo_container, 4, 0);
    lv_obj_set_style_border_width(convo_container, 0, 0);
    lv_obj_set_style_radius(convo_container, 0, 0);
    /* Enable vertical scroll, hide scrollbar */
    lv_obj_set_scrollbar_mode(convo_container, LV_SCROLLBAR_MODE_OFF);
    lv_obj_add_flag(convo_container, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scroll_dir(convo_container, LV_DIR_VER);

    /* Single label for all conversation text */
    convo_label = lv_label_create(convo_container);
    lv_label_set_text(convo_label, "");
    lv_obj_set_width(convo_label, lv_pct(100));
    lv_label_set_long_mode(convo_label, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_color(convo_label, lv_color_make(0xDD, 0xDD, 0xDD), 0);
    if (FONT_COUNT > 0 && font_idx < (int)FONT_COUNT) {
        lv_obj_set_style_text_font(convo_label, font_sizes[font_idx], 0);
    } else {
        lv_obj_set_style_text_font(convo_label, &lv_font_montserrat_14, 0);
    }

    /* ---- Action bar (fixed height) ---- */
    action_bar = lv_obj_create(scr);
    lv_obj_remove_style_all(action_bar);
    lv_obj_set_width(action_bar, lv_pct(100));
    lv_obj_set_height(action_bar, ACTION_BAR_H);
    lv_obj_set_style_bg_color(action_bar, bar_bg, 0);
    lv_obj_set_style_bg_opa(action_bar, LV_OPA_COVER, 0);
    lv_obj_remove_flag(action_bar, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_flex_flow(action_bar, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(action_bar, LV_FLEX_ALIGN_SPACE_EVENLY,
                          LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    /* Buttons with proper touch targets */
    lv_color_t btn_bg = lv_color_make(40, 40, 55);
    lv_color_t btn_text = lv_color_make(0xEE, 0xEE, 0xEE);
    int btn_w = (LCD_H_RES - 40) / 3;
    int btn_h = ACTION_BAR_H - 16;

    btn_talk = lv_btn_create(action_bar);
    lv_obj_set_size(btn_talk, btn_w, btn_h);
    lv_obj_set_style_bg_color(btn_talk, btn_bg, 0);
    lv_obj_set_style_bg_color(btn_talk, lv_color_make(60, 60, 80), LV_STATE_PRESSED);
    lv_obj_set_style_radius(btn_talk, 8, 0);
    lv_obj_add_event_cb(btn_talk, btn_talk_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t *lbl_talk = lv_label_create(btn_talk);
    lv_label_set_text(lbl_talk, "Talk");
    lv_obj_set_style_text_color(lbl_talk, btn_text, 0);
    lv_obj_set_style_text_font(lbl_talk, &lv_font_montserrat_28, 0);
    lv_obj_center(lbl_talk);

    btn_toggle = lv_btn_create(action_bar);
    lv_obj_set_size(btn_toggle, btn_w, btn_h);
    lv_obj_set_style_bg_color(btn_toggle, btn_bg, 0);
    lv_obj_set_style_bg_color(btn_toggle, lv_color_make(60, 60, 80), LV_STATE_PRESSED);
    lv_obj_set_style_radius(btn_toggle, 8, 0);
    lv_obj_add_event_cb(btn_toggle, btn_toggle_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t *lbl_toggle = lv_label_create(btn_toggle);
    lv_label_set_text(lbl_toggle, "Toggle");
    lv_obj_set_style_text_color(lbl_toggle, btn_text, 0);
    lv_obj_set_style_text_font(lbl_toggle, &lv_font_montserrat_28, 0);
    lv_obj_center(lbl_toggle);

    btn_more = lv_btn_create(action_bar);
    lv_obj_set_size(btn_more, btn_w, btn_h);
    lv_obj_set_style_bg_color(btn_more, btn_bg, 0);
    lv_obj_set_style_bg_color(btn_more, lv_color_make(60, 60, 80), LV_STATE_PRESSED);
    lv_obj_set_style_radius(btn_more, 8, 0);
    lv_obj_add_event_cb(btn_more, btn_more_cb, LV_EVENT_CLICKED, NULL);
    lv_obj_t *lbl_more = lv_label_create(btn_more);
    lv_label_set_text(lbl_more, "More");
    lv_obj_set_style_text_color(lbl_more, btn_text, 0);
    lv_obj_set_style_text_font(lbl_more, &lv_font_montserrat_28, 0);
    lv_obj_center(lbl_more);

    /* Start clock timer */
    lv_timer_create(clock_update_cb, 10000, NULL);
    clock_update_cb(NULL);
}

void sim_display_status(int slot, const char *text, uint16_t color) {
    if (!status_bar) return;
    (void)text;

    lv_color_t c = map_color(color);
    switch (slot) {
    case 2: if (lbl_icon_wifi) lv_obj_set_style_text_color(lbl_icon_wifi, c, 0); break;
    case 4: if (lbl_icon_auth) lv_obj_set_style_text_color(lbl_icon_auth, c, 0); break;
    case 5: if (lbl_icon_ws)   lv_obj_set_style_text_color(lbl_icon_ws,   c, 0); break;
    default: break;
    }
}

void sim_display_conversation(const char *text, uint16_t color) {
    if (!convo_label || !convo_container || !text || !text[0]) return;
    (void)color;

    /* Append to buffer */
    size_t cur_len = strlen(convo_buf);
    size_t add_len = strlen(text);
    if (cur_len + add_len + 2 >= sizeof(convo_buf)) {
        /* Buffer full — drop oldest half */
        size_t half = sizeof(convo_buf) / 2;
        char *nl = strchr(convo_buf + half, '\n');
        if (nl) {
            size_t keep = strlen(nl + 1);
            memmove(convo_buf, nl + 1, keep + 1);
        } else {
            convo_buf[0] = '\0';
        }
        cur_len = strlen(convo_buf);
    }
    if (cur_len > 0) {
        convo_buf[cur_len++] = '\n';
    }
    memcpy(convo_buf + cur_len, text, add_len + 1);

    /* Set text and auto-scroll to bottom */
    lv_label_set_text(convo_label, convo_buf);
    lv_obj_scroll_to_y(convo_container, LV_COORD_MAX, LV_ANIM_OFF);
}

void sim_display_clear(void) {
    if (!convo_label) return;
    convo_buf[0] = '\0';
    lv_label_set_text(convo_label, "");
}
