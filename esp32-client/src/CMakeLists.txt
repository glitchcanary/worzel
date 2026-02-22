idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    REQUIRES driver esp_wifi esp_event esp_netif esp_http_client nvs_flash esp_websocket_client micro-opus
)

# Suppress GCC 14 warnings-as-errors in micro-opus (libopus SILK codec).
# These are false positives in heavily fuzz-tested code. See CLAUDE.md security notes.
idf_build_set_property(COMPILE_OPTIONS
    "-Wno-error=maybe-uninitialized;-Wno-error=stringop-overflow;-Wno-error=reorder"
    APPEND)
