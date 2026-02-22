import { describe, it, expect } from 'vitest';
import { OpusEncoder, encodeToOpusFrames } from '../../src/utils/opus-encode.js';
import { decodeOpusFrames } from '../../src/utils/opus-decode.js';

/** Generate a sine wave as int16 LE PCM buffer. */
function generateSineWave(
  sampleRate: number,
  durationMs: number,
  frequency = 440,
  amplitude = 16000,
): Buffer {
  const numSamples = Math.round(sampleRate * durationMs / 1000);
  const buf = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
    buf.writeInt16LE(Math.round(sample), i * 2);
  }
  return buf;
}

describe('OpusEncoder', () => {
  it('encodes a single frame to a non-empty Opus packet', () => {
    const encoder = new OpusEncoder({ sampleRate: 24000, channels: 1 });
    try {
      // 60ms at 24kHz = 1440 samples = 2880 bytes
      const pcm = generateSineWave(24000, 60);
      expect(pcm.length).toBe(2880);

      const opusFrame = encoder.encodeFrame(pcm);
      expect(opusFrame.length).toBeGreaterThan(0);
      // Opus at 16kbps, 60ms → typical packet ~120 bytes, always < PCM
      expect(opusFrame.length).toBeLessThan(pcm.length);
    } finally {
      encoder.delete();
    }
  });

  it('encodes multiple frames from a complete buffer', () => {
    const encoder = new OpusEncoder({ sampleRate: 24000, channels: 1 });
    try {
      // 300ms = 5 frames at 60ms each
      const pcm = generateSineWave(24000, 300);
      const frames = encoder.encodeAll(pcm);

      expect(frames.length).toBe(5);
      for (const frame of frames) {
        expect(frame.length).toBeGreaterThan(0);
      }
    } finally {
      encoder.delete();
    }
  });

  it('zero-pads a partial final frame', () => {
    const encoder = new OpusEncoder({ sampleRate: 24000, channels: 1 });
    try {
      // 70ms = 1 full frame (60ms) + 10ms partial
      const pcm = generateSineWave(24000, 70);
      const frames = encoder.encodeAll(pcm);

      expect(frames.length).toBe(2); // 1 full + 1 padded
      for (const frame of frames) {
        expect(frame.length).toBeGreaterThan(0);
      }
    } finally {
      encoder.delete();
    }
  });

  it('reports correct frame size values', () => {
    const encoder = new OpusEncoder({ sampleRate: 24000, channels: 1 });
    try {
      expect(encoder.frameSizeSamples).toBe(1440); // 24000 * 0.06
      expect(encoder.frameSizeBytes).toBe(2880);   // 1440 * 1 * 2
    } finally {
      encoder.delete();
    }
  });

  it('reports correct frame size at 16kHz', () => {
    const encoder = new OpusEncoder({ sampleRate: 16000, channels: 1 });
    try {
      expect(encoder.frameSizeSamples).toBe(960);
      expect(encoder.frameSizeBytes).toBe(1920);
    } finally {
      encoder.delete();
    }
  });

  it('delete() does not throw', () => {
    const encoder = new OpusEncoder({ sampleRate: 24000, channels: 1 });
    expect(() => encoder.delete()).not.toThrow();
  });

  it('returns empty array for empty input', () => {
    const encoder = new OpusEncoder({ sampleRate: 24000, channels: 1 });
    try {
      const frames = encoder.encodeAll(Buffer.alloc(0));
      expect(frames.length).toBe(0);
    } finally {
      encoder.delete();
    }
  });
});

describe('encodeToOpusFrames (convenience)', () => {
  it('encodes a buffer at 24kHz', () => {
    const pcm = generateSineWave(24000, 120); // 2 frames
    const frames = encodeToOpusFrames(pcm, 24000);
    expect(frames.length).toBe(2);
    for (const f of frames) {
      expect(f.length).toBeGreaterThan(0);
    }
  });

  it('encodes a buffer at 16kHz', () => {
    const pcm = generateSineWave(16000, 120); // 2 frames
    const frames = encodeToOpusFrames(pcm, 16000);
    expect(frames.length).toBe(2);
  });
});

describe('Opus round-trip (encode → decode)', () => {
  it('round-trips 16kHz audio through encode and decode', () => {
    // Encode at 16kHz
    const original = generateSineWave(16000, 300, 440); // 5 frames
    const opusFrames = encodeToOpusFrames(original, 16000);
    expect(opusFrames.length).toBe(5);

    // Decode
    const decoded = decodeOpusFrames(opusFrames);

    // Same number of samples (5 frames * 960 samples * 2 bytes)
    expect(decoded.length).toBe(5 * 960 * 2);

    // Decoded audio should have audible content (not all zeros)
    let maxAbs = 0;
    for (let i = 0; i < decoded.length; i += 2) {
      maxAbs = Math.max(maxAbs, Math.abs(decoded.readInt16LE(i)));
    }
    expect(maxAbs).toBeGreaterThan(1000);
  });
});
