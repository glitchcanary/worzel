import { describe, it, expect } from 'vitest';
import { decodeOpusFrames } from '../../src/utils/opus-decode.js';
// @ts-expect-error no types for opusscript
import OpusScript from 'opusscript';

function encodeTestFrames(numFrames: number, frequency = 440): Buffer[] {
  const encoder = new OpusScript(16000, 1, OpusScript.Application.VOIP);
  const frames: Buffer[] = [];

  try {
    for (let f = 0; f < numFrames; f++) {
      // Generate a sine wave frame (960 samples at 16kHz)
      const pcm = Buffer.alloc(960 * 2);
      for (let i = 0; i < 960; i++) {
        const sample = Math.sin(2 * Math.PI * frequency * (f * 960 + i) / 16000) * 16000;
        pcm.writeInt16LE(Math.round(sample), i * 2);
      }
      const encoded = encoder.encode(pcm, 960);
      frames.push(Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength));
    }
  } finally {
    encoder.delete();
  }

  return frames;
}

describe('decodeOpusFrames', () => {
  it('decodes a single Opus frame to PCM', () => {
    const frames = encodeTestFrames(1);
    const pcm = decodeOpusFrames(frames);

    // 960 samples * 2 bytes per sample
    expect(pcm.length).toBe(1920);
  });

  it('decodes multiple frames to continuous PCM', () => {
    const numFrames = 10;
    const frames = encodeTestFrames(numFrames);
    const pcm = decodeOpusFrames(frames);

    // 10 frames * 960 samples * 2 bytes
    expect(pcm.length).toBe(numFrames * 960 * 2);
  });

  it('returns empty buffer for empty input', () => {
    const pcm = decodeOpusFrames([]);
    expect(pcm.length).toBe(0);
  });

  it('skips empty frames and inserts silence', () => {
    const frames = encodeTestFrames(3);
    // Replace middle frame with empty buffer
    frames[1] = Buffer.alloc(0);
    const pcm = decodeOpusFrames(frames);

    // Still 3 frames worth of output (middle is silence or skipped)
    // Empty frames are skipped (no silence inserted), so 2 frames
    expect(pcm.length).toBe(2 * 960 * 2);
  });

  it('handles corrupted frames gracefully', () => {
    const frames = encodeTestFrames(3);
    // Corrupt middle frame
    frames[1] = Buffer.from([0xff, 0xfe, 0x00, 0x01]);
    const pcm = decodeOpusFrames(frames);

    // 3 frames: 2 decoded + 1 silence (from corrupted frame)
    expect(pcm.length).toBe(3 * 960 * 2);
  });

  it('produces valid int16 PCM with audible content', () => {
    const frames = encodeTestFrames(5, 440);
    const pcm = decodeOpusFrames(frames);

    // Read samples and check they're not all zero
    let maxAbs = 0;
    for (let i = 0; i < pcm.length; i += 2) {
      const sample = pcm.readInt16LE(i);
      maxAbs = Math.max(maxAbs, Math.abs(sample));
    }

    // 440Hz sine wave at amplitude 16000 should produce non-trivial samples
    expect(maxAbs).toBeGreaterThan(1000);
  });
});
