// Opus encoder for browser — uses native WebCodecs AudioEncoder API.
// No WASM, no eval(), CSP-safe.
// Falls back to raw PCM passthrough on browsers without AudioEncoder (Safari < 26).

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const FRAME_SIZE = 960; // 60ms @ 16kHz

export class OpusBrowserEncoder {
  constructor() {
    this._encoder = null;
    this._pendingFrames = []; // encoded Opus ArrayBuffers waiting to be drained
    this._buffer = new Int16Array(0); // accumulator for partial PCM frames
    this._frameIndex = 0; // timestamp counter for AudioData
    this._pcmFallback = false; // true if WebCodecs unavailable
    this.ready = false;
  }

  /** 'opus' if WebCodecs available, 'pcm' if fallback. Valid after init(). */
  get format() {
    return this._pcmFallback ? 'pcm' : 'opus';
  }

  /** Initialise the WebCodecs AudioEncoder for Opus, or fall back to PCM */
  async init() {
    if (this.ready) return;

    // Check for WebCodecs AudioEncoder support
    if (typeof AudioEncoder === 'undefined') {
      console.warn('[worzel] WebCodecs AudioEncoder not available — falling back to raw PCM');
      this._pcmFallback = true;
      this.ready = true;
      return;
    }

    try {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'opus',
        sampleRate: SAMPLE_RATE,
        numberOfChannels: CHANNELS,
        bitrate: 16000,
        opus: {
          application: 'voip',
          complexity: 5,
          signal: 'voice',
          usedtx: true,
          frameDuration: 60000, // 60ms in microseconds
          format: 'opus', // raw Opus packets, not Ogg
        },
      });

      if (!support.supported) {
        console.warn('[worzel] Opus AudioEncoder config not supported — falling back to raw PCM');
        this._pcmFallback = true;
        this.ready = true;
        return;
      }
    } catch {
      console.warn('[worzel] AudioEncoder.isConfigSupported failed — falling back to raw PCM');
      this._pcmFallback = true;
      this.ready = true;
      return;
    }

    this._encoder = new AudioEncoder({
      output: (chunk) => {
        const buf = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(buf);
        this._pendingFrames.push(buf);
      },
      error: (e) => {
        console.error('[worzel] Opus encoder error:', e.message);
      },
    });

    this._encoder.configure({
      codec: 'opus',
      sampleRate: SAMPLE_RATE,
      numberOfChannels: CHANNELS,
      bitrate: 16000,
      opus: {
        application: 'voip',
        complexity: 5,
        signal: 'voice',
        usedtx: true,
        frameDuration: 60000,
        format: 'opus',
      },
    });

    this.ready = true;
    this._frameIndex = 0;
    console.log('[worzel] Opus encoder ready (WebCodecs, 16kHz, 60ms frames, 16kbps)');
  }

  /**
   * Feed PCM int16 samples.
   * Opus mode: queues frames for encoding, returns already-encoded packets.
   * PCM fallback: returns raw PCM ArrayBuffers directly.
   */
  encode(pcmInt16Array) {
    if (!this.ready) return [];

    if (this._pcmFallback) {
      // Pass through raw PCM as ArrayBuffer
      return [pcmInt16Array.buffer.slice(
        pcmInt16Array.byteOffset,
        pcmInt16Array.byteOffset + pcmInt16Array.byteLength
      )];
    }

    // Drain any encoded frames that are ready
    const ready = this._pendingFrames;
    this._pendingFrames = [];

    // Append new samples to accumulator
    const combined = new Int16Array(this._buffer.length + pcmInt16Array.length);
    combined.set(this._buffer);
    combined.set(pcmInt16Array, this._buffer.length);

    let offset = 0;
    while (offset + FRAME_SIZE <= combined.length) {
      const frameSamples = combined.slice(offset, offset + FRAME_SIZE);

      // Convert int16 to float32 for AudioData
      const float32 = new Float32Array(FRAME_SIZE);
      for (let i = 0; i < FRAME_SIZE; i++) {
        float32[i] = frameSamples[i] / 32768;
      }

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: SAMPLE_RATE,
        numberOfFrames: FRAME_SIZE,
        numberOfChannels: CHANNELS,
        timestamp: this._frameIndex * FRAME_SIZE * (1_000_000 / SAMPLE_RATE),
        data: float32,
      });

      this._encoder.encode(audioData);
      audioData.close();
      this._frameIndex++;
      offset += FRAME_SIZE;
    }

    this._buffer = combined.slice(offset);
    return ready;
  }

  /** Flush remaining buffered samples and drain encoder */
  async flush() {
    if (!this.ready) return [];

    if (this._pcmFallback) {
      if (this._buffer.length > 0) {
        const buf = this._buffer.buffer.slice(
          this._buffer.byteOffset,
          this._buffer.byteOffset + this._buffer.byteLength
        );
        this._buffer = new Int16Array(0);
        return [buf];
      }
      return [];
    }

    // Pad remaining buffer to a full frame
    if (this._buffer.length > 0) {
      const padded = new Int16Array(FRAME_SIZE);
      padded.set(this._buffer);
      this._buffer = new Int16Array(0);
      this.encode(padded);
    }

    await this._encoder.flush();

    const frames = this._pendingFrames;
    this._pendingFrames = [];
    return frames;
  }

  destroy() {
    if (this._encoder && this._encoder.state !== 'closed') {
      this._encoder.close();
    }
    this._encoder = null;
    this._buffer = new Int16Array(0);
    this._pendingFrames = [];
    this._pcmFallback = false;
    this.ready = false;
  }
}
