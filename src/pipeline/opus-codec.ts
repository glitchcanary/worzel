/**
 * Opus codec wrapper.
 *
 * In Phase 2 we provide a minimal interface. The actual Opus encode/decode
 * depends on which path is active:
 *
 * - WebSocket transport: Server must encode/decode Opus ↔ PCM
 *   (opusscript WASM or @discordjs/opus native)
 * - WebRTC transport: Opus is handled by the RTP layer (no server-side codec needed)
 *
 * For now, we provide pass-through for raw PCM and a stub for Opus.
 * Real Opus codec will be added when opusscript dependency is included.
 */

export interface OpusCodecOptions {
  sampleRate: number;
  channels: number;
  frameDuration: number; // ms
}

/** Number of PCM samples per frame */
export function samplesPerFrame(sampleRate: number, frameDurationMs: number): number {
  return (sampleRate * frameDurationMs) / 1000;
}

/**
 * Minimal codec interface.
 * Real implementation wraps opusscript or @discordjs/opus.
 */
export class OpusCodec {
  readonly sampleRate: number;
  readonly channels: number;
  readonly frameDuration: number;
  readonly frameSize: number;

  constructor(options: OpusCodecOptions) {
    this.sampleRate = options.sampleRate;
    this.channels = options.channels;
    this.frameDuration = options.frameDuration;
    this.frameSize = samplesPerFrame(options.sampleRate, options.frameDuration);
  }

  /**
   * Decode Opus frame to PCM (16-bit signed LE).
   * Stub: returns the input unchanged (assumes raw PCM for testing).
   */
  decode(opusFrame: Buffer): Buffer {
    // TODO: Wire up opusscript when dependency is added
    return opusFrame;
  }

  /**
   * Encode PCM (16-bit signed LE) to Opus frame.
   * Stub: returns the input unchanged (assumes raw PCM for testing).
   */
  encode(pcmFrame: Buffer): Buffer {
    // TODO: Wire up opusscript when dependency is added
    return pcmFrame;
  }
}

/**
 * Split a continuous PCM buffer into fixed-size frames.
 */
export function* splitIntoFrames(pcm: Buffer, frameSizeBytes: number): Generator<Buffer> {
  for (let offset = 0; offset + frameSizeBytes <= pcm.length; offset += frameSizeBytes) {
    yield pcm.subarray(offset, offset + frameSizeBytes);
  }
}
