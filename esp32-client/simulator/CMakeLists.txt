cmake_minimum_required(VERSION 3.16)
project(worzel_sim C CXX)

set(CMAKE_C_STANDARD 99)

# LVGL source (from PlatformIO managed_components, already downloaded)
set(LVGL_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../managed_components/lvgl__lvgl)

if(NOT EXISTS ${LVGL_DIR}/lvgl.h)
    message(FATAL_ERROR
        "LVGL not found at ${LVGL_DIR}\n"
        "Run 'cd ../esp32-client && pio run -e esp32s3-amoled' first to download components.")
endif()

# Point LVGL at our lv_conf.h
set(LV_BUILD_CONF_PATH ${CMAKE_CURRENT_SOURCE_DIR}/lv_conf.h CACHE PATH "" FORCE)

# Skip demos/examples (we don't need them)
set(CONFIG_LV_BUILD_DEMOS OFF CACHE BOOL "" FORCE)
set(CONFIG_LV_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)

# Build LVGL as a library (uses its own CMakeLists.txt → os_desktop.cmake)
add_subdirectory(${LVGL_DIR} ${CMAKE_CURRENT_BINARY_DIR}/lvgl)

# Find SDL2
find_package(PkgConfig REQUIRED)
pkg_check_modules(SDL2 REQUIRED sdl2)

# Simulator executable
add_executable(worzel_sim
    sim_main.c
    sim_ui.c
)

target_include_directories(worzel_sim PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${SDL2_INCLUDE_DIRS}
)

target_link_libraries(worzel_sim PRIVATE
    lvgl
    ${SDL2_LIBRARIES}
    pthread
    m
)

target_compile_options(worzel_sim PRIVATE -Wall -Wextra -Wno-unused-parameter)
