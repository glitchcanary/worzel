import { describe, it, expect } from 'vitest';
import { OpusCodec, samplesPerFrame, splitIntoFrames } from '../../../src/pipeline/opus-codec.js';

describe('samplesPerFrame', () => {
  it('calculates correctly for 16kHz 60ms', () => {
    expect(samplesPerFrame(16000, 60)).toBe(960);
  });

  it('calculates correctly for 24kHz 60ms', () => {
    expect(samplesPerFrame(24000, 60)).toBe(1440);
  });

  it('calculates correctly for 16kHz 20ms', () => {
    expect(samplesPerFrame(16000, 20)).toBe(320);
  });
});

describe('OpusCodec', () => {
  it('creates with correct parameters', () => {
    const codec = new OpusCodec({
      sampleRate: 16000,
      channels: 1,
      frameDuration: 60,
    });
    expect(codec.sampleRate).toBe(16000);
    expect(codec.channels).toBe(1);
    expect(codec.frameDuration).toBe(60);
    expect(codec.frameSize).toBe(960);
  });

  it('stub encode/decode pass through', () => {
    const codec = new OpusCodec({ sampleRate: 16000, channels: 1, frameDuration: 60 });
    const input = Buffer.from([1, 2, 3, 4]);
    expect(codec.encode(input)).toBe(input);
    expect(codec.decode(input)).toBe(input);
  });
});

describe('splitIntoFrames', () => {
  it('splits buffer into correct-sized frames', () => {
    const pcm = Buffer.alloc(1920 * 2); // 2 frames worth of 16-bit samples (960 * 2 bytes each)
    const frameSizeBytes = 960 * 2; // 960 samples * 2 bytes
    const frames = [...splitIntoFrames(pcm, frameSizeBytes)];
    expect(frames).toHaveLength(2);
    expect(frames[0]!.length).toBe(frameSizeBytes);
  });

  it('discards incomplete trailing frame', () => {
    const pcm = Buffer.alloc(1920 * 2 + 100); // 2 full frames + partial
    const frameSizeBytes = 960 * 2;
    const frames = [...splitIntoFrames(pcm, frameSizeBytes)];
    expect(frames).toHaveLength(2);
  });

  it('returns empty for buffer smaller than one frame', () => {
    const pcm = Buffer.alloc(100);
    const frames = [...splitIntoFrames(pcm, 1920)];
    expect(frames).toHaveLength(0);
  });
});
