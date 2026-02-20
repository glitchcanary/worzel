// Worzel Voice Assistant — Browser Client
// All Web Components in a single external script (CSP-compliant).
import { OpusBrowserEncoder } from '/opus-encoder.js';

// ========================================================================
// WsClient — WebSocket protocol client
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
      const deviceId = this.options.deviceId ?? `browser-${crypto.randomUUID().slice(0, 8)}`;
      const response = await fetch(otaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId }),
      });
      if (!response.ok) throw new Error(`OTA auth failed: ${response.status}`);
      const data = await response.json();
      this.token = data.token;

      this.setState('connecting');
      const wsUrl = data.server_url + '?token=' + encodeURIComponent(this.token);
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        // Detect audio format: WebCodecs AudioEncoder → opus, otherwise pcm fallback
        const fmt = (typeof AudioEncoder !== 'undefined') ? 'opus' : 'pcm';
        console.log(`[worzel] Hello with audio format: ${fmt}`);
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
  sendAudio(data) { if (this.ws?.readyState === 1) { this.ws.send(data); this._audioChunks = (this._audioChunks || 0) + 1; } }
  startListening(mode = 'manual') { this._audioChunks = 0; this.send({ type: 'listen', state: 'start', mode }); console.log('[worzel] listen:start sent'); }
  stopListening() { console.log('[worzel] listen:stop sent, audio chunks:', this._audioChunks); this.send({ type: 'listen', state: 'stop' }); }
  abort() { this.send({ type: 'abort', reason: 'user_interrupt' }); }
  send(msg) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  handleMessage(msg) {
    switch (msg.type) {
      case 'hello': this.sessionId = msg.session_id; this.setState('connected'); this.startPing(); break;
      case 'stt': this.emit('stt', msg.text); break;
      case 'tts': this.emit('tts', { state: msg.state, text: msg.text }); break;
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
// AudioPlayer — queued PCM playback via Web Audio API
// ========================================================================
class AudioPlayer {
  constructor(sampleRate = 24000) {
    this.sampleRate = sampleRate;
    this.ctx = null;
    this.queue = [];
    this.playing = false;
    this.nextTime = 0;
  }
  /** Queue a chunk of int16 PCM for playback */
  enqueue(pcmArrayBuffer) {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: this.sampleRate });
    // Convert int16 PCM to float32
    const int16 = new Int16Array(pcmArrayBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
    // Create AudioBuffer and schedule
    const buf = this.ctx.createBuffer(1, float32.length, this.sampleRate);
    buf.getChannelData(0).set(float32);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    const startAt = Math.max(now, this.nextTime);
    src.start(startAt);
    this.nextTime = startAt + buf.duration;
  }
  /** Stop playback and clear queue */
  stop() {
    this.nextTime = 0;
    if (this.ctx) { this.ctx.close(); this.ctx = null; }
  }
}

// ========================================================================
// <worzel-status>
// ========================================================================
class WorzelStatus extends HTMLElement {
  static get observedAttributes() { return ['state']; }
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display:inline-flex; align-items:center; gap:8px; font-family:var(--worzel-font,system-ui,sans-serif); font-size:0.85rem; color:var(--worzel-text-secondary,#666); }
        .dot { width:8px; height:8px; border-radius:50%; background:var(--worzel-color-disconnected,#ccc); }
        :host([state=connected]) .dot { background:var(--worzel-color-connected,#22c55e); }
        :host([state=connecting]) .dot, :host([state=authenticating]) .dot { background:var(--worzel-color-connecting,#f59e0b); animation:p 1s infinite; }
        :host([state=error]) .dot { background:var(--worzel-color-error,#ef4444); }
        @keyframes p { 50% { opacity:0.5; } }
      </style>
      <span class="dot"></span><span class="label">Disconnected</span>`;
  }
  attributeChangedCallback(n, _, v) {
    if (n === 'state') {
      const m = { disconnected:'Disconnected', connecting:'Connecting...', authenticating:'Authenticating...', connected:'Connected', error:'Error' };
      this.shadowRoot.querySelector('.label').textContent = m[v] ?? v;
    }
  }
}
customElements.define('worzel-status', WorzelStatus);

// ========================================================================
// <worzel-connect>
// ========================================================================
class WorzelConnect extends HTMLElement {
  constructor() {
    super();
    this._connected = false;
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display:flex; align-items:center; gap:8px; font-family:var(--worzel-font,system-ui,sans-serif); }
        input { flex:1; padding:6px 10px; border:1px solid var(--worzel-border,#d1d5db); border-radius:6px; font-size:0.9rem; background:var(--worzel-input-bg,#fff); color:var(--worzel-text,#1f2937); }
        input:focus { outline:2px solid var(--worzel-primary,#3b82f6); outline-offset:-1px; }
        button { padding:6px 16px; border:none; border-radius:6px; font-size:0.9rem; cursor:pointer; background:var(--worzel-primary,#3b82f6); color:white; white-space:nowrap; }
        button:hover { opacity:0.9; }
        button.dc { background:var(--worzel-danger,#ef4444); }
        button:disabled { opacity:0.5; cursor:default; }
      </style>
      <input type="url" placeholder="http://localhost:3000" value="http://localhost:3000" />
      <button>Connect</button>`;
    this.shadowRoot.querySelector('button').addEventListener('click', () => {
      if (this._connected) this.dispatchEvent(new CustomEvent('worzel-disconnect', { bubbles: true }));
      else this.dispatchEvent(new CustomEvent('worzel-connect', { bubbles: true, detail: { serverUrl: this.shadowRoot.querySelector('input').value } }));
    });
  }
  set connected(v) {
    this._connected = v;
    const btn = this.shadowRoot.querySelector('button');
    btn.textContent = v ? 'Disconnect' : 'Connect';
    btn.classList.toggle('dc', v);
    this.shadowRoot.querySelector('input').disabled = v;
  }
  set serverUrl(v) { this.shadowRoot.querySelector('input').value = v; }
}
customElements.define('worzel-connect', WorzelConnect);

// ========================================================================
// <worzel-chat>
// ========================================================================
class WorzelChat extends HTMLElement {
  constructor() {
    super();
    this.currentMsg = null;
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display:flex; flex-direction:column; flex:1; overflow:hidden; font-family:var(--worzel-font,system-ui,sans-serif); }
        .msgs { flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:8px; }
        .m { max-width:80%; padding:8px 12px; border-radius:12px; font-size:0.95rem; line-height:1.4; word-break:break-word; }
        .m.user { align-self:flex-end; background:var(--worzel-primary,#3b82f6); color:white; border-bottom-right-radius:4px; }
        .m.asst { align-self:flex-start; background:var(--worzel-assistant-bg,#f3f4f6); color:var(--worzel-text,#1f2937); border-bottom-left-radius:4px; }
        .m.asst.streaming { opacity:0.8; }
        .empty { display:flex; align-items:center; justify-content:center; flex:1; color:var(--worzel-text-secondary,#9ca3af); font-style:italic; }
      </style>
      <div class="msgs"><div class="empty">Press and hold to talk</div></div>`;
    this.container = this.shadowRoot.querySelector('.msgs');
  }
  addUserMessage(text) {
    this.clearEmpty();
    const el = document.createElement('div'); el.className = 'm user'; el.textContent = text;
    this.container.appendChild(el); this.container.scrollTop = this.container.scrollHeight;
  }
  startAssistantMessage() {
    this.clearEmpty();
    this.currentMsg = document.createElement('div'); this.currentMsg.className = 'm asst streaming';
    this.container.appendChild(this.currentMsg); this.container.scrollTop = this.container.scrollHeight;
  }
  appendAssistantText(text) {
    if (this.currentMsg) { this.currentMsg.textContent += text; this.container.scrollTop = this.container.scrollHeight; }
  }
  endAssistantMessage() {
    if (this.currentMsg) { this.currentMsg.classList.remove('streaming'); this.currentMsg = null; }
  }
  clearEmpty() { const e = this.container.querySelector('.empty'); if (e) e.remove(); }
}
customElements.define('worzel-chat', WorzelChat);

// ========================================================================
// <worzel-audio>
// ========================================================================
class WorzelAudio extends HTMLElement {
  constructor() {
    super();
    this.recording = false;
    this.audioCtx = null;
    this.mediaStream = null;
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display:flex; justify-content:center; padding:16px; font-family:var(--worzel-font,system-ui,sans-serif); }
        .wrap { position:relative; display:flex; flex-direction:column; align-items:center; }
        .ring { position:absolute; top:50%; left:50%; width:72px; height:72px; border-radius:50%; background:var(--worzel-primary,#3b82f6); opacity:0; transform:translate(-50%,-50%) scale(1); pointer-events:none; transition:opacity 0.1s; }
        button { position:relative; width:72px; height:72px; border-radius:50%; border:3px solid var(--worzel-primary,#3b82f6); background:var(--worzel-bg,#fff); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.15s; z-index:1; }
        button:hover { background:var(--worzel-hover-bg,#f0f4ff); }
        button.rec { background:var(--worzel-primary,#3b82f6); border-color:var(--worzel-primary,#3b82f6); }
        button:disabled { opacity:0.4; cursor:default; }
        .icon { width:28px; height:28px; fill:var(--worzel-primary,#3b82f6); }
        button.rec .icon { fill:white; }
        .hint { margin-top:8px; font-size:0.75rem; color:var(--worzel-text-secondary,#9ca3af); text-align:center; }
      </style>
      <div class="wrap">
        <div class="ring"></div>
        <button disabled>
          <svg class="icon" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
        </button>
        <div class="hint">Hold to talk</div>
      </div>`;
    const btn = this.shadowRoot.querySelector('button');
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      this.startRec();
    });
    btn.addEventListener('pointerup', e => {
      btn.releasePointerCapture(e.pointerId);
      this.stopRec();
    });
    btn.addEventListener('lostpointercapture', () => {
      if (this.recording) this.stopRec();
    });
  }
  enable() { this.shadowRoot.querySelector('button').disabled = false; }
  disable() { this.shadowRoot.querySelector('button').disabled = true; if (this.recording) this.stopRec(); }
  async startRec() {
    if (this.recording) return;
    this.recording = true;
    this.shadowRoot.querySelector('button').classList.add('rec');
    try {
      // Init encoder on first use (Opus via WebCodecs, or PCM fallback)
      if (!this._encoder) {
        this._encoder = new OpusBrowserEncoder();
        await this._encoder.init();
        console.log(`[worzel] Audio format: ${this._encoder.format}`);
      }
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate:16000, channelCount:1, echoCancellation:true, noiseSuppression:true } });
      this.audioCtx = new AudioContext({ sampleRate: 16000 });
      const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
      await this.audioCtx.audioWorklet.addModule('/pcm-processor.js');
      const worklet = new AudioWorkletNode(this.audioCtx, 'pcm-processor');
      const ring = this.shadowRoot.querySelector('.ring');
      worklet.port.onmessage = (e) => {
        const samples = new Int16Array(e.data);
        // Encode PCM → Opus frames (or pass through raw PCM on fallback)
        const frames = this._encoder.encode(samples);
        for (const frame of frames) {
          this.dispatchEvent(new CustomEvent('worzel-audio-data', { bubbles:true, detail:{ audio: frame } }));
        }
        // Visualise mic level
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += Math.abs(samples[i]);
        const rms = sum / samples.length / 32768;
        const scale = 1 + rms * 3;
        ring.style.opacity = Math.min(0.35, rms * 2);
        ring.style.transform = `translate(-50%,-50%) scale(${scale})`;
      };
      source.connect(worklet);
      this._worklet = worklet; this._source = source; this._ring = ring;
      console.log('[worzel] Recording started (AudioWorklet → Opus, 16kHz 60ms frames)');
      this.dispatchEvent(new CustomEvent('worzel-recording-start', { bubbles: true }));
    } catch (err) {
      console.error('[worzel] Mic error:', err);
      this.recording = false;
      this.shadowRoot.querySelector('button').classList.remove('rec');
      this.shadowRoot.querySelector('.hint').textContent = 'Mic error: ' + (err.message || err);
    }
  }
  async stopRec() {
    if (!this.recording) return;
    this.recording = false;
    this.shadowRoot.querySelector('button').classList.remove('rec');
    // Flush any remaining samples in the encoder (async for WebCodecs)
    if (this._encoder) {
      const remaining = await this._encoder.flush();
      for (const frame of remaining) {
        this.dispatchEvent(new CustomEvent('worzel-audio-data', { bubbles:true, detail:{ audio: frame } }));
      }
    }
    this._worklet?.disconnect(); this._source?.disconnect();
    this.audioCtx?.close(); this.audioCtx = null;
    this.mediaStream?.getTracks().forEach(t => t.stop()); this.mediaStream = null;
    if (this._ring) { this._ring.style.opacity = 0; this._ring.style.transform = 'translate(-50%,-50%) scale(1)'; }
    console.log('[worzel] Recording stopped');
    this.dispatchEvent(new CustomEvent('worzel-recording-stop', { bubbles: true }));
  }
}
customElements.define('worzel-audio', WorzelAudio);

// ========================================================================
// <worzel-app> — root component
// ========================================================================
class WorzelApp extends HTMLElement {
  static get observedAttributes() { return ['server']; }
  constructor() {
    super();
    this.client = null;
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display:flex; flex-direction:column; height:100%; max-height:100vh; font-family:var(--worzel-font,system-ui,-apple-system,sans-serif); background:var(--worzel-bg,#fff); color:var(--worzel-text,#1f2937); border:1px solid var(--worzel-border,#e5e7eb); border-radius:12px; overflow:hidden; }
        header { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--worzel-border,#e5e7eb); background:var(--worzel-header-bg,#f9fafb); }
        .title { font-weight:600; font-size:1rem; }
        .main { flex:1; display:flex; flex-direction:column; overflow:hidden; }
        .bar { padding:12px 16px; border-bottom:1px solid var(--worzel-border,#e5e7eb); }
        footer { border-top:1px solid var(--worzel-border,#e5e7eb); }
      </style>
      <header>
        <span class="title">Worzel</span>
        <worzel-status state="disconnected"></worzel-status>
      </header>
      <div class="bar"><worzel-connect></worzel-connect></div>
      <div class="main"><worzel-chat></worzel-chat></div>
      <footer><worzel-audio></worzel-audio></footer>`;
  }
  connectedCallback() {
    const url = this.getAttribute('server');
    if (url) this.shadowRoot.querySelector('worzel-connect').serverUrl = url;

    this.shadowRoot.querySelector('worzel-connect').addEventListener('worzel-connect', e => this.doConnect(e.detail.serverUrl));
    this.shadowRoot.querySelector('worzel-connect').addEventListener('worzel-disconnect', () => this.client?.disconnect());
    this.shadowRoot.querySelector('worzel-audio').addEventListener('worzel-recording-start', () => this.client?.startListening());
    this.shadowRoot.querySelector('worzel-audio').addEventListener('worzel-recording-stop', () => this.client?.stopListening());
    this.shadowRoot.querySelector('worzel-audio').addEventListener('worzel-audio-data', e => this.client?.sendAudio(e.detail.audio));
  }
  doConnect(serverUrl) {
    this.client = new WsClient({ serverUrl });
    this.player = new AudioPlayer(24000);
    const status = this.shadowRoot.querySelector('worzel-status');
    const conn = this.shadowRoot.querySelector('worzel-connect');
    const chat = this.shadowRoot.querySelector('worzel-chat');
    const audio = this.shadowRoot.querySelector('worzel-audio');
    this.client.on('stateChange', s => {
      status.setAttribute('state', s);
      conn.connected = s === 'connected';
      s === 'connected' ? audio.enable() : audio.disable();
      if (s === 'disconnected') this.player?.stop();
    });
    this.client.on('stt', text => { console.log('[worzel] STT:', text); chat.addUserMessage(text); });
    this.client.on('tts', ev => {
      if (ev.state === 'start') { console.log('[worzel] TTS start'); chat.startAssistantMessage(); this.player?.stop(); this.player = new AudioPlayer(24000); }
      else if (ev.state === 'sentence_start' && ev.text) { console.log('[worzel] TTS segment:', ev.text); chat.appendAssistantText(ev.text + ' '); }
      else if (ev.state === 'stop') { console.log('[worzel] TTS stop'); chat.endAssistantMessage(); }
    });
    this.client.on('audio', data => { this.player?.enqueue(data); });
    this.client.on('error', msg => console.error('[worzel] Error:', msg));
    this.client.connect();
  }
}
customElements.define('worzel-app', WorzelApp);
