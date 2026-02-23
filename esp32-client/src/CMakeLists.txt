idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    REQUIRES driver esp_wifi esp_event esp_netif esp_http_client nvs_flash esp_websocket_client micro-opus esp_lcd
)

# Suppress GCC 14 warnings-as-errors in micro-opus (libopus SILK codec).
# These are false positives in heavily fuzz-tested code. See CLAUDE.md security notes.
idf_build_set_property(COMPILE_OPTIONS
    "-Wno-error=maybe-uninitialized;-Wno-error=stringop-overflow;-Wno-error=reorder"
    APPEND)

# Work around GCC 14 ICE (internal compiler error / segfault) in esp_lcd_panel_rgb.c
# during the 'ira' RTL pass. Reducing optimization to -O0 for just that file avoids
# triggering the compiler bug while keeping esp_lcd available for display drivers.
# See: espressif/esp-idf#10568, #12180
idf_component_get_property(lcd_lib esp_lcd COMPONENT_LIB)
set_source_files_properties(
    ${IDF_PATH}/components/esp_lcd/rgb/esp_lcd_panel_rgb.c
    TARGET_DIRECTORY ${lcd_lib}
    PROPERTIES COMPILE_FLAGS "-O0"
)
