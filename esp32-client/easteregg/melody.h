/**
 * Startup melody for Worzel — plays through ES8311 DAC + NS4150 amp.
 * A cheerful ascending phrase that doubles as a hardware audio test.
 *
 * Usage: call melody_play(i2s_tx_chan) after I2S is initialized.
 */

#ifndef WORZEL_MELODY_H
#define WORZEL_MELODY_H

#include <math.h>
#include <stdlib.h>
#include "driver/i2s_std.h"

/* Note frequencies (Hz) — equal temperament, A4=440Hz */
#define NOTE_C4   262
#define NOTE_D4   294
#define NOTE_E4   330
#define NOTE_F4   349
#define NOTE_G4   392
#define NOTE_A4   440
#define NOTE_B4   494
#define NOTE_C5   523
#define NOTE_D5   587
#define NOTE_E5   659
#define NOTE_G5   784
#define NOTE_REST 0

/* A note: frequency in Hz, duration in milliseconds */
typedef struct {
    int freq;
    int duration_ms;
} melody_note_t;

/* "Close Encounters" inspired ascending phrase — short and distinctive */
static const melody_note_t startup_melody[] = {
    { NOTE_G4,  200 },
    { NOTE_A4,  200 },
    { NOTE_F4,  200 },
    { NOTE_REST, 50 },
    { NOTE_C4,  300 },
    { NOTE_REST, 80 },
    { NOTE_G4,  150 },
    { NOTE_E5,  350 },
};

#define MELODY_LEN (sizeof(startup_melody) / sizeof(startup_melody[0]))

/**
 * Generate and play the startup melody through I2S.
 * Blocks until playback completes (typically < 2 seconds).
 *
 * @param tx_chan  Enabled I2S TX channel handle
 * @param sample_rate  I2S sample rate (must match channel config)
 */
static inline void melody_play(i2s_chan_handle_t tx_chan, int sample_rate) {
    if (!tx_chan) return;

    for (int n = 0; n < (int)MELODY_LEN; n++) {
        int freq = startup_melody[n].freq;
        int dur_ms = startup_melody[n].duration_ms;
        int num_samples = sample_rate * dur_ms / 1000;

        /* Allocate sample buffer (DMA-capable for I2S) */
        int16_t *buf = heap_caps_malloc(num_samples * sizeof(int16_t), MALLOC_CAP_DMA);
        if (!buf) continue;

        if (freq == NOTE_REST) {
            memset(buf, 0, num_samples * sizeof(int16_t));
        } else {
            /* Sine wave with 5ms fade-in/out to avoid clicks */
            int fade_samples = sample_rate * 5 / 1000;  /* 5ms */
            for (int i = 0; i < num_samples; i++) {
                float t = (float)i / sample_rate;
                float amplitude = 20000.0f;  /* ~61% of full scale */

                /* Fade envelope */
                if (i < fade_samples) {
                    amplitude *= (float)i / fade_samples;
                } else if (i > num_samples - fade_samples) {
                    amplitude *= (float)(num_samples - i) / fade_samples;
                }

                buf[i] = (int16_t)(amplitude * sinf(2.0f * 3.14159265f * freq * t));
            }
        }

        size_t written = 0;
        i2s_channel_write(tx_chan, buf, num_samples * sizeof(int16_t),
                          &written, pdMS_TO_TICKS(dur_ms + 500));
        heap_caps_free(buf);
    }
}

#endif /* WORZEL_MELODY_H */
