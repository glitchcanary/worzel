/**
 * Opus frame decoder for server-side use.
 *
 * ESP32 clients send raw Opus frames (60ms each, 960 samples @ 16kHz mono).
 * This decodes them to PCM int16 LE for ASR processing.
 *
 * Uses opusscript (Emscripten/WASM port of libopus).
 */

// opusscript ships as CJS with no types — use require-style import
import OpusScript from 'opusscript';

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const FRAME_SIZE = 960; // 60ms @ 16kHz

/**
 * Decode an array of raw Opus frames to a single PCM buffer.
 *
 * @param opusFrames - Array of Buffers, each containing one Opus frame
 * @returns Combined PCM buffer (int16 LE, 16kHz, mono)
 */
export function decodeOpusFrames(opusFrames: Buffer[]): Buffer {
  const decoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.VOIP);

  try {
    const pcmChunks: Buffer[] = [];

    for (const frame of opusFrames) {
      if (!frame || frame.length === 0) continue;
      try {
        const pcm = decoder.decode(frame);
        if (pcm && pcm.length > 0) {
          pcmChunks.push(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
        }
      } catch {
        // Skip corrupted frames (network loss, etc.)
        // Push silence to maintain timing
        pcmChunks.push(Buffer.alloc(FRAME_SIZE * 2));
      }
    }

    return Buffer.concat(pcmChunks);
  } finally {
    decoder.delete();
  }
}
