/**
 * Board-specific pin definitions for Worzel ESP32 clients.
 *
 * Pin mappings referenced from XiaoZhi ESP32 board configs (MIT license):
 * https://github.com/78/xiaozhi-esp32/tree/main/main/boards/
 *
 * Select board via build_flags: -DBOARD_WAVESHARE_S3_AMOLED_1_8 etc.
 */

#ifndef WORZEL_BOARD_H
#define WORZEL_BOARD_H

#include <driver/gpio.h>

/* ES8311 I2C address (CE pin low on all known boards) */
#define ES8311_I2C_ADDR 0x18

// ============================================================================
// Waveshare ESP32-S3 Touch AMOLED 1.8"
// Dual-core 240MHz, PSRAM, USB-OTG. Best Opus performance.
// ============================================================================
#if defined(BOARD_WAVESHARE_S3_AMOLED_1_8)

#define BOARD_NAME "waveshare-s3-amoled-1.8"
#define BOARD_HAS_DISPLAY 1

/* QSPI display (SH8601 AMOLED, 368x448) */
#define PIN_LCD_QSPI_CLK  GPIO_NUM_11
#define PIN_LCD_QSPI_D0   GPIO_NUM_4
#define PIN_LCD_QSPI_D1   GPIO_NUM_5
#define PIN_LCD_QSPI_D2   GPIO_NUM_6
#define PIN_LCD_QSPI_D3   GPIO_NUM_7
#define PIN_LCD_QSPI_CS   GPIO_NUM_12
#define LCD_H_RES          368
#define LCD_V_RES          448
/* Reset via TCA9554 IO expander (I2C addr 0x20, same bus as ES8311) */
#define LCD_IO_EXPANDER_ADDR  0x20

/* I2S (ES8311 codec) */
#define PIN_I2S_MCLK    GPIO_NUM_16
#define PIN_I2S_WS      GPIO_NUM_45
#define PIN_I2S_BCLK    GPIO_NUM_9
#define PIN_I2S_DIN     GPIO_NUM_10   /* Mic data: codec ADC → ESP32 */
#define PIN_I2S_DOUT    GPIO_NUM_8    /* Speaker data: ESP32 → codec DAC */

/* I2C (ES8311 control) */
#define PIN_I2C_SDA     GPIO_NUM_15
#define PIN_I2C_SCL     GPIO_NUM_14

/* Amplifier enable (NS4150) */
#define PIN_AMP_ENABLE  GPIO_NUM_46

/* Button */
#define PIN_BUTTON      GPIO_NUM_0

/* LED — none on this board */
#define PIN_LED         GPIO_NUM_NC

// ============================================================================
// xmini-c3-v3 (ESP32-C3, RISC-V single core)
// ============================================================================
#elif defined(BOARD_XMINI_C3_V3)

#define BOARD_NAME "xmini-c3-v3"

/* I2S (ES8311 codec) */
#define PIN_I2S_MCLK    GPIO_NUM_8
#define PIN_I2S_WS      GPIO_NUM_5
#define PIN_I2S_BCLK    GPIO_NUM_7
#define PIN_I2S_DIN     GPIO_NUM_6    /* Mic data: codec ADC → ESP32 */
#define PIN_I2S_DOUT    GPIO_NUM_4    /* Speaker data: ESP32 → codec DAC */

/* I2C (ES8311 control) */
#define PIN_I2C_SDA     GPIO_NUM_0
#define PIN_I2C_SCL     GPIO_NUM_1

/* Amplifier enable (NS4150) */
#define PIN_AMP_ENABLE  GPIO_NUM_10

/* Button */
#define PIN_BUTTON      GPIO_NUM_9

/* LED (WS2812) */
#define PIN_LED         GPIO_NUM_2

// ============================================================================
// Waveshare ESP32-C6 LCD 1.69" (WiFi 6, BLE 5.0)
// ============================================================================
#elif defined(BOARD_WAVESHARE_C6_LCD_1_69)

#define BOARD_NAME "waveshare-c6-lcd-1.69"

/* I2S (ES8311 codec) */
#define PIN_I2S_MCLK    GPIO_NUM_19
#define PIN_I2S_WS      GPIO_NUM_22
#define PIN_I2S_BCLK    GPIO_NUM_20
#define PIN_I2S_DIN     GPIO_NUM_21   /* Mic data: codec ADC → ESP32 */
#define PIN_I2S_DOUT    GPIO_NUM_23   /* Speaker data: ESP32 → codec DAC */

/* I2C (ES8311 control) */
#define PIN_I2C_SDA     GPIO_NUM_8
#define PIN_I2C_SCL     GPIO_NUM_7

/* Amplifier enable — not connected on this board */
#define PIN_AMP_ENABLE  GPIO_NUM_NC

/* Button */
#define PIN_BUTTON      GPIO_NUM_9

/* LED — none on this board */
#define PIN_LED         GPIO_NUM_NC

#else
#error "No board selected. Add -DBOARD_xxx to build_flags in platformio.ini"
#endif

#endif /* WORZEL_BOARD_H */
