// Fink — Voice-Navigated Interactive Fiction Client
// Adapted from Worzel's web client. Connects to a Worzel server for
// voice (ASR/TTS) and adds an Ink story UI layer.
//
// Key differences from the Worzel chat client:
// - Story narration area instead of chat bubbles
// - Visible choice cards (tappable fallback for voice)
// - ink_state messages update the story display
// - User speech appears briefly as a transcript, not a persistent bubble

import { OpusBrowserEncoder } from '/opus-encoder.js';

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
        const fmt = (typeof AudioEncoder !== 'undefined') ? 'opus' : 'pcm';
        this.ws.send(JSON.stringify({
          type: 'hello', version: 1, transport: 'websocket',
          audio_params: { format: fmt, sample_rate: 16000, channels: 1, frame_duration: 60 },
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
  stopListening() { this.send({ type: 'listen', state: 'stop' }); }
  abort() { this.send({ type: 'abort', reason: 'user_interrupt' }); }
  send(msg) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  handleMessage(msg) {
    switch (msg.type) {
      case 'hello': this.sessionId = msg.session_id; this.setState('connected'); this.startPing(); break;
      case 'stt': this.emit('stt', msg.text); break;
      case 'tts': this.emit('tts', { state: msg.state, text: msg.text }); break;
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
    this._decoder = new AudioDecoder({
      output: (audioData) => {
        if (!this._decodedSampleRate) this._decodedSampleRate = audioData.sampleRate;
        const float32 = new Float32Array(audioData.numberOfFrames);
        audioData.copyTo(float32, { planeIndex: 0 });
        audioData.close();
        if (this._onDecoded) this._onDecoded(float32, this._decodedSampleRate);
      },
      error: (e) => console.error('[fink] Opus decoder error:', e.message),
    });
    this._decoder.configure({ codec: 'opus', sampleRate: this.sampleRate, numberOfChannels: 1 });
    this.ready = true;
  }
  decode(opusArrayBuffer) {
    if (!this.ready || !this._decoder) return;
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
  _playFloat32(float32) {
    if (!float32 || float32.length === 0) return;
    if (!this.ctx) { this.ctx = new AudioContext({ sampleRate: this.sampleRate }); this.nextTime = 0; }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const buf = this.ctx.createBuffer(1, float32.length, this.sampleRate);
    buf.getChannelData(0).set(float32);
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    if (this.nextTime <= now) this.nextTime = now;
    src.start(this.nextTime);
    this.nextTime += buf.duration;
    this._sources.push(src);
    src.onended = () => { this._sources = this._sources.filter(s => s !== src); };
  }
  stop() {
    for (const src of this._sources) { try { src.stop(); } catch {} }
    this._sources = []; this.nextTime = 0;
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
        .choice-card:hover { background: var(--fink-choice-hover, #264d7a); }
        .choice-card:active { background: var(--fink-choice-active, #2d6aa0); }
        .choice-number { color: var(--fink-accent, #e94560); font-weight: bold; margin-right: 8px; }
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

  /** Update the choice cards. */
  setChoices(choices) {
    this._choices.innerHTML = '';
    choices.forEach((choice, i) => {
      const card = document.createElement('button');
      card.className = 'choice-card';
      card.innerHTML = `<span class="choice-number">${i + 1}.</span>${this._esc(choice.text)}`;
      card.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('fink-choice', {
          bubbles: true, detail: { choiceIndex: choice.index },
        }));
      });
      this._choices.appendChild(card);
    });
  }

  /** Show story ended state. */
  showEnded() {
    this._choices.innerHTML = `
      <div class="end-card">
        The story has ended.
        <br><button onclick="this.dispatchEvent(new CustomEvent('fink-restart', { bubbles: true, composed: true }))">Start Over</button>
      </div>`;
  }

  /** Clear all content. */
  clear() {
    this._narration.innerHTML = '';
    this._choices.innerHTML = '';
    this._streamEl = null;
  }

  _clearEmpty() {
    const e = this._narration.querySelector('.empty');
    if (e) e.remove();
  }

  _esc(s) { const d = document.createElement('span'); d.textContent = s; return d.innerHTML; }
}
customElements.define('fink-story', FinkStory);

// ========================================================================
// <fink-mic> — Simplified mic button (adapted from worzel-audio)
// ========================================================================
class FinkMic extends HTMLElement {
  constructor() {
    super();
    this.recording = false;
    this._enabled = false;
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display: flex; justify-content: center; padding: 12px; }
        .wrap { display: flex; align-items: center; gap: 12px; }
        button.mic {
          width: 56px; height: 56px; border-radius: 50%;
          border: 2px solid var(--fink-accent, #e94560);
          background: var(--fink-bg, #16213e); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s; touch-action: none;
          -webkit-touch-callout: none; user-select: none;
        }
        button.mic:hover { background: #1e2a4a; }
        button.mic.rec { background: var(--fink-accent, #e94560); }
        button.mic:disabled { opacity: 0.3; cursor: default; }
        .icon { width: 24px; height: 24px; fill: var(--fink-accent, #e94560); }
        button.mic.rec .icon { fill: white; }
        .hint {
          font-size: 0.8rem; color: var(--fink-text-muted, #5a5e73);
          font-family: system-ui, sans-serif;
        }
        .state-label {
          font-size: 0.75rem; font-family: system-ui, sans-serif;
          color: var(--fink-text-secondary); min-width: 80px;
        }
        .state-label.thinking { color: #f59e0b; }
        .state-label.speaking { color: #22c55e; }
      </style>
      <div class="wrap">
        <button class="mic" disabled>
          <svg class="icon" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
        </button>
        <div>
          <div class="hint">Hold to speak</div>
          <div class="state-label"></div>
        </div>
      </div>`;
    const btn = this.shadowRoot.querySelector('button.mic');
    btn.addEventListener('pointerdown', e => { e.preventDefault(); btn.setPointerCapture(e.pointerId); this.startRec(); });
    btn.addEventListener('pointerup', e => { btn.releasePointerCapture(e.pointerId); this.stopRec(); });
    btn.addEventListener('lostpointercapture', () => { if (this.recording) this.stopRec(); });
    btn.addEventListener('touchstart', e => { e.preventDefault(); this.startRec(); }, { passive: false });
    btn.addEventListener('touchend', e => { e.preventDefault(); this.stopRec(); }, { passive: false });
    btn.addEventListener('touchcancel', () => { if (this.recording) this.stopRec(); });
  }
  enable() { this._enabled = true; this.shadowRoot.querySelector('button.mic').disabled = false; }
  disable() { this._enabled = false; this.shadowRoot.querySelector('button.mic').disabled = true; if (this.recording) this.stopRec(); }
  setPipelineState(state) {
    const label = this.shadowRoot.querySelector('.state-label');
    label.className = 'state-label';
    if (state === 'thinking') { label.classList.add('thinking'); label.textContent = 'Thinking...'; }
    else if (state === 'speaking') { label.classList.add('speaking'); label.textContent = 'Narrating...'; }
    else { label.textContent = ''; }
  }
  async startRec() {
    if (this.recording || !this._enabled) return;
    this.recording = true;
    this.shadowRoot.querySelector('button.mic').classList.add('rec');
    try {
      if (!this._encoder) {
        this._encoder = new OpusBrowserEncoder();
        await this._encoder.init();
      }
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      this.audioCtx = new AudioContext({ sampleRate: 16000 });
      const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
      await this.audioCtx.audioWorklet.addModule('/pcm-processor.js');
      const worklet = new AudioWorkletNode(this.audioCtx, 'pcm-processor');
      worklet.port.onmessage = (e) => {
        const samples = new Int16Array(e.data);
        const frames = this._encoder.encode(samples);
        for (const frame of frames) {
          this.dispatchEvent(new CustomEvent('fink-audio-data', { bubbles: true, detail: { audio: frame } }));
        }
      };
      source.connect(worklet);
      this._worklet = worklet; this._source = source;
      this.dispatchEvent(new CustomEvent('fink-recording-start', { bubbles: true }));
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
    this._worklet?.disconnect(); this._source?.disconnect();
    this.audioCtx?.close(); this.audioCtx = null;
    this.mediaStream?.getTracks().forEach(t => t.stop()); this.mediaStream = null;
    this.dispatchEvent(new CustomEvent('fink-recording-stop', { bubbles: true }));
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
    input.value = window.location.origin;

    btn.addEventListener('click', () => {
      if (this.client?.currentState === 'connected') {
        this.client.disconnect();
      } else {
        this.doConnect(input.value);
      }
    });

    const mic = this.shadowRoot.querySelector('fink-mic');
    const story = this.shadowRoot.querySelector('fink-story');

    mic.addEventListener('fink-recording-start', () => {
      this.player?.stop();
      this.client?.abort();
      mic.setPipelineState('idle');
      this.client?.startListening();
    });
    mic.addEventListener('fink-recording-stop', () => {
      this.client?.stopListening();
      mic.setPipelineState('thinking');
    });
    mic.addEventListener('fink-audio-data', e => this.client?.sendAudio(e.detail.audio));

    // Choice card tapped — send ink:choose to server
    story.addEventListener('fink-choice', e => {
      console.log('[fink] Choice tapped:', e.detail.choiceIndex);
      if (this.client?.currentState === 'connected') {
        this.client.send({
          type: 'ink',
          action: 'choose',
          choice_index: e.detail.choiceIndex,
        });
      }
    });
  }

  doConnect(serverUrl) {
    this.client = new WsClient({ serverUrl });
    this.player = new AudioPlayer(16000);

    const status = this.shadowRoot.querySelector('.status');
    const btn = this.shadowRoot.querySelector('.connect-bar button');
    const input = this.shadowRoot.querySelector('.connect-bar input');
    const story = this.shadowRoot.querySelector('fink-story');
    const mic = this.shadowRoot.querySelector('fink-mic');

    this.client.on('stateChange', s => {
      status.textContent = s;
      status.className = 'status' + (s === 'connected' ? ' connected' : '');
      btn.textContent = s === 'connected' ? 'Disconnect' : 'Connect';
      btn.classList.toggle('dc', s === 'connected');
      input.disabled = s === 'connected';
      if (s === 'connected') mic.enable();
      else { mic.disable(); if (s === 'disconnected') this.player?.stop(); }
    });

    this.client.on('stt', text => {
      console.log('[fink] You said:', text);
      story.showUserSpeech(text);
      mic.setPipelineState('thinking');
    });

    this.client.on('tts', ev => {
      if (ev.state === 'start') {
        story.startStreaming();
        if (!this.player) this.player = new AudioPlayer(16000);
        mic.setPipelineState('speaking');
      }
      else if (ev.state === 'sentence_start' && ev.text) {
        story.appendStreaming(ev.text + ' ');
      }
      else if (ev.state === 'stop') {
        story.endStreaming();
        mic.setPipelineState('idle');
      }
    });

    this.client.on('audio', data => this.player?.enqueueOpus(data));

    // Ink state updates (when server supports them)
    this.client.on('inkState', msg => {
      console.log('[fink] Ink state:', msg);
      // Update story display with narration segments
      if (msg.narration) {
        for (const seg of msg.narration) {
          story.addNarration(seg.text, seg.speaker);
        }
      }
      // Update choice cards
      if (msg.choices) {
        story.setChoices(msg.choices);
      }
      if (msg.isEnded) {
        story.showEnded();
      }
    });

    this.client.on('error', msg => console.error('[fink] Error:', msg));
    this.client.connect();
  }
}
customElements.define('fink-app', FinkApp);
