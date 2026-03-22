// FinkSpeaker — bus service that decodes and plays audio.
// Subscribes to `audio_frame` and `tts` topics.
// Adapted from AudioPlayer + OpusBrowserDecoder in fink.js.

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

  constructor(bus) {
    this.#bus = bus;
    this.#initDecoder();

    this.#unsubs.push(
      bus.subscribe('audio_frame', (data) => this.#enqueueAuto(data)),
      bus.subscribe('tts', (data) => this.#onTts(data)),
    );
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
    // Check for ID3 header (MP3)
    const bytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, 3));
    if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      this.#enqueueCompressed(buf);
      return;
    }
    // Try Opus decode if decoder available, otherwise treat as PCM
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
        // Fallback: treat as raw PCM int16
        this.#enqueuePcm(buf);
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
      // Reset decoder for new utterance
      this.#decoderTimestamp = 0;
      // Reset gain to full in case of previous fade
      if (this.#gain) {
        this.#gain.gain.cancelScheduledValues(this.#ctx?.currentTime || 0);
        this.#gain.gain.value = 1;
      }
    }
    // 'stop' — let buffered audio drain naturally
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
    this.#stop();
    if (this.#decoder && this.#decoder.state !== 'closed') {
      this.#decoder.close();
    }
    this.#decoder = null;
  }
}
