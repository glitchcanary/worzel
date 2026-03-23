# Two build modes: voice client (default) and story player (STORY_PLAYER_MODE=1).
# The story player uses a separate set of source files and fewer dependencies.
if(STORY_PLAYER_MODE)
    # --- WASM3 runtime (built as static library from source) ---
    # wasm3 source lives in lib/wasm3/ (not components/) to avoid ESP-IDF component scan.
    set(WASM3_SRC "${CMAKE_CURRENT_LIST_DIR}/../lib/wasm3")
    if(EXISTS "${WASM3_SRC}/m3_core.c")
        idf_build_get_property(build_dir BUILD_DIR)
        add_subdirectory("${WASM3_SRC}" "${build_dir}/m3")
        # Give wasm3 access to ESP-IDF system headers and suppress warnings
        idf_component_get_property(esp_system_dir esp_system COMPONENT_DIR)
        idf_component_get_property(freertos_dir freertos COMPONENT_DIR)
        idf_component_get_property(newlib_dir newlib COMPONENT_DIR)
        idf_component_get_property(esp_common_dir esp_common COMPONENT_DIR)
        idf_component_get_property(esp_rom_dir esp_rom COMPONENT_DIR)
        idf_component_get_property(esp_hw_support_dir esp_hw_support COMPONENT_DIR)
        idf_component_get_property(soc_dir soc COMPONENT_DIR)
        idf_component_get_property(xtensa_dir xtensa COMPONENT_DIR)
        idf_component_get_property(hal_dir hal COMPONENT_DIR)
        target_include_directories(m3 PRIVATE
            "${esp_system_dir}/include"
            "${freertos_dir}/FreeRTOS-Kernel/include"
            "${freertos_dir}/config/include/freertos"
            "${freertos_dir}/FreeRTOS-Kernel/portable/xtensa/include"
            "${newlib_dir}/platform_include"
            "${esp_common_dir}/include"
            "${esp_rom_dir}/include"
            "${esp_hw_support_dir}/include"
            "${soc_dir}/${IDF_TARGET}/include"
            "${soc_dir}/include"
            "${xtensa_dir}/include"
            "${hal_dir}/include"
            "${build_dir}/config"
        )
        target_compile_options(m3 PUBLIC -DESP32 -O3 -Wno-error)
    else()
        message(WARNING "WASM3 source not found at ${WASM3_SRC} — ink_host will use stub only")
    endif()

    idf_component_register(
        SRCS "story-player/main.c"
             "story-player/ink_host.c"
             "story-player/story_nav.c"
             "story-player/story_ui.c"
             "story-player/audio_player.c"
             "display.c"
             "display_bitmap.c"
             "font8x8.c"
        INCLUDE_DIRS "." "story-player" "${WASM3_SRC}"
        REQUIRES driver nvs_flash micro-opus esp_lcd esp_io_expander_tca9554 lvgl esp_lcd_touch_ft5x06 spiffs esp_partition
    )

    # Link WASM3 into the main component
    if(TARGET m3)
        target_link_libraries(${COMPONENT_LIB} PRIVATE m3)
    endif()
else()
    idf_component_register(
        SRCS "main.c" "display.c" "display_bitmap.c" "font8x8.c"
        INCLUDE_DIRS "."
        REQUIRES driver esp_wifi esp_event esp_netif esp_http_client nvs_flash esp_websocket_client micro-opus esp_lcd esp_io_expander_tca9554 lvgl esp_lcd_touch_ft5x06
    )
endif()

# Note: micro-opus hardcodes floating-point for ESP32-S3 (has hardware FPU).
# Cannot override to fixed-point via compile defines — source file selection
# happens in the component's CMakeLists.txt at configure time.

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
