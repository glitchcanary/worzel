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
      if (window.location.protocol === 'https:' && wsUrl.startsWith('ws://')) {
        wsUrl = 'wss://' + wsUrl.slice(5);
      }
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
      case 'error': this.emit('error', msg.message); break;
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
        if (!this._rateWarned) { this._rateWarned = true; }
        this.sampleRate = decodedRate;
        if (this.ctx) { this.ctx.close(); this.ctx = null; this.nextTime = 0; }
      }
      this._playFloat32(float32);
    };
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
    if (!this.ctx) { this.ctx = new AudioContext({ sampleRate: this.sampleRate }); this.nextTime = 0; }
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
    if (!this.ctx) { this.ctx = new AudioContext({ sampleRate: buf.sampleRate || this.sampleRate }); this.nextTime = 0; }
    this._ensureGain();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this._gain);
    const now = this.ctx.currentTime;
    if (this.nextTime <= now) this.nextTime = now;
    src.start(this.nextTime);
    this.nextTime += buf.duration;
    this._sources.push(src);
    src.onended = () => {
      this._sources = this._sources.filter(s => s !== src);
      if (this._sources.length === 0 && this.onIdle) this.onIdle();
    };
  }
  _playFloat32(float32) {
    if (!float32 || float32.length === 0) return;
    if (!this.ctx) { this.ctx = new AudioContext({ sampleRate: this.sampleRate }); this.nextTime = 0; }
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
    }
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
    for (const src of this._sources) { try { src.stop(); } catch {} }
    this._sources = []; this.nextTime = 0;
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
        .narration {
          flex: 1; overflow-y: auto; padding: 16px 20px;
          line-height: 1.7; font-size: 1.05rem;
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
        }
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
      <div class="narration"><div class="empty">Connect and speak to begin a story...</div></div>
      <div class="choices"></div>`;
    this._narration = this.shadowRoot.querySelector('.narration');
    this._choices = this.shadowRoot.querySelector('.choices');
    this._lastHeardEl = null;
    this._statusEl = null;
    this._nextMoveEl = null;
  }

  /** Add an image to the narration area. */
  addImage(src) {
    this._clearEmpty();
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.style.cssText = 'max-width:100%;border-radius:8px;margin:8px 0;';
    img.onerror = () => img.remove();
    this._narration.appendChild(img);
    this._narration.scrollTop = this._narration.scrollHeight;
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

  _esc(s) { const d = document.createElement('span'); d.textContent = s; return d.innerHTML; }
}
customElements.define('fink-story', FinkStory);

// ========================================================================
// <fink-mic> — Voice input status indicator + browser speech recognition
// ========================================================================
class FinkMic extends HTMLElement {
  constructor() {
    super();
    this.recording = false;
    this._enabled = false;
    this._muted = false;
    this._suspendInputUntil = 0;
    this._browserASR = null;
    this._browserASRAvailable = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    this._browserASRSuppressed = false;
    this._suppressionTimeout = null;
    this._asrRetries = 0;
    this._state = 'offline'; // listening | hearing | thinking | narrating | muted | offline
    // Server ASR fields (kept for fallback/Firefox)
    this._useServerASR = localStorage.getItem('fink-mic-server') === 'true';
    this._hotMic = false;
    this._silenceThreshold = 1200;
    this._restartDelayMs = 900;
    this._lastAudioTime = 0;
    this._speechDetected = false;
    this._speechStartTime = 0;
    this._recordingStartTime = 0;
    this._minSpeechMs = 120;
    this._speechThreshold = 0.01;
    this._fallbackSpeechThreshold = 0.006;
    this._maxHotMicTurnMs = 7000;
    this._peakRms = 0;
    this._autoRestartTimer = null;

    const micSvg = `<svg class="mic-icon-svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
    const mutedSvg = `<svg class="mic-icon-svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>`;
    const speakerSvg = `<svg class="mic-icon-svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;

    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display: flex; justify-content: center; padding: 10px 12px; }
        .strip { display: flex; align-items: center; gap: 10px; width: 100%; }

        /* ── Mic indicator ── */
        .mic-indicator {
          width: 40px; height: 40px; border-radius: 50%;
          border: 2px solid #3a4060;
          background: var(--fink-bg, #16213e); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.25s; flex-shrink: 0;
          position: relative;
        }
        .mic-indicator:disabled { opacity: 0.3; cursor: default; }
        .mic-icon-svg { width: 20px; height: 20px; }

        /* States */
        .mic-indicator[data-state="listening"] {
          border-color: #60a5fa; color: #60a5fa;
          animation: pulse-ring 2s ease-in-out infinite;
        }
        .mic-indicator[data-state="hearing"] {
          border-color: #93c5fd; color: #93c5fd;
          background: rgba(96,165,250,0.12);
          animation: none;
        }
        .mic-indicator[data-state="thinking"] {
          border-color: #f59e0b; color: #f59e0b;
          animation: none;
        }
        .mic-indicator[data-state="narrating"] {
          border-color: #6b7280; color: #6b7280;
          animation: none;
        }
        .mic-indicator[data-state="muted"] {
          border-color: #4b5563; color: #4b5563;
          animation: none; opacity: 0.7;
        }
        .mic-indicator[data-state="offline"] {
          border-color: #374151; color: #374151;
          animation: none; opacity: 0.5;
        }

        @keyframes pulse-ring {
          0%, 100% { box-shadow: 0 0 0 0 rgba(96,165,250,0.25); }
          50% { box-shadow: 0 0 0 6px rgba(96,165,250,0); }
        }

        /* ── Info area ── */
        .mic-info { flex: 1; min-width: 0; }
        .mic-label {
          font-size: 0.78rem; font-family: system-ui, sans-serif;
          color: var(--fink-text-muted, #5a5e73);
          transition: color 0.2s;
        }
        .mic-label[data-state="listening"] { color: #60a5fa; }
        .mic-label[data-state="hearing"] { color: #93c5fd; }
        .mic-label[data-state="thinking"] { color: #f59e0b; }
        .mic-label[data-state="narrating"] { color: #6b7280; }

        .mic-interim {
          font-size: 0.72rem; font-family: system-ui, sans-serif;
          color: #93c5fd; font-style: italic;
          max-height: 1.4em; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
          opacity: 0; transition: opacity 0.15s;
        }
        .mic-interim.visible { opacity: 1; }

        /* ── Speed control ── */
        .speed-ctl { display: flex; gap: 2px; flex-shrink: 0; }
        .spd {
          background: transparent; border: 1px solid var(--fink-text-muted, #5a5e73);
          color: var(--fink-text-muted, #5a5e73); border-radius: 4px;
          font-size: 0.65rem; padding: 2px 5px; cursor: pointer;
          font-family: system-ui, sans-serif; transition: all 0.15s;
        }
        .spd:hover { border-color: var(--fink-text-secondary, #8b8fa3); color: var(--fink-text-secondary); }
        .spd.active { background: var(--fink-primary, #0f3460); border-color: var(--fink-accent, #e94560); color: var(--fink-text, #e8e8e8); }
      </style>
      <div class="strip">
        <button class="mic-indicator" data-state="offline" disabled aria-label="Toggle microphone">
          ${micSvg}
        </button>
        <div class="mic-info">
          <div class="mic-label" data-state="offline">Connecting...</div>
          <div class="mic-interim"></div>
        </div>
        <div class="speed-ctl">
          <button class="spd" data-speed="1">1x</button>
          <button class="spd active" data-speed="1.15">1.15x</button>
          <button class="spd" data-speed="1.3">1.3x</button>
          <button class="spd" data-speed="1.5">1.5x</button>
        </div>
      </div>`;

    this._micSvg = micSvg;
    this._mutedSvg = mutedSvg;
    this._speakerSvg = speakerSvg;

    // Mic indicator tap: toggle mute
    this.shadowRoot.querySelector('.mic-indicator').addEventListener('click', () => {
      if (!this._enabled) return;
      if (this._muted) {
        this._muted = false;
        this._startBrowserASR();
        this._setState('listening');
      } else {
        this._muted = true;
        this._stopBrowserASR();
        this._setState('muted');
      }
    });

    // Speed buttons
    const savedSpeed = localStorage.getItem('fink-tts-speed');
    if (savedSpeed) {
      this.ttsSpeed = parseFloat(savedSpeed);
      this.shadowRoot.querySelectorAll('.spd').forEach(b => {
        b.classList.toggle('active', parseFloat(b.dataset.speed) === this.ttsSpeed);
      });
    } else {
      this.ttsSpeed = 1.15;
    }
    this.shadowRoot.querySelectorAll('.spd').forEach(b => {
      b.addEventListener('click', () => {
        this.ttsSpeed = parseFloat(b.dataset.speed);
        localStorage.setItem('fink-tts-speed', String(this.ttsSpeed));
        this.shadowRoot.querySelectorAll('.spd').forEach(s => s.classList.remove('active'));
        b.classList.add('active');
        this.dispatchEvent(new CustomEvent('fink-speed-change', {
          bubbles: true, detail: { speed: this.ttsSpeed },
        }));
      });
    });
  }

  // ── State management ──

  _setState(state) {
    this._state = state;
    const indicator = this.shadowRoot.querySelector('.mic-indicator');
    const label = this.shadowRoot.querySelector('.mic-label');
    const interim = this.shadowRoot.querySelector('.mic-interim');
    indicator.dataset.state = state;
    label.dataset.state = state;

    const labels = {
      listening: 'Listening...',
      hearing: '', // interim text shown instead
      thinking: 'Thinking...',
      narrating: 'Narrating...',
      muted: 'Muted — tap mic to unmute',
      offline: 'Speech unavailable',
    };
    label.textContent = labels[state] || '';

    // Swap icon for narrating (speaker) and muted (slashed mic)
    if (state === 'narrating') {
      indicator.innerHTML = this._speakerSvg;
    } else if (state === 'muted') {
      indicator.innerHTML = this._mutedSvg;
    } else {
      indicator.innerHTML = this._micSvg;
    }

    // Clear interim text when not hearing
    if (state !== 'hearing') {
      interim.textContent = '';
      interim.classList.remove('visible');
    }
  }

  // ── Browser ASR ──

  _startBrowserASR() {
    if (this._browserASR) return;
    if (this._muted) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;
    this._browserASR = recognition;
    this._asrRetries = 0;

    const interim = this.shadowRoot.querySelector('.mic-interim');

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal && transcript.trim()) {
          if (this._browserASRSuppressed) {
            console.log('[fink-mic] discarded (narrating):', transcript.trim().slice(0, 60));
            return;
          }
          console.log('[fink-mic] heard:', transcript.trim());
          interim.textContent = '';
          interim.classList.remove('visible');
          this._setState('thinking');
          this.dispatchEvent(new CustomEvent('fink-stt-text', {
            bubbles: true,
            detail: { text: transcript.trim(), source: 'browser' },
          }));
        } else if (!event.results[i].isFinal && transcript.trim() && !this._browserASRSuppressed) {
          // Show interim text
          interim.textContent = transcript.trim();
          interim.classList.add('visible');
          if (this._state === 'listening') this._setState('hearing');
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.error('[fink-mic] ASR error:', event.error);
      if (event.error === 'not-allowed') {
        this._setState('offline');
      }
    };

    recognition.onend = () => {
      // Auto-restart if still enabled and not muted (cap retries to prevent loop)
      if (this._enabled && !this._muted && this._asrRetries < 10) {
        this._asrRetries++;
        this._browserASR = null;
        setTimeout(() => {
          if (this._enabled && !this._muted) this._startBrowserASR();
        }, 200);
      } else if (this._asrRetries >= 10) {
        console.warn('[fink-mic] ASR restart limit reached');
        this._browserASR = null;
        this._setState('offline');
      }
    };

    try {
      recognition.start();
      if (!this._browserASRSuppressed) this._setState('listening');
    } catch (e) {
      console.error('[fink-mic] ASR start failed:', e);
      this._browserASR = null;
    }
  }

  _stopBrowserASR() {
    if (this._browserASR) {
      try { this._browserASR.stop(); } catch {}
      this._browserASR = null;
    }
    this._browserASRSuppressed = false;
    if (this._suppressionTimeout) { clearTimeout(this._suppressionTimeout); this._suppressionTimeout = null; }
  }

  /** Suppress — keep running but discard results (TTS playing). */
  suppressBrowserASR() {
    this._browserASRSuppressed = true;
    this._setState('narrating');
    if (this._suppressionTimeout) clearTimeout(this._suppressionTimeout);
    this._suppressionTimeout = setTimeout(() => {
      if (this._browserASRSuppressed) {
        console.warn('[fink-mic] suppression safety timeout');
        this.unsuppressBrowserASR();
      }
    }, 15000);
  }

  /** Unsuppress — accept results again. */
  unsuppressBrowserASR() {
    this._browserASRSuppressed = false;
    if (this._suppressionTimeout) { clearTimeout(this._suppressionTimeout); this._suppressionTimeout = null; }
    this._asrRetries = 0; // reset retry counter
    if (this._muted) {
      this._setState('muted');
    } else {
      this._setState('listening');
      // Ensure recognition is still alive
      if (this._enabled && !this._browserASR) this._startBrowserASR();
    }
  }

  // ── Server ASR (fallback for Firefox / quality upgrade) ──

  get hotMic() { return this._hotMic; }

  async ensureEncoder() {
    if (this._encoder) return this._encoder;
    this._encoder = new OpusBrowserEncoder();
    await this._encoder.init();
    console.log(`[fink] Audio format: ${this._encoder.format}`);
    return this._encoder;
  }

  get audioFormat() {
    return this._encoder?.format ?? 'pcm';
  }

  enable() {
    this._enabled = true;
    this.shadowRoot.querySelector('.mic-indicator').disabled = false;
    if (this._browserASRAvailable && !this._useServerASR) {
      this._startBrowserASR();
    } else {
      // Firefox or explicit server ASR: start hot mic mode
      this._hotMic = true;
      this._setState('listening');
    }
  }
  disable() {
    this._enabled = false;
    this.shadowRoot.querySelector('.mic-indicator').disabled = true;
    if (this.recording) this.stopRec();
    this._stopBrowserASR();
    this.releaseAudioGraph();
    this._setState('offline');
  }
  suspendInput(ms = 1200) {
    this._suspendInputUntil = Date.now() + ms;
  }
  setPipelineState(state) {
    // Map legacy pipeline states to new state machine
    if (state === 'thinking') this._setState('thinking');
    else if (state === 'speaking') this._setState('narrating');
    else if (state === 'listening') this._setState('listening');
    else if (state === 'idle') {
      if (this._muted) this._setState('muted');
      else this._setState('listening');
    }
  }

  /** Auto-restart for server ASR hot mic mode. */
  autoRestart() {
    if (this._browserASRAvailable && !this._useServerASR) return;
    if (this._hotMic && this._enabled && !this.recording) {
      if (this._autoRestartTimer) clearTimeout(this._autoRestartTimer);
      this._autoRestartTimer = setTimeout(() => {
        this._autoRestartTimer = null;
        if (this._hotMic && this._enabled && !this.recording) this.startRec('auto');
      }, this._restartDelayMs);
    }
  }

  /** Acquire mic stream and AudioContext once, reuse across recording cycles. */
  async _ensureAudioGraph() {
    if (this.mediaStream && this.audioCtx && this.audioCtx.state !== 'closed') return;
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: 16000 },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceIsolation: true,    // Chrome 132+: AI-powered background noise removal
        latency: { ideal: 0 },  // minimize latency for real-time speech
      },
    });
    this.audioCtx = new AudioContext({ sampleRate: 16000 });
    await this.audioCtx.audioWorklet.addModule('./pcm-processor.js');
    console.log('[fink] Mic stream and AudioContext acquired (once)');
  }

  /** Tear down mic stream and AudioContext (on disconnect or disable). */
  releaseAudioGraph() {
    this._worklet?.disconnect(); this._worklet = null;
    this._source?.disconnect(); this._source = null;
    this.audioCtx?.close(); this.audioCtx = null;
    this.mediaStream?.getTracks().forEach(t => t.stop()); this.mediaStream = null;
    console.log('[fink] Audio graph released');
  }

  async startRec(source = 'manual') {
    if (this.recording || !this._enabled) return;
    if (Date.now() < this._suspendInputUntil) return;
    this.recording = true;
    this._speechDetected = false;
    this._lastAudioTime = 0;
    this._speechStartTime = 0;
    this._recordingStartTime = Date.now();
    this._peakRms = 0;
    const btn = this.shadowRoot.querySelector('button.mic');
    btn.classList.add('rec');
    if (this._hotMic) this.setPipelineState('listening');
    try {
      await this.ensureEncoder();
      await this._ensureAudioGraph();
      // Resume AudioContext if suspended (browsers suspend after inactivity)
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
      const src = this.audioCtx.createMediaStreamSource(this.mediaStream);
      const worklet = new AudioWorkletNode(this.audioCtx, 'pcm-processor');
      worklet.port.onmessage = (e) => {
        const samples = new Int16Array(e.data);
        const frames = this._encoder.encode(samples);
        for (const frame of frames) {
          this.dispatchEvent(new CustomEvent('fink-audio-data', { bubbles: true, detail: { audio: frame } }));
        }
        // Calculate RMS energy for this chunk (always, for peak tracking)
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += Math.abs(samples[i]);
        const rms = sum / samples.length / 32768;
        if (rms > this._peakRms) this._peakRms = rms;
        // Silence detection for hot-mic mode
        if (this._hotMic) {
          if (rms > this._speechThreshold) {
            if (this._speechStartTime === 0) this._speechStartTime = Date.now();
            this._lastAudioTime = Date.now();
            if (!this._speechDetected && Date.now() - this._speechStartTime >= this._minSpeechMs) {
              this._speechDetected = true;
            }
          } else if (rms > this._fallbackSpeechThreshold) {
            this._lastAudioTime = Date.now();
            if (!this._speechDetected && Date.now() - this._recordingStartTime >= 800) {
              this._speechDetected = true;
            }
          } else {
            this._speechStartTime = 0;
          }
          // Only auto-stop after speech was detected (ignore pre-speech silence)
          if (this._speechDetected && this._lastAudioTime > 0) {
            if (Date.now() - this._lastAudioTime >= this._silenceThreshold) {
              this._lastAudioTime = 0;
              this.stopRec();
            }
          }
          if (Date.now() - this._recordingStartTime >= this._maxHotMicTurnMs) {
            this.stopRec();
          }
        }
      };
      src.connect(worklet);
      this._worklet = worklet; this._source = src;
      this.dispatchEvent(new CustomEvent('fink-recording-start', {
        bubbles: true,
        detail: { source },
      }));
    } catch (err) {
      console.error('[fink] Mic error:', err);
      this.recording = false;
      this.shadowRoot.querySelector('button.mic').classList.remove('rec');
    }
  }
  async stopRec() {
    if (!this.recording) return;
    this.recording = false;
    this.shadowRoot.querySelector('button.mic').classList.remove('rec');
    if (this._encoder) {
      const remaining = await this._encoder.flush();
      for (const frame of remaining) {
        this.dispatchEvent(new CustomEvent('fink-audio-data', { bubbles: true, detail: { audio: frame } }));
      }
    }
    // Disconnect worklet and source node, but keep AudioContext and MediaStream alive
    this._worklet?.disconnect(); this._worklet = null;
    this._source?.disconnect(); this._source = null;
    const peakRms = this._peakRms;
    this.dispatchEvent(new CustomEvent('fink-recording-stop', {
      bubbles: true, detail: {
        hadSpeech: this._speechDetected || this._peakRms > this._fallbackSpeechThreshold || !this._hotMic,
        peakRms,
      },
    }));
    this._speechDetected = false;
    this._speechStartTime = 0;
    this._recordingStartTime = 0;
    this._peakRms = 0;
  }
}
customElements.define('fink-mic', FinkMic);

// ========================================================================
// <fink-app> — Root component
// ========================================================================
class FinkApp extends HTMLElement {
  constructor() {
    super();
    this.client = null;
    this.player = null;
    this._isSpeaking = false;
    this._responseWatchdog = null;
    this._suppressNextRecordingStop = false;
    this._onKeyDown = (e) => this.handleKeyDown(e);
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host {
          display: flex; flex-direction: column; height: 100%;
          background: var(--fink-bg, #16213e); color: var(--fink-text, #e8e8e8);
          border: 1px solid var(--fink-border, #1a1a3e); border-radius: 12px; overflow: hidden;
        }
        header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 16px; background: var(--fink-header-bg, #0f3460);
          border-bottom: 1px solid var(--fink-border);
        }
        .title { font-family: 'Georgia', serif; font-size: 1.1rem; font-weight: 600; letter-spacing: 0.03em; }
        .status { font-size: 0.75rem; color: var(--fink-text-muted); font-family: system-ui, sans-serif; }
        .status.connected { color: #22c55e; }
        .connect-bar {
          display: flex; gap: 8px; padding: 10px 16px;
          border-bottom: 1px solid var(--fink-border);
          font-family: system-ui, sans-serif;
        }
        .connect-bar input {
          flex: 1; padding: 6px 10px; border: 1px solid var(--fink-border);
          border-radius: 6px; font-size: 0.85rem;
          background: var(--fink-narration-bg); color: var(--fink-text);
        }
        .connect-bar button {
          padding: 6px 14px; border: none; border-radius: 6px;
          background: var(--fink-accent, #e94560); color: white;
          font-size: 0.85rem; cursor: pointer; white-space: nowrap;
        }
        .connect-bar button:hover { opacity: 0.9; }
        .connect-bar button.dc { background: #666; }
        .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        footer { border-top: 1px solid var(--fink-border); }
      </style>
      <header>
        <span class="title">Fink</span>
        <span class="status">disconnected</span>
      </header>
      <div class="connect-bar">
        <input type="url" placeholder="Worzel server URL" />
        <button>Connect</button>
      </div>
      <div class="main"><fink-story></fink-story></div>
      <footer><fink-mic></fink-mic></footer>`;
  }

  connectedCallback() {
    const input = this.shadowRoot.querySelector('.connect-bar input');
    const btn = this.shadowRoot.querySelector('.connect-bar button');
    const basePath = window.location.pathname.startsWith('/fink') ? '/fink' : '';
    input.value = window.location.origin + basePath;

    btn.addEventListener('click', async () => {
      if (this.client?.currentState === 'connected') {
        this.client.disconnect();
      } else {
        await this.doConnect(input.value);
      }
    });

    const mic = this.shadowRoot.querySelector('fink-mic');
    const story = this.shadowRoot.querySelector('fink-story');
    window.addEventListener('keydown', this._onKeyDown, true);

    mic.addEventListener('fink-recording-start', async (e) => {
      const source = e.detail?.source ?? 'manual';
      if (this._isSpeaking) {
        if (source !== 'manual') {
          this._suppressNextRecordingStop = true;
          await mic.stopRec();
          story.setStatus('Waiting for the voice to finish.', 'info');
          return;
        }
        story.setStatus('Breaking in...', 'thinking');
        await this.player?.fadeStop(200);
      }
      story.setStatus('Listening...', 'listening');
      this.client?.abort();
      mic.setPipelineState('listening');
      this.client?.startListening();
    });
    mic.addEventListener('fink-recording-stop', (e) => {
      if (this._suppressNextRecordingStop) {
        this._suppressNextRecordingStop = false;
        return;
      }
      // In hot-mic mode, skip server call if no speech was detected
      if (e.detail?.hadSpeech === false) {
        story.setStatus('No speech detected. Try again when ready.', 'error');
        mic.autoRestart();
        return;
      }
      const peakRms = e.detail?.peakRms;
      story.setStatus('Interpreting...', 'thinking');
      this.armResponseWatchdog(story, mic, 'speech recognition');
      this.client?.stopListening(peakRms != null ? { audio_level: Math.round(peakRms * 1000) / 1000 } : undefined);
      mic.setPipelineState('thinking');
    });
    mic.addEventListener('fink-audio-data', e => this.client?.sendAudio(e.detail.audio));

    // Browser ASR: text comes directly, no audio streaming needed
    mic.addEventListener('fink-stt-text', e => {
      const text = e.detail.text;
      // Length guard: human utterances are short. Anything over 100 chars is echo.
      if (text.length > 100) {
        console.log('[fink] Discarding long ASR text (likely echo):', text.slice(0, 60));
        return;
      }
      // Echo detection: if ASR text overlaps heavily with last TTS narration, discard
      if (this._lastNarrationText && text.length > 20) {
        const heard = text.toLowerCase();
        const narration = this._lastNarrationText;
        // Check if >50% of the heard words appear in the narration
        const words = heard.split(/\s+/);
        const matchCount = words.filter(w => w.length > 2 && narration.includes(w)).length;
        if (matchCount / words.length > 0.5) {
          console.log('[fink] Echo detected, discarding:', text.slice(0, 60));
          return;
        }
      }
      console.log('[fink] Browser ASR text:', text);
      story.setStatus('Interpreting...', 'thinking');
      mic.setPipelineState('thinking');
      this.armResponseWatchdog(story, mic, 'browser speech');
      this.client?.send({ type: 'stt_text', text });
    });

    mic.addEventListener('fink-speed-change', e => {
      this.client?.send({ type: 'fink_settings', tts_speed: e.detail.speed });
    });

    // Choice card tapped — kill audio immediately, abort server, advance
    story.addEventListener('fink-choice', e => {
      console.log('[fink] Choice tapped:', e.detail.choiceIndex);
      if (this.client?.currentState === 'connected') {
        mic.suspendInput(1500);
        this.player?.stop();           // hard stop — no fade, no backlog
        this._isSpeaking = false;
        mic.suppressBrowserASR();      // suppress until new TTS starts
        this.client.abort();
        story.setStatus('Advancing...', 'thinking');
        this.armResponseWatchdog(story, mic, 'story advance');
        this.client.send({
          type: 'ink',
          action: 'choose',
          choice_index: e.detail.choiceIndex,
        });
      }
    });
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this._onKeyDown, true);
    this.clearResponseWatchdog();
  }

  async handleKeyDown(e) {
    const story = this.shadowRoot?.querySelector('fink-story');
    const mic = this.shadowRoot?.querySelector('fink-mic');
    if (!story || !mic) return;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.composedPath?.()[0];
    const tagName = target?.tagName?.toLowerCase?.();
    const isEditable = target?.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    if (isEditable) return;

    if (e.key === 'Tab' && story.hasChoices()) {
      e.preventDefault();
      story.focusChoice(e.shiftKey ? -1 : 1);
      return;
    }

    if (e.key === ' ' || e.code === 'Space') {
      if (this._isSpeaking) {
        e.preventDefault();
        // Quick fade (150ms) then hard stop — no lingering backlog
        this.client?.abort();
        await this.player?.fadeStop(150);
        this._isSpeaking = false;
        mic.setPipelineState('idle');
        if (story.hasChoices()) {
          story.setStatus('Pick a choice.', 'info');
        } else {
          story.setStatus('Skipped.', 'info');
        }
        mic.autoRestart();
        mic.unsuppressBrowserASR();
        return;
      }
      if (story.activateFocusedChoice()) {
        e.preventDefault();
      }
    }
  }

  armResponseWatchdog(story, mic, context) {
    this.clearResponseWatchdog();
    this._responseWatchdog = {
      warn: setTimeout(() => {
        console.warn(`[fink] Still waiting for server response after ${context}`);
        story.setStatus('Still thinking. If this stalls, try the move again.', 'thinking');
      }, 6000),
      fail: setTimeout(() => {
        console.error(`[fink] No server response after ${context}`);
        mic.setPipelineState('idle');
        story.setStatus('No reply yet. Try again when ready.', 'error');
        mic.autoRestart();
      }, 12000),
    };
  }

  clearResponseWatchdog() {
    if (!this._responseWatchdog) return;
    clearTimeout(this._responseWatchdog.warn);
    clearTimeout(this._responseWatchdog.fail);
    this._responseWatchdog = null;
  }

  async doConnect(serverUrl) {
    const status = this.shadowRoot.querySelector('.status');
    const btn = this.shadowRoot.querySelector('.connect-bar button');
    const input = this.shadowRoot.querySelector('.connect-bar input');
    const story = this.shadowRoot.querySelector('fink-story');
    const mic = this.shadowRoot.querySelector('fink-mic');

    await mic.ensureEncoder();

    this.client = new WsClient({
      serverUrl,
      audioFormat: mic.audioFormat,
    });
    this.player = new AudioPlayer(16000);
    this._serverTtsDone = false;

    // When all audio buffers finish playing AND server is done sending, unsuppress mic
    this.player.onIdle = () => {
      if (!this._serverTtsDone) return; // server still sending — more audio coming
      this._isSpeaking = false;
      this._serverTtsDone = false;
      mic.setPipelineState('idle');
      story.setStatus('Ready.', 'info');
      mic.autoRestart();
      mic.unsuppressBrowserASR();
    };

    this.client.on('stateChange', s => {
      status.textContent = s;
      status.className = 'status' + (s === 'connected' ? ' connected' : '');
      btn.textContent = s === 'connected' ? 'Disconnect' : 'Connect';
      btn.classList.toggle('dc', s === 'connected');
      input.disabled = s === 'connected';
      if (s === 'connected') {
        this.clearResponseWatchdog();
        story.setStatus('Connected.', 'info');
        mic.enable();
        // Send initial TTS speed preference
        this.client?.send({ type: 'fink_settings', tts_speed: mic.ttsSpeed ?? 1.15 });
      }
      else {
        this.clearResponseWatchdog();
        mic.disable();
        if (s === 'disconnected') this.player?.stop();
        story.setStatus(`Connection state: ${s}.`, s === 'error' ? 'error' : 'info');
      }
    });

    this.client.on('stt', text => {
      this.clearResponseWatchdog();
      console.log('[fink] You said:', text);
      story.showUserSpeech(text);
      mic.setPipelineState('thinking');
    });

    // Track whether current TTS is narrating ink content (already displayed)
    // vs LLM discussion content (needs streaming display)
    let inkNarrating = false;

    this.client.on('tts', ev => {
      if (ev.provider) {
        console.log(`[fink] TTS provider: ${ev.provider}${ev.fallback ? ' (fallback)' : ''}`);
      }
      if (ev.state === 'start') {
        this.clearResponseWatchdog();
        this._isSpeaking = true;
        story.setStatus('Speaking...', 'speaking');
        if (!inkNarrating) story.startStreaming();
        if (!this.player) this.player = new AudioPlayer(16000);
        // Reset decoder broken flag for new TTS segment (different provider may work)
        if (this.player._decoder) this.player._decoder.clearBroken();
        mic.setPipelineState('speaking');
        mic.suppressBrowserASR();
      }
      else if (ev.state === 'sentence_start' && ev.text) {
        if (!inkNarrating) story.appendStreaming(ev.text + ' ');
      }
      else if (ev.state === 'stop') {
        this.clearResponseWatchdog();
        if (!inkNarrating) story.endStreaming();
        inkNarrating = false;
        // Mark server done sending. If audio already finished playing,
        // unsuppress now. Otherwise onIdle will handle it.
        this._serverTtsDone = true;
        if (this.player && this.player._sources.length === 0) {
          this._isSpeaking = false;
          this._serverTtsDone = false;
          mic.setPipelineState('idle');
          story.setStatus('Ready.', 'info');
          mic.autoRestart();
          mic.unsuppressBrowserASR();
        }
      }
    });

    this.client.on('audio', data => {
      // Suppress on first audio frame only — don't re-suppress on every frame
      if (!this._isSpeaking) {
        this._isSpeaking = true;
        mic.suppressBrowserASR();
        mic.setPipelineState('speaking');
      }
      this.player?.enqueueAuto(data);
    });

    this.client.on('inputIgnored', msg => {
      this.clearResponseWatchdog();
      mic.setPipelineState('idle');
      if (msg.reason === 'low_audio') {
        story.setStatus('Too quiet to follow. Try again when ready.', 'info');
      } else if (msg.reason === 'ack_junk') {
        story.setStatus('Ignoring stray speech. Your next move is open.', 'info');
      } else {
        story.setStatus('No words caught there. Try again when ready.', 'info');
      }
      mic.autoRestart();
    });

    // Ink state updates — text already displayed here, suppress TTS streaming display
    this.client.on('inkState', msg => {
      this.clearResponseWatchdog();
      console.log('[fink] Ink state:', msg);
      // Track last narration text for echo detection
      if (msg.narration && msg.narration.length > 0) {
        inkNarrating = true;
        this._lastNarrationText = msg.narration.map(s => s.text).join(' ').toLowerCase();
        story.setStatus('Advanced.', 'info');
        for (const seg of msg.narration) {
          if (seg.image) story.addImage(seg.image);
          story.addNarration(seg.text, seg.speaker);
        }
      }
      if (msg.choices) {
        const navWords = ['next', 'try again', 'back', 'continue', 'get my results'];
        const isAllNav = msg.choices.length > 0 && msg.choices.every(
          c => navWords.some(w => c.text.toLowerCase().startsWith(w))
        );

        if (isAllNav && msg.choices.length === 1) {
          // Single nav choice (e.g. "Next") — auto-advance after TTS finishes
          // Don't show choices, don't unsuppress mic, just wait and advance
          const autoChoiceIndex = msg.choices[0].index;
          const doAutoAdvance = () => {
            console.log('[fink] Auto-advancing (single nav choice)');
            this.player?.stop();
            this._isSpeaking = false;
            this.client?.send({ type: 'ink', action: 'choose', choice_index: autoChoiceIndex });
          };
          // Auto-advance when player goes idle, or after a short delay if no audio
          if (this.player && this.player._sources.length > 0) {
            const prevOnIdle = this.player.onIdle;
            this.player.onIdle = () => {
              this.player.onIdle = prevOnIdle;
              doAutoAdvance();
            };
          } else {
            setTimeout(doAutoAdvance, 500);
          }
        } else {
          story.setChoices(msg.choices, msg.suggestion);
          // Choices visible = user's turn. Unsuppress immediately.
          // Echo detection handles any lingering TTS audio in the ASR buffer.
          this._isSpeaking = false;
          this._serverTtsDone = false;
          mic.unsuppressBrowserASR();
          mic.setPipelineState('idle');
          if (!msg.narration || msg.narration.length === 0) {
            story.setStatus('Options updated.', 'info');
          }
        }
      }
      if (msg.isEnded) {
        story.showEnded();
      }
    });

    this.client.on('error', msg => {
      this.clearResponseWatchdog();
      console.error('[fink] Error:', msg);
      story.setStatus(`Error: ${msg}`, 'error');
    });
    this.client.connect();
  }
}
customElements.define('fink-app', FinkApp);
