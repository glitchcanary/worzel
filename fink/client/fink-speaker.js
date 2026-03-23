// FinkSpeaker — bus service that decodes and plays audio.
// Subscribes to `audio_frame` and `tts` topics.
// Adapted from AudioPlayer + OpusBrowserDecoder in fink.js.
//
// Handles browser autoplay policy: buffers audio until user clicks,
// then replays buffered frames and plays live from that point.

export class FinkSpeaker {
  #bus;
  #unsubs = [];
  #ctx = null;
  #gain = null;
  #nextTime = 0;
  #sources = [];
  #decoder = null;
  #sampleRate = 16000;
  #fadeTimer = null;
  #unlocked = false;
  #pendingFrames = [];   // buffered until user gesture
  #unlockHandler = null;

  constructor(bus) {
    this.#bus = bus;
    this.#initDecoder();

    this.#unsubs.push(
      bus.subscribe('audio_frame', (data) => this.#onAudioFrame(data)),
      bus.subscribe('tts', (data) => this.#onTts(data)),
    );

    // Listen for any user gesture to unlock audio
    this.#unlockHandler = () => this.#unlock();
    document.addEventListener('click', this.#unlockHandler, { once: true });
    document.addEventListener('keydown', this.#unlockHandler, { once: true });
  }

  #unlock() {
    if (this.#unlocked) return;
    this.#unlocked = true;
    console.log('[fink-speaker] audio unlocked by user gesture');
    // Remove the other listener
    document.removeEventListener('click', this.#unlockHandler);
    document.removeEventListener('keydown', this.#unlockHandler);
    // Create and resume AudioContext during user gesture — Chrome requires this
    if (!this.#ctx) {
      this.#ctx = new AudioContext({ sampleRate: this.#sampleRate });
      this.#nextTime = 0;
    }
    if (this.#ctx.state === 'suspended') this.#ctx.resume();
    // Replay any buffered frames that arrived before the gesture
    const pending = this.#pendingFrames;
    this.#pendingFrames = [];
    for (const frame of pending) this.#enqueueAuto(frame);
  }

  #onAudioFrame(data) {
    if (!this.#unlocked) {
      // Buffer frames until user gesture unlocks audio
      this.#pendingFrames.push(data);
      return;
    }
    this.#enqueueAuto(data);
  }

  #initDecoder() {
    if (typeof AudioDecoder === 'undefined') return;
    this.#decoder = new AudioDecoder({
      output: (audioData) => {
        const rate = audioData.sampleRate;
        if (rate && rate !== this.#sampleRate) {
          this.#sampleRate = rate;
          if (this.#ctx) { this.#ctx.close(); this.#ctx = null; this.#nextTime = 0; }
        }
        const float32 = new Float32Array(audioData.numberOfFrames);
        audioData.copyTo(float32, { planeIndex: 0 });
        audioData.close();
        this.#playFloat32(float32);
      },
      error: (e) => console.error('[fink-speaker] decode error:', e.message),
    });
    this.#decoder.configure({ codec: 'opus', sampleRate: this.#sampleRate, numberOfChannels: 1 });
    this.#decoderTimestamp = 0;
  }

  #decoderTimestamp = 0;

  #enqueueAuto(buf) {
    if (!buf || buf.byteLength === 0) return;
    console.debug('[fink-speaker] audio_frame received, bytes:', buf.byteLength);
    // Check for ID3 header (MP3) or MPEG sync word (MP3 without ID3, e.g. Edge TTS)
    const bytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, 3));
    const isId3 = bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
    const isMpeg = bytes.length >= 2 && bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0;
    if (isId3 || isMpeg) {
      this.#enqueueCompressed(buf);
      return;
    }
    // Try Opus decode, fall back to compressed decoder then raw PCM
    if (this.#decoder && this.#decoder.state !== 'closed') {
      try {
        const chunk = new EncodedAudioChunk({
          type: 'key',
          timestamp: this.#decoderTimestamp,
          data: buf,
        });
        this.#decoderTimestamp += 60000; // 60ms frame duration
        this.#decoder.decode(chunk);
      } catch {
        this.#enqueueCompressed(buf);
      }
    } else {
      this.#enqueuePcm(buf);
    }
  }

  #enqueuePcm(buf) {
    const int16 = new Int16Array(buf);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
    this.#playFloat32(float32);
  }

  async #enqueueCompressed(buf) {
    if (!this.#ctx) { this.#ctx = new AudioContext({ sampleRate: this.#sampleRate }); this.#nextTime = 0; }
    if (this.#ctx.state === 'suspended') await this.#ctx.resume();
    try {
      const decoded = await this.#ctx.decodeAudioData(buf.slice(0));
      this.#playAudioBuffer(decoded);
    } catch (e) {
      console.error('[fink-speaker] compressed decode error:', e);
    }
  }

  #playFloat32(float32) {
    if (!float32 || float32.length === 0) return;
    if (!this.#ctx) { this.#ctx = new AudioContext({ sampleRate: this.#sampleRate }); this.#nextTime = 0; }
    if (this.#ctx.state === 'suspended') this.#ctx.resume();
    const buf = this.#ctx.createBuffer(1, float32.length, this.#sampleRate);
    buf.getChannelData(0).set(float32);
    this.#playAudioBuffer(buf);
  }

  #playAudioBuffer(buf) {
    if (!buf) return;
    if (!this.#ctx) { this.#ctx = new AudioContext({ sampleRate: buf.sampleRate || this.#sampleRate }); this.#nextTime = 0; }
    this.#ensureGain();
    const src = this.#ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.#gain);
    const now = this.#ctx.currentTime;
    if (this.#nextTime <= now) this.#nextTime = now;
    src.start(this.#nextTime);
    this.#nextTime += buf.duration;
    this.#sources.push(src);
    src.onended = () => {
      this.#sources = this.#sources.filter(s => s !== src);
      if (this.#sources.length === 0) {
        this.#bus.publish('playback_state', { state: 'idle' });
      }
    };
    this.#bus.publish('playback_state', { state: 'playing' });
  }

  #ensureGain() {
    if (!this.#ctx) return;
    if (!this.#gain) {
      this.#gain = this.#ctx.createGain();
      this.#gain.gain.value = 1;
      this.#gain.connect(this.#ctx.destination);
    }
  }

  #onTts(data) {
    console.debug('[fink-speaker] tts event:', data.state, data.text?.slice(0, 40));
    if (data.state === 'start') {
      this.#decoderTimestamp = 0;
      if (this.#gain) {
        this.#gain.gain.cancelScheduledValues(this.#ctx?.currentTime || 0);
        this.#gain.gain.value = 1;
      }
    }
  }

  #stop() {
    if (this.#fadeTimer) { clearTimeout(this.#fadeTimer); this.#fadeTimer = null; }
    for (const src of this.#sources) { try { src.stop(); } catch {} }
    this.#sources = [];
    this.#nextTime = 0;
    if (this.#gain) { try { this.#gain.disconnect(); } catch {} this.#gain = null; }
    if (this.#ctx) { this.#ctx.close(); this.#ctx = null; }
    this.#decoderTimestamp = 0;
  }

  destroy() {
    for (const unsub of this.#unsubs) unsub();
    this.#unsubs = [];
    document.removeEventListener('click', this.#unlockHandler);
    document.removeEventListener('keydown', this.#unlockHandler);
    this.#stop();
    if (this.#decoder && this.#decoder.state !== 'closed') {
      this.#decoder.close();
    }
    this.#decoder = null;
  }
}
