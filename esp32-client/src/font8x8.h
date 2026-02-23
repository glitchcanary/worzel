/**
 * 8x8 monospace bitmap font — printable ASCII (32-126).
 * Public domain. Each glyph is 8 bytes (one byte per row, LSB = leftmost pixel).
 */

#ifndef FONT8X8_H
#define FONT8X8_H

#include <stdint.h>

extern const uint8_t font8x8_basic[128][8];

#endif
