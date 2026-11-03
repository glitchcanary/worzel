// Fink — Voice-Navigated Interactive Fiction Client
// Adapted from Worzel's web client. Connects to a Worzel server for
// voice (ASR/TTS) and adds an Ink story UI layer.
//
// Key differences from the Worzel chat client:
// - Story narration area instead of chat bubbles
// - Visible choice cards (tappable fallback for voice)
// - ink_state messages update the story display
// - User speech appears briefly as a transcript, not a persistent bubble

import { OpusBrowserEncoder } from './opus-encoder.js';
import { appendSbTokenToWsUrl } from './sb-auth.js';
import { EchoPilotEmitter, EchoPilotDetector, pilotConfigFromPage } from './fink-echo-pilot.js';

const PILOT = pilotConfigFromPage();

// ========================================================================
// WsClient — WebSocket protocol client (copied from Worzel, + ink msgs)
// ========================================================================
class WsClient {
  constructor(options) {
    this.options = options;
    this.ws = null;
    this.state = 'disconnected';
    this.token = null;
    this.sessionId = null;
    this.listeners = new Map();
    this.pingInterval = null;
  }
  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
  }
  emit(event, ...args) {
    for (const h of this.listeners.get(event) ?? []) h(...args);
  }
  setState(s) { this.state = s; this.emit('stateChange', s); }
  get currentState() { return this.state; }

  async connect() {
    if (this.state !== 'disconnected' && this.state !== 'error') return;
    this.setState('authenticating');
    try {
      const otaUrl = this.options.serverUrl.replace(/\/$/, '') + '/api/ota';
      const deviceId = this.options.deviceId ?? `fink-${crypto.randomUUID().slice(0, 8)}`;
      const response = await fetch(otaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId }),
      });
      if (!response.ok) throw new Error(`Auth failed: ${response.status}`);
      const data = await response.json();
      this.token = data.token;
      this.setState('connecting');
      let wsUrl = data.server_url + '?token=' + encodeURIComponent(this.token);
      if (this.options.storyId) wsUrl += '&story=' + encodeURIComponent(this.options.storyId);
      if (window.location.protocol === 'https:' && wsUrl.startsWith('ws://')) {
        wsUrl = 'wss://' + wsUrl.slice(5);
      }
      // Append Supabase token for cookie-free auth (no-op if not logged in via Supabase)
      wsUrl = appendSbTokenToWsUrl(wsUrl);
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({
          type: 'hello', version: 1, transport: 'websocket',
          audio_params: {
            format: this.options.audioFormat ?? 'pcm',
            sample_rate: 16000,
            channels: 1,
            frame_duration: 60,
          },
          features: ['tts', 'stt'],
        }));
      };
      this.ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) { this.emit('audio', event.data); return; }
        try { this.handleMessage(JSON.parse(event.data)); } catch {}
      };
      this.ws.onclose = () => { this.cleanup(); this.setState('disconnected'); };
      this.ws.onerror = () => { this.emit('error', 'WebSocket error'); this.cleanup(); this.setState('error'); };
    } catch (err) {
      this.emit('error', err.message);
      this.setState('error');
    }
  }
  disconnect() {
    if (this.ws) { try { this.send({ type: 'goodbye', reason: 'user_disconnect' }); } catch {} this.ws.close(); }
    this.cleanup(); this.setState('disconnected');
  }
  sendAudio(data) { if (this.ws?.readyState === 1) this.ws.send(data); }
  startListening(mode = 'manual') { this.send({ type: 'listen', state: 'start', mode }); }
  stopListening(opts) { this.send({ type: 'listen', state: 'stop', ...opts }); }
  abort() { this.send({ type: 'abort', reason: 'user_interrupt' }); }
  send(msg) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  handleMessage(msg) {
    switch (msg.type) {
      case 'hello': this.sessionId = msg.session_id; this.setState('connected'); this.startPing(); break;
      case 'stt': this.emit('stt', msg.text); break;
      case 'tts':
        this.emit('tts', {
          state: msg.state,
          text: msg.text,
          provider: msg.provider,
          fallback: msg.fallback,
        });
        break;
      case 'input_ignored': this.emit('inputIgnored', msg); break;
      case 'ink_state': this.emit('inkState', msg); break;
      case 'pipeline_telemetry': this.emit('telemetry', msg); break;
      case 'pong': break;
      case 'error': this.emit('error', msg.message, msg); break;
      case 'goodbye': this.disconnect(); break;
    }
  }
  startPing() { this.pingInterval = setInterval(() => this.send({ type: 'ping' }), 30000); }
  cleanup() {
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    this.ws = null; this.token = null; this.sessionId = null;
  }
}

// ========================================================================
// OpusBrowserDecoder — decodes Opus packets via WebCodecs AudioDecoder
// (copied from Worzel — identical, needed for TTS playback)
// ========================================================================
class OpusBrowserDecoder {
  constructor(sampleRate = 16000) {
    this.sampleRate = sampleRate;
    this._decoder = null;
    this._onDecoded = null;
    this._timestamp = 0;
    this._frameDurationUs = 60000;
    this.ready = false;
  }
  initSync() {
    if (this.ready) return;
    if (typeof AudioDecoder === 'undefined') return;
    this._decodedSampleRate = null;
    this._errorCount = 0;
    this._decoder = new AudioDecoder({
      output: (audioData) => {
        this._errorCount = 0; // reset on successful decode
        if (!this._decodedSampleRate) this._decodedSampleRate = audioData.sampleRate;
        const float32 = new Float32Array(audioData.numberOfFrames);
        audioData.copyTo(float32, { planeIndex: 0 });
        audioData.close();
        if (this._onDecoded) this._onDecoded(float32, this._decodedSampleRate);
      },
      error: (e) => {
        this._errorCount = (this._errorCount || 0) + 1;
        if (this._errorCount <= 3) console.warn('[fink] Opus decode error:', e.message);
        if (this._errorCount === 3) console.warn('[fink] Suppressing further Opus errors (bad stream)');
        // After repeated errors, mark decoder as broken so enqueueAuto falls back
        if (this._errorCount >= 5) this._broken = true;
      },
    });
    this._decoder.configure({ codec: 'opus', sampleRate: this.sampleRate, numberOfChannels: 1 });
    this._broken = false;
    this.ready = true;
  }
  get broken() { return this._broken; }
  clearBroken() { this._broken = false; this._errorCount = 0; }
  decode(opusArrayBuffer) {
    if (this._broken) return; // stop feeding bad data
    if (!this._decoder || this._decoder.state === 'closed') {
      this.ready = false;
      this.initSync();
      if (!this.ready) return;
    }
    const chunk = new EncodedAudioChunk({ type: 'key', timestamp: this._timestamp, data: opusArrayBuffer });
    this._timestamp += this._frameDurationUs;
    this._decoder.decode(chunk);
  }
  resetTimestamp() { this._timestamp = 0; }
  destroy() {
    if (this._decoder && this._decoder.state !== 'closed') this._decoder.close();
    this._decoder = null; this._onDecoded = null; this.ready = false;
  }
}

// ========================================================================
// AudioPlayer — gapless Opus playback (copied from Worzel)
// ========================================================================
class AudioPlayer {
  constructor(sampleRate = 16000) {
    this.sampleRate = sampleRate;
    this.ctx = null;
    this.nextTime = 0;
    this._sources = [];
    this._gain = null;
    this._fadeStopTimer = null;
    this._decoder = new OpusBrowserDecoder(sampleRate);
    this._decoder.initSync();
    this._decoder._onDecoded = (float32, decodedRate) => {
      if (decodedRate && decodedRate !== this.sampleRate) {
        this.sampleRate = decodedRate;
        // A fixed-rate context must match the stream; a device-rate context resamples buffers itself.
        if (this.ctx && !PILOT.enabled) { this.ctx.close(); this.ctx = null; this.nextTime = 0; }
      }
      this._playFloat32(float32);
    };
  }
  /** Device-rate context when the pilot is on (it needs > 38 kHz); else the stream rate. */
  _newContext(rate) {
    return PILOT.enabled ? new AudioContext() : new AudioContext({ sampleRate: rate });
  }
  enqueueOpus(opusArrayBuffer) {
    if (!opusArrayBuffer || opusArrayBuffer.byteLength === 0) return;
    if (this._decoder?.ready) this._decoder.decode(opusArrayBuffer);
  }
  enqueue(pcmArrayBuffer) {
    if (!pcmArrayBuffer || pcmArrayBuffer.byteLength === 0) return;
    const int16 = new Int16Array(pcmArrayBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
    this._playFloat32(float32);
  }
  async enqueueCompressed(audioArrayBuffer) {
    if (!audioArrayBuffer || audioArrayBuffer.byteLength === 0) return;
    if (!this.ctx) { this.ctx = this._newContext(this.sampleRate); this.nextTime = 0; }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const decoded = await this.ctx.decodeAudioData(audioArrayBuffer.slice(0));
    this._playAudioBuffer(decoded);
  }
  enqueueAuto(audioArrayBuffer) {
    if (!audioArrayBuffer || audioArrayBuffer.byteLength === 0) return;
    const bytes = new Uint8Array(audioArrayBuffer, 0, Math.min(audioArrayBuffer.byteLength, 3));
    // ID3 header (MP3) or MPEG sync word (MP3 without ID3 tag, e.g. Edge TTS)
    const isId3 = bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
    const isMpeg = bytes.length >= 2 && bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0;
    if (isId3 || isMpeg) {
      this.enqueueCompressed(audioArrayBuffer).catch(err => console.error('[fink] Compressed audio decode error:', err));
      return;
    }
    // Try Opus if decoder is healthy, fall back to compressed decoder
    if (this._decoder?.ready && !this._decoder.broken) {
      this.enqueueOpus(audioArrayBuffer);
    } else {
      // Decoder broken or unavailable — try browser's built-in decoder
      this.enqueueCompressed(audioArrayBuffer).catch(() => this.enqueue(audioArrayBuffer));
    }
  }
  _playAudioBuffer(buf) {
    if (!buf) return;
    if (!this.ctx) { this.ctx = this._newContext(buf.sampleRate || this.sampleRate); this.nextTime = 0; }
    this._ensureGain();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this._gain);
    const now = this.ctx.currentTime;
    if (this.nextTime <= now) this.nextTime = now;
    src.start(this.nextTime);
    this.nextTime += buf.duration;
    this._sources.push(src);
    if (this._sources.length === 1) this._setActive(true);
    src.onended = () => {
      this._sources = this._sources.filter(s => s !== src);
      if (this._sources.length === 0) {
        this._setActive(false);
        if (this.onIdle) this.onIdle();
      }
    };
  }
  _playFloat32(float32) {
    if (!float32 || float32.length === 0) return;
    if (!this.ctx) { this.ctx = this._newContext(this.sampleRate); this.nextTime = 0; }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const buf = this.ctx.createBuffer(1, float32.length, this.sampleRate);
    buf.getChannelData(0).set(float32);
    this._playAudioBuffer(buf);
  }
  _ensureGain() {
    if (!this.ctx) return;
    if (!this._gain) {
      this._gain = this.ctx.createGain();
      this._gain.gain.value = 1;
      this._gain.connect(this.ctx.destination);
      if (this._onGainReady) this._onGainReady(this._gain, this.ctx);
    }
  }
  /** Audio started or stopped coming out of the speaker: drive the pilot and tell listeners. */
  _setActive(active) {
    if (this._active === active) return;
    this._active = active;
    if (PILOT.enabled && this.ctx) {
      if (active) {
        if (!this._pilot || this._pilot.ctx !== this.ctx) {
          this._pilot = new EchoPilotEmitter(this.ctx, { id: PILOT.id, alternate: PILOT.alternate });
        }
        this._pilot.start();
      } else {
        this._pilot?.stop();
      }
    }
    if (this.onActiveChange) this.onActiveChange(active);
  }
  get active() { return !!this._active; }

  /** Milliseconds until all queued audio finishes playing. 0 if already silent. */
  msUntilIdle() {
    if (!this.ctx || this._sources.length === 0) return 0;
    const remaining = this.nextTime - this.ctx.currentTime;
    return Math.max(0, remaining * 1000);
  }

  fadeStop(durationMs = 500) {
    if (!this.ctx || !this._gain) {
      this.stop();
      return Promise.resolve();
    }
    if (this._fadeStopTimer) {
      clearTimeout(this._fadeStopTimer);
      this._fadeStopTimer = null;
    }
    const now = this.ctx.currentTime;
    this._gain.gain.cancelScheduledValues(now);
    this._gain.gain.setValueAtTime(this._gain.gain.value, now);
    this._gain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
    return new Promise(resolve => {
      this._fadeStopTimer = setTimeout(() => {
        this._fadeStopTimer = null;
        this.stop();
        resolve();
      }, durationMs);
    });
  }
  stop() {
    if (this._fadeStopTimer) {
      clearTimeout(this._fadeStopTimer);
      this._fadeStopTimer = null;
    }
    for (const src of this._sources) { try { src.onended = null; src.stop(); } catch {} }
    this._sources = []; this.nextTime = 0;
    this._setActive(false);
    this._pilot = null;
    if (this._gain) {
      try { this._gain.disconnect(); } catch {}
      this._gain = null;
    }
    if (this.ctx) { this.ctx.close(); this.ctx = null; }
    if (this._decoder) this._decoder.resetTimestamp();
  }
}

// ========================================================================
// <fink-story> — Narrative display + choice cards
// ========================================================================
class FinkStory extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host {
          display: flex; flex-direction: column; flex: 1; overflow: hidden;
          font-family: 'Georgia', 'Times New Roman', serif;
          color: var(--fink-text, #e8e8e8);
        }
        .picture {
          flex: 0 0 auto; margin: 0; background: #0b1020;
          display: flex; justify-content: center; align-items: center;
          border-bottom: 1px solid var(--fink-border, #1a1a3e);
          max-height: 38%; min-height: 0; overflow: hidden; cursor: zoom-in;
        }
        .picture[hidden] { display: none; }
        .picture img {
          display: block; max-width: 100%; max-height: 100%;
          object-fit: contain; animation: fadeIn 0.5s ease forwards; opacity: 0;
        }
        :host([picture-expanded]) .picture { max-height: 75%; cursor: zoom-out; }
        .narration {
          flex: 1; overflow-y: auto; padding: 16px 20px;
          line-height: 1.7; font-size: 1.05rem; min-height: 0;
        }
        .last-heard {
          position: sticky; top: 0; z-index: 2;
          margin: 0 0 12px 0; padding: 8px 10px;
          background: rgba(15, 52, 96, 0.92);
          border: 1px solid var(--fink-border, #1a1a3e);
          border-radius: 8px;
          color: var(--fink-text-secondary, #b8bfd6);
          font-size: 0.82rem; line-height: 1.35;
          font-family: system-ui, sans-serif;
          backdrop-filter: blur(4px);
        }
        .session-note {
          position: sticky; top: 0; z-index: 3;
          margin: 0 0 12px 0; padding: 8px 10px;
          background: rgba(20, 20, 34, 0.94);
          border: 1px solid var(--fink-border, #1a1a3e);
          border-radius: 8px;
          color: var(--fink-text-secondary, #b8bfd6);
          font-size: 0.8rem; line-height: 1.35;
          font-family: system-ui, sans-serif;
          backdrop-filter: blur(4px);
        }
        .session-note.listening { border-color: #3b82f6; color: #dbeafe; }
        .session-note.thinking { border-color: #f59e0b; color: #fde68a; }
        .session-note.speaking { border-color: #22c55e; color: #dcfce7; }
        .session-note.error { border-color: #ef4444; color: #fecaca; }
        .last-heard strong {
          color: var(--fink-text, #e8e8e8);
          font-weight: 600;
          margin-right: 6px;
        }
        .narration p {
          margin-bottom: 12px; opacity: 0; animation: fadeIn 0.4s ease forwards;
        }
        .narration p.speaker { font-style: italic; color: var(--fink-text-secondary, #8b8fa3); font-size: 0.9rem; margin-bottom: 4px; }
        .narration p.streaming { opacity: 0.7; }
        .narration .user-speech {
          text-align: right; font-style: italic; color: var(--fink-text-muted, #5a5e73);
          font-size: 0.85rem; margin: 8px 0;
        }
        .choices {
          padding: 12px 16px; border-top: 1px solid var(--fink-border, #1a1a3e);
          display: flex; flex-direction: column; gap: 8px;
          max-height: 45%; overflow-y: auto; flex: 0 0 auto;
        }
        .choices:empty { display: none; }
        .choice-card {
          padding: 12px 16px; background: var(--fink-choice-bg, #1e3a5f);
          border: 1px solid var(--fink-border, #1a1a3e); border-radius: 8px;
          cursor: pointer; font-family: inherit; font-size: 0.95rem;
          color: var(--fink-text, #e8e8e8); transition: all 0.15s;
          text-align: left;
        }
        .choice-card.suggested {
          background: #2a5d54;
          border-color: #7cd6b4;
          box-shadow: 0 0 0 1px rgba(124, 214, 180, 0.35);
        }
        .choice-card:hover { background: var(--fink-choice-hover, #264d7a); }
        .choice-card:active { background: var(--fink-choice-active, #2d6aa0); }
        .choice-card:focus-visible {
          outline: 2px solid #f6c453;
          outline-offset: 2px;
        }
        .choice-number { color: var(--fink-accent, #e94560); font-weight: bold; margin-right: 8px; }
        .choice-badge {
          display: inline-block;
          margin-left: 8px;
          padding: 2px 8px;
          border-radius: 999px;
          background: rgba(124, 214, 180, 0.16);
          color: #baf0dd;
          font-size: 0.72rem;
          font-family: system-ui, sans-serif;
          vertical-align: middle;
        }
        .next-move {
          margin: 0 0 10px 0;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid rgba(124, 214, 180, 0.35);
          background: rgba(42, 93, 84, 0.22);
          color: var(--fink-text-secondary, #b8bfd6);
          font-size: 0.84rem;
          line-height: 1.4;
          font-family: system-ui, sans-serif;
        }
        .next-move strong {
          color: var(--fink-text, #e8e8e8);
          font-weight: 600;
          margin-right: 6px;
        }
        .empty {
          display: flex; align-items: center; justify-content: center;
          flex: 1; color: var(--fink-text-muted, #5a5e73); font-style: italic;
          padding: 40px; text-align: center; line-height: 1.6;
        }
        .end-card {
          padding: 20px; text-align: center; color: var(--fink-text-secondary);
          font-style: italic; border-top: 1px solid var(--fink-border);
        }
        .end-card button {
          margin-top: 12px; padding: 8px 20px; background: var(--fink-primary, #0f3460);
          color: white; border: none; border-radius: 6px; cursor: pointer;
          font-family: inherit; font-size: 0.9rem;
        }
        @keyframes fadeIn { to { opacity: 1; } }
      </style>
      <figure class="picture" hidden><img alt="" /></figure>
      <div class="narration" aria-live="polite"><div class="empty">Choose a story to begin.</div></div>
      <div class="choices" role="group" aria-label="Choices"></div>`;
    this._picture = this.shadowRoot.querySelector('.picture');
    this._pictureImg = this._picture.querySelector('img');
    this._picture.addEventListener('click', () => this.toggleAttribute('picture-expanded'));
    this._pictureImg.addEventListener('error', () => { this._picture.hidden = true; });
    this._narration = this.shadowRoot.querySelector('.narration');
    this._choices = this.shadowRoot.querySelector('.choices');
    this._lastHeardEl = null;
    this._statusEl = null;
    this._nextMoveEl = null;
  }

  /** Show the story's current picture (`# IMAGE:`) in the picture panel. */
  addImage(src) {
    if (!src || this._pictureImg.getAttribute('src') === src) {
      if (src) this._picture.hidden = false;
      return;
    }
    const img = this._pictureImg.cloneNode();
    img.addEventListener('error', () => { this._picture.hidden = true; });
    img.src = src;
    this._pictureImg.replaceWith(img);
    this._pictureImg = img;
    this._picture.hidden = false;
  }

  clearImage() {
    this._picture.hidden = true;
    this._pictureImg.removeAttribute('src');
    this.removeAttribute('picture-expanded');
  }

  /** Add narration text (from story engine or LLM). */
  addNarration(text, speaker) {
    this._clearEmpty();
    if (speaker && speaker !== 'narrator') {
      const sp = document.createElement('p');
      sp.className = 'speaker';
      sp.textContent = speaker + ':';
      this._narration.appendChild(sp);
    }
    const p = document.createElement('p');
    p.textContent = text;
    this._narration.appendChild(p);
    this._narration.scrollTop = this._narration.scrollHeight;
  }

  /** Show the user's spoken text briefly. */
  showUserSpeech(text) {
    this._clearEmpty();
    this.setStatus(`Heard: "${text}"`, 'thinking');
    if (!this._lastHeardEl) {
      this._lastHeardEl = document.createElement('div');
      this._lastHeardEl.className = 'last-heard';
      this._narration.prepend(this._lastHeardEl);
    }
    this._lastHeardEl.innerHTML = `<strong>You said</strong>${this._esc(text)}`;
    const p = document.createElement('p');
    p.className = 'user-speech';
    p.textContent = `"${text}"`;
    this._narration.appendChild(p);
    this._narration.scrollTop = this._narration.scrollHeight;
  }

  /** Start streaming assistant/narrator text. */
  startStreaming() {
    this._clearEmpty();
    this._streamEl = document.createElement('p');
    this._streamEl.className = 'streaming';
    this._narration.appendChild(this._streamEl);
  }

  /** Append text to the current streaming element. */
  appendStreaming(text) {
    if (this._streamEl) {
      this._streamEl.textContent += text;
      this._narration.scrollTop = this._narration.scrollHeight;
    }
  }

  /** End streaming. */
  endStreaming() {
    if (this._streamEl) {
      this._streamEl.classList.remove('streaming');
      this._streamEl = null;
    }
  }

  setStatus(text, kind = 'info') {
    this._clearEmpty();
    if (!this._statusEl) {
      this._statusEl = document.createElement('div');
      this._statusEl.className = 'session-note';
      this._narration.prepend(this._statusEl);
    }
    this._statusEl.className = `session-note ${kind}`.trim();
    this._statusEl.textContent = text;
  }

  /** Update the choice cards. */
  setChoices(choices, suggestion) {
    this._choices.innerHTML = '';
    this._renderSuggestion(suggestion, choices);
    let suggestedCard = null;
    choices.forEach((choice, i) => {
      const card = document.createElement('button');
      const isSuggested = suggestion?.suggestedChoiceIndex === choice.index;
      card.className = 'choice-card' + (isSuggested ? ' suggested' : '');
      card.innerHTML = `<span class="choice-number">${i + 1}.</span>${this._esc(choice.text)}${isSuggested ? '<span class="choice-badge">Suggested</span>' : ''}`;
      card.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('fink-choice', {
          bubbles: true, detail: { choiceIndex: choice.index },
        }));
      });
      this._choices.appendChild(card);
      if (isSuggested) suggestedCard = card;
    });
    const firstCard = this._choices.querySelector('.choice-card');
    (suggestedCard ?? firstCard)?.setAttribute('tabindex', '0');
  }

  /** Show story ended state. */
  showEnded() {
    this._choices.innerHTML = `
      <div class="end-card">
        <button class="restart-btn">Start Over</button>
      </div>`;
    this._choices.querySelector('.restart-btn').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('fink-restart', { bubbles: true, composed: true }));
    });
  }

  /** Clear all content. */
  clear() {
    this.clearImage();
    this._narration.innerHTML = '';
    this._choices.innerHTML = '';
    this._streamEl = null;
    this._lastHeardEl = null;
    this._statusEl = null;
    this._nextMoveEl = null;
  }

  _clearEmpty() {
    const e = this._narration.querySelector('.empty');
    if (e) e.remove();
  }

  _renderSuggestion(suggestion, choices) {
    if (this._nextMoveEl) {
      this._nextMoveEl.remove();
      this._nextMoveEl = null;
    }
    if (!suggestion) return;

    const parts = [`<strong>Next move</strong>Heard next: "${this._esc(suggestion.heardText)}".`];
    if (suggestion.suggestedChoiceIndex != null) {
      const match = choices.find(choice => choice.index === suggestion.suggestedChoiceIndex);
      if (match) {
        parts.push(`Suggested choice: "${this._esc(match.text)}".`);
      }
    } else if (suggestion.pendingInputText) {
      parts.push(`Draft reply ready: "${this._esc(suggestion.pendingInputText)}".`);
    }

    this._nextMoveEl = document.createElement('div');
    this._nextMoveEl.className = 'next-move';
    this._nextMoveEl.innerHTML = parts.join(' ');
    this._choices.appendChild(this._nextMoveEl);
  }

  focusChoice(step = 1) {
    const cards = [...this._choices.querySelectorAll('.choice-card')];
    if (cards.length === 0) return false;
    const active = this.shadowRoot.activeElement;
    let index = cards.findIndex(card => card === active);
    if (index === -1) {
      const suggested = cards.findIndex(card => card.classList.contains('suggested'));
      index = suggested >= 0 ? suggested : (step > 0 ? -1 : 0);
    }
    index = (index + step + cards.length) % cards.length;
    cards[index].focus();
    return true;
  }

  activateFocusedChoice() {
    const active = this.shadowRoot.activeElement;
    if (active?.classList?.contains('choice-card')) {
      active.click();
      return true;
    }
    return false;
  }

  hasChoices() {
    return this._choices.querySelector('.choice-card') !== null;
  }

  /** Activate the n-th visible choice (1-based), as a tap would. */
  chooseByNumber(n) {
    const card = this._choices.querySelectorAll('.choice-card')[n - 1];
    if (!card) return false;
    card.click();
    return true;
  }

  _esc(s) { const d = document.createElement('span'); d.textContent = s; return d.innerHTML; }
}
customElements.define('fink-story', FinkStory);

// ========================================================================
// <fink-mic> — talk control
//
// Two modes:
//   hold       (default) press and hold the button or Space to talk; release
//              to send. A short tap latches: talk, and it sends at the end of
//              speech or on the next tap. Pressing while Fink speaks stops it.
//   handsfree  the mic opens by itself when Fink stops speaking. Results are
//              dropped while Fink is speaking, and (with ?pilot=1) while a
//              Fink pilot tone is audible.
//
// Two engines: the browser's Web Speech API when it exists, else server
// ASR (Opus to Worzel). Events out: fink-talk-start, fink-stt-text,
// fink-no-speech, fink-recording-start / -stop, fink-audio-data,
// fink-speed-change.
// ========================================================================
const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm6-3c0 3.31-2.69 6-6 6s-6-2.69-6-6H4c0 4.08 3.05 7.44 7 7.93V21h2v-2.07c3.95-.49 7-3.85 7-7.93h-2z"/></svg>';
const STOP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const GEAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.65 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>';

const TAP_MS = 300;            // shorter press = tap (latches)
const LATCH_SILENCE_MS = 1300; // latched browser ASR: send after this long with no new words
const MAX_TALK_MS = 20000;
const HANDSFREE_RESUME_MS = 300;

class FinkMic extends HTMLElement {
  constructor() {
    super();
    this.recording = false;
    this._enabled = false;
    this._state = 'offline';
    this._pipeline = 'idle';    // idle | thinking | speaking
    this._talking = false;      // a hold-mode turn is open
    this._latched = false;
    this._pressAt = 0;
    this._rec = null;           // Web Speech recognition instance
    this._finals = [];
    this._interim = '';
    this._echoPresent = false;
    this._resumeTimer = null;
    this._latchTimer = null;
    this._maxTimer = null;
    this._finishTimer = null;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this._SR = SR || null;
    let forceServer = false;
    try { forceServer = localStorage.getItem('fink-mic-server') === 'true'; } catch {}
    this.engine = SR && !forceServer ? 'browser' : 'server';
    let mode = 'hold';
    try { mode = localStorage.getItem('fink-talk-mode') === 'handsfree' ? 'handsfree' : 'hold'; } catch {}
    this.mode = mode;
    this.lang = document.documentElement.lang || navigator.language || 'en-GB';
    // Server ASR fields
    this._autoStop = false;
    this._silenceThreshold = 1200;
    this._restartDelayMs = 600;
    this._lastAudioTime = 0;
    this._speechDetected = false;
    this._speechStartTime = 0;
    this._recordingStartTime = 0;
    this._minSpeechMs = 120;
    this._speechThreshold = 0.01;
    this._fallbackSpeechThreshold = 0.006;
    this._maxHotMicTurnMs = 8000;
    this._peakRms = 0;
    this._autoRestartTimer = null;
    let speed = 1.15;
    try { speed = parseFloat(localStorage.getItem('fink-tts-speed') ?? '1.15') || 1.15; } catch {}
    this.ttsSpeed = speed;

    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display: block; padding: 10px 14px 12px; font-family: system-ui, sans-serif; }
        .bar { display: flex; align-items: center; gap: 12px; }
        .talk {
          --level: 0;
          position: relative; flex: 0 0 auto;
          width: 64px; height: 64px; border-radius: 50%;
          border: 2px solid #3a4060; background: #1b2a4a; color: #cbd5e1;
          display: grid; place-items: center; cursor: pointer;
          touch-action: none; user-select: none; -webkit-user-select: none;
          -webkit-touch-callout: none; transition: background 0.15s, border-color 0.15s, transform 0.1s;
        }
        .talk svg { width: 28px; height: 28px; pointer-events: none; }
        .talk:disabled { opacity: 0.35; cursor: default; }
        .talk:focus-visible { outline: 2px solid #f6c453; outline-offset: 3px; }
        .talk::after {
          content: ''; position: absolute; inset: -6px; border-radius: 50%;
          border: 3px solid #60a5fa; opacity: 0; pointer-events: none;
          transform: scale(calc(1 + var(--level) * 0.25)); transition: transform 0.08s;
        }
        :host([state="recording"]) .talk { background: #b91c1c; border-color: #fca5a5; color: #fff; transform: scale(1.06); }
        :host([state="recording"]) .talk::after { opacity: 0.8; border-color: #fca5a5; }
        :host([state="listening"]) .talk { border-color: #60a5fa; color: #bfdbfe; }
        :host([state="listening"]) .talk::after { opacity: 0.5; animation: pulse 2s ease-in-out infinite; }
        :host([state="thinking"]) .talk { border-color: #f59e0b; color: #fde68a; }
        :host([state="speaking"]) .talk { border-color: #22c55e; color: #bbf7d0; }
        :host([state="blocked"]) .talk, :host([state="echo"]) .talk { border-color: #6b7280; color: #9ca3af; }
        @keyframes pulse { 0%,100% { transform: scale(1); opacity: 0.5; } 50% { transform: scale(1.12); opacity: 0.15; } }
        .info { flex: 1; min-width: 0; }
        .label { font-size: 0.9rem; color: var(--fink-text, #e8e8e8); }
        .hint { font-size: 0.72rem; color: var(--fink-text-muted, #8b8fa3); margin-top: 2px; }
        .transcript {
          font-size: 0.8rem; color: #93c5fd; font-style: italic; margin-top: 2px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 1.1em;
        }
        .icon-btn {
          flex: 0 0 auto; width: 40px; height: 40px; border-radius: 10px;
          border: 1px solid #3a4060; background: transparent; color: #cbd5e1;
          display: grid; place-items: center; cursor: pointer;
        }
        .icon-btn svg { width: 20px; height: 20px; }
        .icon-btn[hidden] { display: none; }
        .icon-btn:focus-visible { outline: 2px solid #f6c453; outline-offset: 2px; }
        .settings {
          margin-top: 10px; padding: 10px 12px; border-radius: 8px;
          background: rgba(255,255,255,0.04); border: 1px solid #2a3150;
          font-size: 0.8rem; color: var(--fink-text-secondary, #b8bfd6);
          display: grid; gap: 8px;
        }
        .settings[hidden] { display: none; }
        .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .seg { display: inline-flex; border: 1px solid #3a4060; border-radius: 6px; overflow: hidden; }
        .seg button {
          background: transparent; border: 0; color: inherit; padding: 4px 10px; cursor: pointer;
          font: inherit; font-size: 0.78rem;
        }
        .seg button[aria-pressed="true"] { background: #2d6aa0; color: #fff; }
        .muted { color: var(--fink-text-muted, #8b8fa3); }
      </style>
      <div class="bar">
        <button class="talk" type="button" disabled aria-label="Hold to talk">${MIC_SVG}</button>
        <div class="info">
          <div class="label" aria-live="polite">Not connected</div>
          <div class="transcript"></div>
          <div class="hint"></div>
        </div>
        <button class="icon-btn stop" type="button" hidden aria-label="Stop speaking" title="Stop speaking (Esc)">${STOP_SVG}</button>
        <button class="icon-btn gear" type="button" aria-label="Voice settings" aria-expanded="false" title="Voice settings">${GEAR_SVG}</button>
      </div>
      <div class="settings" hidden>
        <div class="row"><span>Talk</span>
          <span class="seg mode">
            <button type="button" data-mode="hold">Hold to talk</button>
            <button type="button" data-mode="handsfree">Hands-free</button>
          </span>
        </div>
        <div class="row"><span>Voice speed</span>
          <span class="seg speed">
            <button type="button" data-speed="1">1x</button>
            <button type="button" data-speed="1.15">1.15x</button>
            <button type="button" data-speed="1.3">1.3x</button>
            <button type="button" data-speed="1.5">1.5x</button>
          </span>
        </div>
        <div class="row"><label><input type="checkbox" class="pilot" /> Pilot tone (ignore Fink's own voice; reloads)</label></div>
        <div class="row muted engine"></div>
      </div>`;

    const root = this.shadowRoot;
    this._btn = root.querySelector('.talk');
    this._label = root.querySelector('.label');
    this._hint = root.querySelector('.hint');
    this._transcript = root.querySelector('.transcript');
    this._stopBtn = root.querySelector('.stop');
    this._settings = root.querySelector('.settings');

    // Pointer: hold to talk, tap to latch.
    this._btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { this._btn.setPointerCapture(e.pointerId); } catch {}
      this.pressStart('pointer');
    });
    const up = (e) => {
      try { this._btn.releasePointerCapture(e.pointerId); } catch {}
      this.pressEnd();
    };
    this._btn.addEventListener('pointerup', up);
    this._btn.addEventListener('pointercancel', up);
    this._btn.addEventListener('contextmenu', (e) => e.preventDefault());
    // Keyboard on the focused button: Enter = tap.
    this._btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.pressStart('key'); this.pressEnd(true); }
    });

    this._stopBtn.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('fink-stop-speaking', { bubbles: true, composed: true }));
    });
    root.querySelector('.gear').addEventListener('click', (e) => {
      const open = this._settings.hidden;
      this._settings.hidden = !open;
      e.currentTarget.setAttribute('aria-expanded', String(open));
    });
    root.querySelectorAll('.mode button').forEach(b => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    root.querySelectorAll('.speed button').forEach(b => b.addEventListener('click', () => {
      this.ttsSpeed = parseFloat(b.dataset.speed);
      try { localStorage.setItem('fink-tts-speed', String(this.ttsSpeed)); } catch {}
      this._renderSettings();
      this.dispatchEvent(new CustomEvent('fink-speed-change', { bubbles: true, detail: { speed: this.ttsSpeed } }));
    }));
    const pilotBox = root.querySelector('.pilot');
    pilotBox.checked = PILOT.enabled;
    pilotBox.addEventListener('change', () => {
      try { localStorage.setItem('fink-pilot', pilotBox.checked ? '1' : '0'); } catch {}
      const q = new URLSearchParams(window.location.search);
      q.delete('pilot');
      window.location.search = q.toString();
    });
    this._renderSettings();
    this._render();
  }

  // ── Public API (used by <fink-app>) ──

  get audioFormat() { return this._encoder?.format ?? 'pcm'; }
  get isTalking() { return this._talking; }

  async ensureEncoder() {
    if (this._encoder) return this._encoder;
    this._encoder = new OpusBrowserEncoder();
    await this._encoder.init();
    console.log(`[fink] Audio format: ${this._encoder.format}`);
    return this._encoder;
  }

  enable() {
    this._enabled = true;
    this._btn.disabled = false;
    if (this.engine === 'server') this.ensureEncoder().catch(() => {});
    this._render();
    if (this.mode === 'handsfree') this._scheduleResume(0);
  }

  disable() {
    this._enabled = false;
    this._btn.disabled = true;
    this._cancelTalk();
    this._stopHandsfree();
    this.releaseAudioGraph();
    this._pipeline = 'idle';
    this._render();
  }

  setMode(mode) {
    if (mode !== 'hold' && mode !== 'handsfree') return;
    this.mode = mode;
    try { localStorage.setItem('fink-talk-mode', mode); } catch {}
    this._cancelTalk();
    this._stopHandsfree();
    this._renderSettings();
    this._render();
    if (mode === 'handsfree' && this._pipeline === 'idle') this._scheduleResume(0);
  }

  /** idle | thinking | speaking — what the rest of the system is doing. */
  setPipelineState(state) {
    const prev = this._pipeline;
    this._pipeline = state === 'listening' ? 'idle' : state;
    if (this._pipeline === 'speaking' && this.mode === 'handsfree') this._stopHandsfree();
    if (this._pipeline === 'idle' && prev !== 'idle' && this.mode === 'handsfree') {
      this._scheduleResume(HANDSFREE_RESUME_MS);
    }
    this._render();
  }

  /** Called when the last TTS packet has arrived: resume hands-free listening after the audio drains. */
  speakingEndsIn(ms) {
    this._pipeline = 'idle';
    this._render();
    if (this.mode === 'handsfree') this._scheduleResume(ms + HANDSFREE_RESUME_MS);
  }

  /** Pilot detector says Fink audio is (or is not) audible at this mic. */
  setEchoPresent(present) {
    this._echoPresent = present;
    if (present && this.mode === 'handsfree' && !this._talking) this._stopHandsfree();
    if (!present && this.mode === 'handsfree' && this._pipeline === 'idle') this._scheduleResume(HANDSFREE_RESUME_MS);
    this._render();
  }

  /** Press (pointer or Space): open a turn, or close a latched one. */
  pressStart(source = 'pointer') {
    if (!this._enabled) return;
    if (this._talking && this._latched) { this._endTalk(); return; }
    if (this._talking) return;
    this._pressAt = performance.now();
    this._beginTalk(source);
  }

  /** Release. A short press latches the turn instead of ending it. */
  pressEnd(forceLatch = false) {
    if (!this._talking || this._latched) return;
    const held = performance.now() - this._pressAt;
    if (forceLatch || held < TAP_MS) {
      this._latched = true;
      this._render();
      return;
    }
    this._endTalk();
  }

  // ── Turn handling ──

  _beginTalk(source) {
    this._stopHandsfree();
    this._talking = true;
    this._latched = false;
    this._finals = [];
    this._interim = '';
    this._showTranscript('');
    this.dispatchEvent(new CustomEvent('fink-talk-start', { bubbles: true, detail: { source } }));
    clearTimeout(this._maxTimer);
    this._maxTimer = setTimeout(() => this._endTalk(), MAX_TALK_MS);
    if (this.engine === 'browser') this._startRecognition('turn');
    else this.startRec('manual');
    this._render();
  }

  _endTalk() {
    if (!this._talking) return;
    clearTimeout(this._maxTimer);
    clearTimeout(this._latchTimer);
    if (this.engine === 'browser') {
      const rec = this._rec;
      if (rec) {
        try { rec.stop(); } catch {}
        // onend normally finishes the turn; do it anyway if the engine goes quiet.
        clearTimeout(this._finishTimer);
        this._finishTimer = setTimeout(() => this._finishBrowserTurn(), 1500);
      } else {
        this._finishBrowserTurn();
      }
    } else {
      this._talking = false;
      this._latched = false;
      this.stopRec();
      this._render();
    }
  }

  _cancelTalk() {
    clearTimeout(this._maxTimer);
    clearTimeout(this._latchTimer);
    clearTimeout(this._finishTimer);
    if (this._rec) { const r = this._rec; this._rec = null; try { r.abort(); } catch {} }
    if (this.recording) this.stopRec();
    this._talking = false;
    this._latched = false;
    this._showTranscript('');
  }

  _finishBrowserTurn() {
    clearTimeout(this._finishTimer);
    if (!this._talking) return;
    this._talking = false;
    this._latched = false;
    if (this._rec) { const r = this._rec; this._rec = null; try { r.abort(); } catch {} }
    const text = (this._finals.join(' ').trim() || this._interim.trim());
    this._finals = [];
    this._interim = '';
    if (text) {
      this._pipeline = 'thinking';
      this.dispatchEvent(new CustomEvent('fink-stt-text', { bubbles: true, detail: { text, source: 'browser' } }));
    } else {
      this._showTranscript('');
      this.dispatchEvent(new CustomEvent('fink-no-speech', { bubbles: true }));
    }
    this._render();
  }

  // ── Web Speech ──

  /** kind: 'turn' (one hold or latched turn) | 'handsfree' (continuous) */
  _startRecognition(kind) {
    if (!this._SR) return;
    if (this._rec) { const r = this._rec; this._rec = null; try { r.abort(); } catch {} }
    const rec = new this._SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.lang;
    rec.maxAlternatives = 1;
    this._rec = rec;
    this._recKind = kind;

    rec.onresult = (event) => {
      if (this._rec !== rec) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          if (!t.trim()) continue;
          if (kind === 'handsfree') { this._onHandsfreeFinal(t.trim()); continue; }
          this._finals.push(t.trim());
        } else {
          interim += t;
        }
      }
      this._interim = interim;
      if (kind === 'turn') {
        this._showTranscript([...this._finals, interim].join(' ').trim());
        if (this._latched) {
          clearTimeout(this._latchTimer);
          this._latchTimer = setTimeout(() => this._endTalk(), LATCH_SILENCE_MS);
        }
      } else if (!this._suppressed()) {
        this._showTranscript(interim.trim());
      }
    };
    rec.onerror = (event) => {
      if (this._rec !== rec) return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this._blocked = true;
        this._cancelTalk();
        this._render();
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.warn('[fink-mic] speech error:', event.error);
      }
    };
    rec.onend = () => {
      if (this._rec !== rec) return;
      this._rec = null;
      if (kind === 'turn') {
        if (this._talking && this._latched === false && performance.now() - this._pressAt < MAX_TALK_MS && this._holding()) {
          // Engine stopped by itself while the button is still held: restart it.
          this._startRecognition('turn');
          return;
        }
        this._finishBrowserTurn();
      } else if (this._wantsHandsfree()) {
        this._scheduleResume(200);
      }
    };
    try {
      rec.start();
      this._blocked = false;
    } catch (err) {
      console.warn('[fink-mic] speech start failed:', err);
      this._rec = null;
      if (kind === 'turn') this._finishBrowserTurn();
    }
  }

  _holding() {
    return this._btn.matches(':active') || this._spaceHeld === true;
  }

  _onHandsfreeFinal(text) {
    if (this._suppressed()) {
      console.log('[fink-mic] dropped (Fink audio):', text.slice(0, 60));
      return;
    }
    this._showTranscript('');
    this._pipeline = 'thinking';
    this._render();
    this.dispatchEvent(new CustomEvent('fink-stt-text', { bubbles: true, detail: { text, source: 'browser' } }));
  }

  // ── Hands-free ──

  _suppressed() {
    return this._pipeline === 'speaking' || this._echoPresent;
  }

  _wantsHandsfree() {
    return this._enabled && this.mode === 'handsfree' && !this._talking && !this._blocked
      && this._pipeline === 'idle' && !this._echoPresent;
  }

  _scheduleResume(ms) {
    clearTimeout(this._resumeTimer);
    this._resumeTimer = setTimeout(() => {
      this._resumeTimer = null;
      if (!this._wantsHandsfree()) return;
      if (this.engine === 'browser') {
        if (!this._rec) this._startRecognition('handsfree');
      } else if (!this.recording) {
        this._autoStop = true;
        this.startRec('auto');
      }
      this._render();
    }, Math.max(0, ms));
  }

  _stopHandsfree() {
    clearTimeout(this._resumeTimer);
    this._resumeTimer = null;
    if (this._rec && this._recKind === 'handsfree') {
      const r = this._rec; this._rec = null;
      try { r.abort(); } catch {}
    }
    if (this.recording && this._autoStop && !this._talking) {
      this._suppressNextStop = true;
      this.stopRec();
    }
  }

  /** Server ASR hands-free: reopen the mic after a turn. */
  autoRestart() {
    if (this.engine !== 'server' || this.mode !== 'handsfree') return;
    this._scheduleResume(this._restartDelayMs);
  }

  // ── Rendering ──

  _showTranscript(text) {
    this._transcript.textContent = text ? `"${text}"` : '';
  }

  _computeState() {
    if (!this._enabled) return 'offline';
    if (this._blocked) return 'blocked';
    if (this._talking) return 'recording';
    if (this._pipeline === 'speaking') return 'speaking';
    if (this._pipeline === 'thinking') return 'thinking';
    if (this.mode === 'handsfree') return this._echoPresent ? 'echo' : 'listening';
    return 'idle';
  }

  _render() {
    const state = this._computeState();
    this._state = state;
    this.setAttribute('state', state);
    const hold = this.mode === 'hold';
    const labels = {
      offline: 'Not connected',
      blocked: 'Microphone blocked. Allow it in the browser, then tap the button.',
      recording: this._latched ? 'Listening. Tap to send.' : 'Listening. Release to send.',
      speaking: hold ? 'Speaking. Hold to talk over it.' : 'Speaking.',
      thinking: 'Thinking.',
      listening: 'Listening.',
      echo: 'Fink audio nearby. Waiting.',
      idle: 'Hold to talk, or tap once.',
    };
    this._label.textContent = labels[state] ?? '';
    const hints = {
      idle: 'Space: hold to talk. 1-9: choose. Esc: stop the voice.',
      speaking: 'Esc or the stop button: stop the voice.',
      listening: 'Hands-free. Tap the button to talk now.',
    };
    this._hint.textContent = hints[state] ?? '';
    this._btn.setAttribute('aria-label', this._talking ? 'Send' : 'Hold to talk');
    this._btn.setAttribute('aria-pressed', String(this._talking));
    this._stopBtn.hidden = state !== 'speaking';
  }

  _renderSettings() {
    const root = this.shadowRoot;
    root.querySelectorAll('.mode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === this.mode)));
    root.querySelectorAll('.speed button').forEach(b => b.setAttribute('aria-pressed', String(parseFloat(b.dataset.speed) === this.ttsSpeed)));
    root.querySelector('.engine').textContent = this.engine === 'browser'
      ? 'Speech recognition: this browser.'
      : 'Speech recognition: Worzel server (Whisper).';
  }

  // ── Server ASR (Opus to Worzel) ──

  async _ensureAudioGraph() {
    if (this.mediaStream && this.audioCtx && this.audioCtx.state !== 'closed') return;
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: 16000 },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.audioCtx = new AudioContext({ sampleRate: 16000 });
    await this.audioCtx.audioWorklet.addModule('./pcm-processor.js');
  }

  releaseAudioGraph() {
    this._worklet?.disconnect(); this._worklet = null;
    this._source?.disconnect(); this._source = null;
    this.audioCtx?.close(); this.audioCtx = null;
    this.mediaStream?.getTracks().forEach(t => t.stop()); this.mediaStream = null;
  }

  async startRec(source = 'manual') {
    if (this.recording || !this._enabled) return;
    this.recording = true;
    this._autoStop = source !== 'manual';
    this._speechDetected = false;
    this._lastAudioTime = 0;
    this._speechStartTime = 0;
    this._recordingStartTime = Date.now();
    this._peakRms = 0;
    try {
      await this.ensureEncoder();
      await this._ensureAudioGraph();
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
      if (!this.recording) return; // released while the mic was opening
      const src = this.audioCtx.createMediaStreamSource(this.mediaStream);
      const worklet = new AudioWorkletNode(this.audioCtx, 'pcm-processor');
      worklet.port.onmessage = (e) => this._onPcm(new Int16Array(e.data));
      src.connect(worklet);
      this._worklet = worklet; this._source = src;
      this.dispatchEvent(new CustomEvent('fink-recording-start', { bubbles: true, detail: { source } }));
    } catch (err) {
      console.error('[fink] Mic error:', err);
      this.recording = false;
      if (err?.name === 'NotAllowedError') this._blocked = true;
      this._talking = false;
      this._render();
    }
  }

  _onPcm(samples) {
    if (!this.recording) return;
    for (const frame of this._encoder.encode(samples)) {
      this.dispatchEvent(new CustomEvent('fink-audio-data', { bubbles: true, detail: { audio: frame } }));
    }
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += Math.abs(samples[i]);
    const rms = sum / samples.length / 32768;
    if (rms > this._peakRms) this._peakRms = rms;
    this._btn.style.setProperty('--level', Math.min(1, rms * 25).toFixed(2));
    const now = Date.now();
    if (rms > this._speechThreshold) {
      if (this._speechStartTime === 0) this._speechStartTime = now;
      this._lastAudioTime = now;
      if (!this._speechDetected && now - this._speechStartTime >= this._minSpeechMs) this._speechDetected = true;
    } else if (rms > this._fallbackSpeechThreshold) {
      this._lastAudioTime = now;
      if (!this._speechDetected && now - this._recordingStartTime >= 800) this._speechDetected = true;
    } else {
      this._speechStartTime = 0;
    }
    // Hands-free and latched turns end at the end of speech; held turns end on release.
    const autoEnd = this._autoStop || this._latched;
    if (autoEnd && this._speechDetected && this._lastAudioTime > 0 && now - this._lastAudioTime >= this._silenceThreshold) {
      this._lastAudioTime = 0;
      if (this._talking) this._endTalk(); else this.stopRec();
      return;
    }
    if (this._autoStop && now - this._recordingStartTime >= this._maxHotMicTurnMs) this.stopRec();
  }

  async stopRec() {
    if (!this.recording) return;
    this.recording = false;
    this._btn.style.setProperty('--level', '0');
    if (this._encoder && this._worklet) {
      const remaining = await this._encoder.flush();
      for (const frame of remaining) {
        this.dispatchEvent(new CustomEvent('fink-audio-data', { bubbles: true, detail: { audio: frame } }));
      }
    }
    const opened = !!this._worklet;
    this._worklet?.disconnect(); this._worklet = null;
    this._source?.disconnect(); this._source = null;
    const peakRms = this._peakRms;
    const suppressed = this._suppressNextStop || !opened;
    this._suppressNextStop = false;
    if (!suppressed) {
      this.dispatchEvent(new CustomEvent('fink-recording-stop', {
        bubbles: true,
        detail: { hadSpeech: this._speechDetected || peakRms > this._fallbackSpeechThreshold, peakRms },
      }));
    }
    this._speechDetected = false;
    this._peakRms = 0;
    this._render();
  }
}
customElements.define('fink-mic', FinkMic);

// ========================================================================
// <fink-app> — root component: story picker, story view, talk control
// ========================================================================
const NAV_WORDS = ['next', 'try again', 'back', 'continue', 'get my results'];

class FinkApp extends HTMLElement {
  constructor() {
    super();
    this.client = null;
    this.player = null;
    this._isSpeaking = false;
    this._responseWatchdog = null;
    this._stories = [];
    this._externalEnabled = false;
    this._storyId = null;
    this._pendingStoryId = null;
    this._detector = null;
    this._onKeyDown = (e) => this.handleKeyDown(e);
    this._onKeyUp = (e) => this.handleKeyUp(e);
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host {
          display: flex; flex-direction: column; height: 100%; min-height: 0; position: relative;
          background: var(--fink-bg, #16213e); color: var(--fink-text, #e8e8e8);
          border: 1px solid var(--fink-border, #1a1a3e); border-radius: 12px; overflow: hidden;
        }
        header {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 14px; background: var(--fink-header-bg, #0f3460);
          border-bottom: 1px solid var(--fink-border); flex: 0 0 auto;
        }
        .title {
          flex: 1; min-width: 0; font-family: 'Georgia', serif; font-size: 1.05rem; font-weight: 600;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .status { font-size: 0.72rem; color: var(--fink-text-muted); font-family: system-ui, sans-serif; }
        .status.connected { color: #22c55e; }
        .status.error { color: #fca5a5; }
        .hbtn {
          font: 0.8rem system-ui, sans-serif; color: #e8e8e8; background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.18); border-radius: 6px; padding: 5px 10px; cursor: pointer;
        }
        .hbtn:focus-visible, .story-btn:focus-visible { outline: 2px solid #f6c453; outline-offset: 2px; }
        .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
        footer { border-top: 1px solid var(--fink-border); flex: 0 0 auto; }
        .picker {
          position: absolute; inset: 0; z-index: 10; display: flex; flex-direction: column;
          background: var(--fink-bg, #16213e); font-family: system-ui, sans-serif;
        }
        .picker[hidden] { display: none; }
        .picker-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--fink-header-bg, #0f3460); }
        .picker-head h2 { flex: 1; margin: 0; font: 600 1.05rem Georgia, serif; }
        .picker-body { flex: 1; overflow-y: auto; padding: 8px 14px 16px; }
        .picker h3 { margin: 16px 0 6px; font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fink-text-muted, #8b8fa3); }
        .story-btn {
          display: block; width: 100%; text-align: left; margin: 0 0 6px; padding: 10px 12px;
          border-radius: 8px; border: 1px solid var(--fink-border, #1a1a3e);
          background: var(--fink-choice-bg, #1e3a5f); color: var(--fink-text, #e8e8e8); cursor: pointer; font: inherit;
        }
        .story-btn:hover { background: var(--fink-choice-hover, #264d7a); }
        .story-btn[aria-current="true"] { border-color: #7cd6b4; }
        .story-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .story-btn .t { display: block; font: 600 0.95rem Georgia, serif; }
        .story-btn .d { display: block; font-size: 0.78rem; color: var(--fink-text-secondary, #b8bfd6); margin-top: 2px; }
        .note { font-size: 0.78rem; color: var(--fink-text-secondary, #b8bfd6); margin: 8px 0; }
        .note.error { color: #fca5a5; }
        .start {
          display: block; width: 100%; margin: 12px 0; padding: 14px; border: 0; border-radius: 10px;
          background: var(--fink-accent, #e94560); color: #fff; font: 600 1rem system-ui, sans-serif; cursor: pointer;
        }
        .start[hidden] { display: none; }
        details.server { margin-top: 18px; font-size: 0.78rem; color: var(--fink-text-muted, #8b8fa3); }
        details.server input {
          width: 100%; margin-top: 6px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--fink-border);
          background: var(--fink-narration-bg, #1a2744); color: var(--fink-text, #e8e8e8); font: inherit;
        }
      </style>
      <header>
        <span class="title">Fink</span>
        <span class="status">not connected</span>
        <button class="hbtn stories-btn" type="button">Stories</button>
      </header>
      <div class="main"><fink-story></fink-story></div>
      <footer><fink-mic></fink-mic></footer>
      <section class="picker" aria-label="Choose a story">
        <div class="picker-head"><h2>Choose a story</h2><button class="hbtn close-picker" type="button" hidden>Close</button></div>
        <div class="picker-body">
          <button class="start" type="button" hidden></button>
          <div class="note picker-note">Loading stories...</div>
          <div class="list"></div>
          <details class="server"><summary>Server</summary>
            <input type="url" class="server-url" aria-label="Worzel server URL" />
          </details>
        </div>
      </section>`;
  }

  get _story() { return this.shadowRoot.querySelector('fink-story'); }
  get _mic() { return this.shadowRoot.querySelector('fink-mic'); }

  connectedCallback() {
    const root = this.shadowRoot;
    const basePath = window.location.pathname.startsWith('/fink') ? '/fink' : '';
    this._serverInput = root.querySelector('.server-url');
    this._serverInput.value = window.location.origin + basePath;

    root.querySelector('.stories-btn').addEventListener('click', () => this.showPicker(true));
    root.querySelector('.close-picker').addEventListener('click', () => this.showPicker(false));
    root.querySelector('.start').addEventListener('click', () => {
      const id = this._pendingStoryId;
      if (id) this.chooseStory(id);
    });
    this._serverInput.addEventListener('change', () => this.loadStoryList());

    window.addEventListener('keydown', this._onKeyDown, true);
    window.addEventListener('keyup', this._onKeyUp, true);
    this._wireMic();
    this._wireStory();

    const q = new URLSearchParams(window.location.search);
    this._pendingStoryId = q.get('story');
    this.loadStoryList();
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this._onKeyDown, true);
    window.removeEventListener('keyup', this._onKeyUp, true);
    this.clearResponseWatchdog();
    this._detector?.stop();
  }

  // ── Story picker ──

  async loadStoryList() {
    const note = this.shadowRoot.querySelector('.picker-note');
    note.className = 'note picker-note';
    note.textContent = 'Loading stories...';
    try {
      const res = await fetch(this._serverInput.value.replace(/\/$/, '') + '/api/stories');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this._stories = data.stories ?? [];
      this._externalEnabled = !!data.externalEnabled;
      this._defaultStoryId = data.default;
      note.textContent = this._externalEnabled
        ? ''
        : 'Stories from danbri.github.io are listed but not enabled on this server (FINK_EXTERNAL_HOSTS).';
    } catch (err) {
      this._stories = [];
      note.className = 'note picker-note error';
      note.textContent = `Could not load the story list (${err.message}). Start the default story instead.`;
    }
    this.renderPicker();
  }

  renderPicker() {
    const list = this.shadowRoot.querySelector('.list');
    list.innerHTML = '';
    const groups = new Map();
    const order = ['Worzel', 'Glitch Canary', 'Cozyverse', 'Drift City', 'Isle of Glitch', 'Voice UX lab'];
    for (const s of this._stories) {
      const g = s.group ?? 'Worzel';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(s);
    }
    const names = [...groups.keys()].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    for (const name of names) {
      const h = document.createElement('h3');
      h.textContent = name;
      list.appendChild(h);
      for (const s of groups.get(name)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'story-btn';
        b.dataset.id = s.id;
        const t = document.createElement('span'); t.className = 't'; t.textContent = s.title ?? s.id;
        const d = document.createElement('span'); d.className = 'd'; d.textContent = s.description ?? '';
        b.append(t, d);
        if (s.external && !this._externalEnabled) {
          b.disabled = true;
          b.title = 'External stories are not enabled on this server';
        }
        if (s.id === this._storyId) b.setAttribute('aria-current', 'true');
        b.addEventListener('click', () => this.chooseStory(s.id));
        list.appendChild(b);
      }
    }
    // Deep link (?story=) or default: one big start button (audio needs a tap).
    const start = this.shadowRoot.querySelector('.start');
    const startId = this._pendingStoryId ?? (this._stories.length === 0 ? this._defaultStoryId ?? '' : null);
    if (!this.client && startId !== null) {
      const s = this._stories.find(x => x.id === startId);
      start.textContent = s ? `Start: ${s.title}` : (startId ? `Start: ${startId}` : 'Start');
      start.hidden = false;
      this._pendingStoryId = startId;
    } else {
      start.hidden = true;
    }
  }

  showPicker(show) {
    const picker = this.shadowRoot.querySelector('.picker');
    picker.hidden = !show;
    this.shadowRoot.querySelector('.close-picker').hidden = !this.client;
    if (show) {
      this.renderPicker();
      (picker.querySelector('.story-btn[aria-current="true"]') ?? picker.querySelector('.story-btn:not(:disabled)'))?.focus();
    }
  }

  titleFor(id) {
    return this._stories.find(s => s.id === id || s.url === id)?.title;
  }

  async chooseStory(id) {
    this._pendingStoryId = null;
    this.showPicker(false);
    const q = new URLSearchParams(window.location.search);
    if (id) q.set('story', id); else q.delete('story');
    history.replaceState(null, '', `${window.location.pathname}?${q}`);
    this._story.clear();
    this._story.setStatus('Loading story...', 'thinking');
    this.shadowRoot.querySelector('.title').textContent = this.titleFor(id) ?? 'Fink';
    if (this.client?.currentState === 'connected') {
      await this.stopSpeaking();
      this.armResponseWatchdog('story start', 20000);
      this.client.send({ type: 'fink_start', story_id: id });
    } else {
      try {
        await this.doConnect(this._serverInput.value, id);
      } catch (err) {
        console.error('[fink] Connect failed:', err);
        this.setStatus(`error: ${err.message}`, 'error');
      }
    }
  }

  setStatus(text, kind) {
    const el = this.shadowRoot.querySelector('.status');
    el.textContent = text;
    el.className = 'status' + (kind ? ` ${kind}` : '');
  }

  // ── Speech output ──

  _setSpeaking(speaking) {
    if (this._isSpeaking === speaking) return;
    this._isSpeaking = speaking;
    window.dispatchEvent(new CustomEvent('fink-speaking', { detail: { speaking } }));
  }

  async stopSpeaking() {
    this.client?.abort();
    if (this.player) await this.player.fadeStop(120);
    this._setSpeaking(false);
    this._mic.setPipelineState('idle');
  }

  // ── Wiring ──

  _wireMic() {
    const mic = this._mic;
    const story = this._story;

    mic.addEventListener('fink-talk-start', () => {
      clearTimeout(this._autoAdvance);
      // The user wants the floor: stop the voice now.
      if (this._isSpeaking || this.player?.active) {
        this.client?.abort();
        this.player?.stop();
        this._setSpeaking(false);
      }
      this.clearResponseWatchdog();
      story.setStatus('Listening...', 'listening');
    });
    mic.addEventListener('fink-stop-speaking', async () => {
      await this.stopSpeaking();
      story.setStatus(story.hasChoices() ? 'Stopped. Pick a choice or talk.' : 'Stopped.', 'info');
    });
    mic.addEventListener('fink-no-speech', () => {
      story.setStatus('No words caught. Hold the button while you talk.', 'info');
    });

    // Server ASR
    mic.addEventListener('fink-recording-start', () => {
      this.client?.abort();
      this.client?.startListening();
    });
    mic.addEventListener('fink-recording-stop', (e) => {
      if (e.detail?.hadSpeech === false) {
        this.client?.stopListening({ audio_level: 0 });
        story.setStatus('No speech detected.', 'info');
        mic.setPipelineState('idle');
        mic.autoRestart();
        return;
      }
      const peakRms = e.detail?.peakRms;
      story.setStatus('Interpreting...', 'thinking');
      mic.setPipelineState('thinking');
      this.armResponseWatchdog('speech recognition');
      this.client?.stopListening(peakRms != null ? { audio_level: Math.round(peakRms * 1000) / 1000 } : undefined);
    });
    mic.addEventListener('fink-audio-data', e => this.client?.sendAudio(e.detail.audio));

    // Browser ASR text
    mic.addEventListener('fink-stt-text', e => {
      const text = e.detail.text;
      if (text.length > 200) {
        console.log('[fink] Discarding long ASR text:', text.slice(0, 60));
        mic.setPipelineState('idle');
        return;
      }
      story.showUserSpeech(text);
      mic.setPipelineState('thinking');
      this.armResponseWatchdog('browser speech');
      this.client?.send({ type: 'stt_text', text });
    });

    mic.addEventListener('fink-speed-change', e => {
      this.client?.send({ type: 'fink_settings', tts_speed: e.detail.speed });
    });
  }

  _wireStory() {
    const story = this._story;
    story.addEventListener('fink-choice', e => {
      if (this.client?.currentState !== 'connected') return;
      clearTimeout(this._autoAdvance);
      this.player?.stop();
      this._setSpeaking(false);
      this.client.abort();
      this._mic.setPipelineState('thinking');
      story.setStatus('Advancing...', 'thinking');
      this.armResponseWatchdog('story advance');
      this.client.send({ type: 'ink', action: 'choose', choice_index: e.detail.choiceIndex });
    });
    story.addEventListener('fink-restart', () => {
      if (this._storyId) this.chooseStory(this._storyId);
      else this.showPicker(true);
    });
  }

  // ── Keyboard: Space hold to talk, 1-9 choose, Esc stop voice, Tab cycle choices ──

  /** The key's target, or null when the key belongs to someone else (text field, shortcut). */
  _keyTarget(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return null;
    const target = e.composedPath?.()[0] ?? e.target;
    const tag = target?.tagName?.toLowerCase?.();
    if (target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'summary') return null;
    return target ?? document.body;
  }

  handleKeyDown(e) {
    const target = this._keyTarget(e);
    if (!target) return;
    if (!this.shadowRoot.querySelector('.picker').hidden) return;
    const story = this._story;
    const mic = this._mic;

    if (e.code === 'Space') {
      // Space on a focused button (a choice, Stories, settings) keeps its normal meaning.
      if (target.tagName === 'BUTTON' && !target.classList.contains('talk')) return;
      e.preventDefault();
      if (e.repeat) return;
      mic._spaceHeld = true;
      mic.pressStart('key');
      return;
    }
    if (e.key === 'Escape') {
      if (this._isSpeaking || this.player?.active) {
        e.preventDefault();
        this.stopSpeaking();
        story.setStatus('Stopped.', 'info');
      }
      return;
    }
    if (/^[1-9]$/.test(e.key) && story.chooseByNumber(parseInt(e.key, 10))) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Tab' && story.hasChoices()) {
      e.preventDefault();
      story.focusChoice(e.shiftKey ? -1 : 1);
    }
  }

  handleKeyUp(e) {
    if (e.code !== 'Space') return;
    const mic = this._mic;
    if (!mic._spaceHeld) return;
    mic._spaceHeld = false;
    e.preventDefault();
    mic.pressEnd();
  }

  armResponseWatchdog(context, failMs = 12000) {
    this.clearResponseWatchdog();
    const story = this._story;
    const mic = this._mic;
    this._responseWatchdog = {
      warn: setTimeout(() => story.setStatus('Still working...', 'thinking'), Math.min(6000, failMs / 2)),
      fail: setTimeout(() => {
        console.error(`[fink] No server response after ${context}`);
        mic.setPipelineState('idle');
        story.setStatus('No reply. Try again.', 'error');
        mic.autoRestart();
      }, failMs),
    };
  }

  clearResponseWatchdog() {
    if (!this._responseWatchdog) return;
    clearTimeout(this._responseWatchdog.warn);
    clearTimeout(this._responseWatchdog.fail);
    this._responseWatchdog = null;
  }

  async _startPilotDetector() {
    if (!PILOT.enabled || this._detector) return;
    this._detector = new EchoPilotDetector();
    this._detector.addEventListener('change', (e) => {
      // Our own pilot only matters while we are not speaking (other tabs, other devices,
      // or our own tail); while we speak the mic is already gated.
      this._mic.setEchoPresent(e.detail.present);
      if (e.detail.present) console.log('[fink-pilot] Fink audio heard, id', e.detail.id);
    });
    await this._detector.start();
  }

  async doConnect(serverUrl, storyId) {
    const story = this._story;
    const mic = this._mic;

    if (mic.engine === 'server') await mic.ensureEncoder();
    this._startPilotDetector().catch(() => {});

    this.client?.disconnect();
    this.client = new WsClient({ serverUrl, audioFormat: mic.audioFormat, storyId });
    this.player?.stop();
    this.player = new AudioPlayer(16000);
    this.player._onGainReady = (gainNode, audioCtx) => {
      if (window.finkAvatarScene) window.finkAvatarScene.connectAudioTap(gainNode, audioCtx);
    };
    this.player.onActiveChange = (active) => {
      if (active) this._setSpeaking(true);
    };
    this.armResponseWatchdog('connect', 20000);

    const client = this.client;
    this.client.on('stateChange', s => {
      if (this.client !== client) return; // a replaced connection closing late
      this.setStatus(s, s === 'connected' ? 'connected' : (s === 'error' ? 'error' : ''));
      if (s === 'connected') {
        mic.enable();
        this.client?.send({ type: 'fink_settings', tts_speed: mic.ttsSpeed ?? 1.15 });
      } else {
        this.clearResponseWatchdog();
        mic.disable();
        if (s === 'disconnected' || s === 'error') {
          this.player?.stop();
          this._setSpeaking(false);
          story.setStatus(s === 'error' ? 'Connection failed.' : 'Disconnected. Choose a story to reconnect.', s === 'error' ? 'error' : 'info');
          this.client = null;
        }
      }
    });

    this.client.on('stt', text => {
      this.clearResponseWatchdog();
      story.showUserSpeech(text);
      mic.setPipelineState('thinking');
    });

    // Ink narration is already shown by ink_state; other speech (LLM replies) streams in here.
    let inkNarrating = false;

    this.client.on('tts', ev => {
      if (ev.state === 'start') {
        this.clearResponseWatchdog();
        this._setSpeaking(true);
        story.setStatus('Speaking...', 'speaking');
        if (!inkNarrating) story.startStreaming();
        if (!this.player) this.player = new AudioPlayer(16000);
        if (this.player._decoder) this.player._decoder.clearBroken();
        if (!mic.isTalking) mic.setPipelineState('speaking');
      } else if (ev.state === 'sentence_start' && ev.text) {
        if (!inkNarrating) story.appendStreaming(ev.text + ' ');
      } else if (ev.state === 'stop') {
        this.clearResponseWatchdog();
        if (!inkNarrating) story.endStreaming();
        inkNarrating = false;
        const ms = this.player ? this.player.msUntilIdle() : 0;
        setTimeout(() => {
          if (!this.player?.active) this._setSpeaking(false);
        }, ms + 50);
        if (!mic.isTalking) mic.speakingEndsIn(ms);
        story.setStatus(story.hasChoices() ? 'Your move.' : 'Ready.', 'info');
      }
    });

    this.client.on('audio', data => {
      // Audio that arrives while the user holds the talk button is dropped (they took the floor).
      if (mic.isTalking) return;
      this.player?.enqueueAuto(data);
    });

    this.client.on('inputIgnored', msg => {
      this.clearResponseWatchdog();
      mic.setPipelineState('idle');
      const text = {
        low_audio: 'Too quiet to follow. Try again.',
        ack_junk: 'Ignored stray speech.',
      }[msg.reason] ?? 'No words caught. Try again.';
      story.setStatus(text, 'info');
      mic.autoRestart();
    });

    this.client.on('inkState', msg => {
      this.clearResponseWatchdog();
      if (msg.restarted || (msg.storyId && msg.storyId !== this._storyId)) {
        if (this._storyId !== null && msg.storyId !== this._storyId && !msg.restarted) story.clear();
        this._storyId = msg.storyId ?? this._storyId;
        this.shadowRoot.querySelector('.title').textContent = msg.storyTitle ?? this.titleFor(msg.storyId) ?? 'Fink';
      }
      if (msg.narration && msg.narration.length > 0) {
        inkNarrating = true;
        for (const seg of msg.narration) {
          if (seg.image) story.addImage(seg.image);
          if (seg.text) story.addNarration(seg.text, seg.speaker);
        }
      }
      if (msg.choices) {
        const isAllNav = msg.choices.length === 1
          && NAV_WORDS.some(w => msg.choices[0].text.toLowerCase().startsWith(w));
        if (isAllNav) {
          // A lone "Next"/"Continue": advance after the audio, without asking.
          const idx = msg.choices[0].index;
          const waitMs = this.player ? this.player.msUntilIdle() : 0;
          story.setChoices(msg.choices, msg.suggestion);
          clearTimeout(this._autoAdvance);
          this._autoAdvance = setTimeout(() => {
            if (mic.isTalking) return;
            this.client?.send({ type: 'ink', action: 'choose', choice_index: idx });
          }, waitMs + 150);
        } else {
          story.setChoices(msg.choices, msg.suggestion);
        }
      }
      if (msg.isEnded) story.showEnded();
    });

    this.client.on('error', (message, raw) => {
      this.clearResponseWatchdog();
      console.error('[fink] Error:', message);
      story.setStatus(`Error: ${message}`, 'error');
      mic.setPipelineState('idle');
      mic.autoRestart();
      if (raw?.code === 'STORY_UNAVAILABLE') {
        this.showPicker(true);
        const note = this.shadowRoot.querySelector('.picker-note');
        note.className = 'note picker-note error';
        note.textContent = message;
      }
    });
    await this.client.connect();
  }
}
customElements.define('fink-app', FinkApp);
