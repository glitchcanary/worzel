/**
 * Opus frame encoder for server-side use.
 *
 * Encodes PCM int16 LE audio to raw Opus frames for transport to clients.
 * Uses opusscript (Emscripten/WASM port of libopus).
 *
 * Designed for TTS output: 16kHz mono, 60ms frames (960 samples).
 * The encoder instance is reusable across multiple encode calls —
 * create once per pipeline run, not per packet.
 */

import OpusScript from 'opusscript';

// Opus CTL constants (from opus_defines.h)
const OPUS_SET_SIGNAL = 4024;
const OPUS_SET_DTX = 4016;
const OPUS_SIGNAL_VOICE = 3001;

export interface OpusEncoderOptions {
  sampleRate: 8000 | 12000 | 16000 | 24000 | 48000;
  channels: number;
  bitrate?: number;     // default 16000 (16kbps)
  enableDtx?: boolean;  // default true
}

export class OpusEncoder {
  private readonly encoder: InstanceType<typeof OpusScript>;
  private readonly frameSize: number;  // samples per 60ms frame
  readonly sampleRate: number;
  readonly channels: number;

  constructor(options: OpusEncoderOptions) {
    this.sampleRate = options.sampleRate;
    this.channels = options.channels;
    this.frameSize = Math.round(this.sampleRate * 0.06); // 60ms

    this.encoder = new OpusScript(
      options.sampleRate,
      options.channels,
      OpusScript.Application.VOIP,
    );

    // Configure encoder
    this.encoder.setBitrate(options.bitrate ?? 16000);
    this.encoder.encoderCTL(OPUS_SET_SIGNAL, OPUS_SIGNAL_VOICE);
    if (options.enableDtx !== false) {
      this.encoder.encoderCTL(OPUS_SET_DTX, 1);
    }
  }

  /**
   * Encode a single PCM frame (must be exactly frameSize samples of int16 LE).
   * Returns a Buffer containing the raw Opus packet.
   */
  encodeFrame(pcmFrame: Buffer): Buffer {
    return this.encoder.encode(pcmFrame, this.frameSize);
  }

  /**
   * Encode a complete PCM buffer into an array of Opus frames.
   * The buffer is split into frameSize-sample chunks. The last
   * partial chunk is zero-padded to a full frame.
   */
  encodeAll(pcmBuffer: Buffer): Buffer[] {
    const bytesPerFrame = this.frameSize * this.channels * 2;
    const frames: Buffer[] = [];

    for (let offset = 0; offset < pcmBuffer.length; offset += bytesPerFrame) {
      let frame = pcmBuffer.subarray(offset, offset + bytesPerFrame);

      // Pad last frame if needed
      if (frame.length < bytesPerFrame) {
        const padded = Buffer.alloc(bytesPerFrame);
        frame.copy(padded);
        frame = padded;
      }

      frames.push(this.encodeFrame(frame));
    }

    return frames;
  }

  /** Number of PCM samples per frame (60ms). */
  get frameSizeSamples(): number {
    return this.frameSize;
  }

  /** Number of bytes per PCM frame (int16, mono/stereo). */
  get frameSizeBytes(): number {
    return this.frameSize * this.channels * 2;
  }

  /** Release WASM resources. Must be called when done. */
  delete(): void {
    this.encoder.delete();
  }
}

/**
 * Convenience: encode a full PCM buffer to Opus frames.
 * Creates and destroys the encoder internally.
 * For repeated use, instantiate OpusEncoder directly.
 */
export function encodeToOpusFrames(
  pcmBuffer: Buffer,
  sampleRate: 8000 | 12000 | 16000 | 24000 | 48000 = 16000,
): Buffer[] {
  const encoder = new OpusEncoder({ sampleRate, channels: 1 });
  try {
    return encoder.encodeAll(pcmBuffer);
  } finally {
    encoder.delete();
  }
}
