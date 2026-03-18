// finkapp-live.js — optional live bridge from finkapp to the Fink websocket API.
//
// This keeps the experimental renderer separate from the main /fink/ client:
// - receives server ink_state payloads and feeds them into FinkPlayer
// - sends tapped choices back as { type: 'ink', action: 'choose', choice_index }

export class FinkAppLiveClient {
  /** @type {import('./fink-player.js').FinkPlayer} */ #player;
  /** @type {HTMLElement} */ #root;
  /** @type {string} */ #apiBase;
  /** @type {WebSocket|null} */ #ws = null;
  /** @type {string|null} */ #sessionId = null;
  /** @type {string} */ #deviceId;
  /** @type {boolean} */ #connected = false;

  /**
   * @param {import('./fink-player.js').FinkPlayer} player
   * @param {HTMLElement} root
   * @param {{ apiBase?: string }} [options]
   */
  constructor(player, root, options = {}) {
    this.#player = player;
    this.#root = root;
    this.#apiBase = options.apiBase ?? detectApiBase();
    this.#deviceId = `finkapp-${crypto.randomUUID().slice(0, 8)}`;

    this.#bindEvents();
  }

  async connect() {
    this.#player.ui.setStatus('Connecting to live Fink session...', 'info');

    try {
      const ota = await fetch(`${this.#apiBase}/ota`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: this.#deviceId }),
      });
      if (!ota.ok) throw new Error(`OTA failed: HTTP ${ota.status}`);

      const data = await ota.json();
      const wsUrl = normalizeWsUrl(data.server_url, data.token);
      this.#ws = new WebSocket(wsUrl);
      this.#ws.binaryType = 'arraybuffer';

      this.#ws.onopen = () => {
        this.#send({
          type: 'hello',
          version: 1,
          transport: 'websocket',
          audio_params: {
            format: 'pcm',
            sample_rate: 16000,
            channels: 1,
            frame_duration: 60,
          },
          features: [],
        });
      };

      this.#ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        this.#handleMessage(msg);
      };

      this.#ws.onclose = () => {
        this.#connected = false;
        this.#player.ui.setStatus('Live session disconnected.', 'muted');
        this.#ws = null;
      };

      this.#ws.onerror = () => {
        this.#player.ui.setStatus('Live session error.', 'error');
      };
    } catch (err) {
      this.#player.ui.setStatus(`Live connect failed: ${err.message}`, 'error');
    }
  }

  disconnect() {
    if (!this.#ws) return;
    this.#send({ type: 'goodbye', reason: 'user_disconnect' });
    this.#ws.close();
    this.#ws = null;
    this.#connected = false;
  }

  #bindEvents() {
    this.#root.addEventListener('finkapp-choice', (event) => {
      if (!this.#connected) return;
      const choiceIndex = event.detail?.index;
      if (typeof choiceIndex !== 'number') return;
      this.#send({ type: 'ink', action: 'choose', choice_index: choiceIndex });
    });
  }

  #handleMessage(msg) {
    switch (msg.type) {
      case 'hello':
        this.#sessionId = msg.session_id ?? null;
        this.#connected = true;
        this.#player.ui.setStatus('Live session connected.', 'info');
        break;
      case 'ink_state':
        this.#player.applyInkState(msg);
        break;
      case 'error':
        this.#player.ui.setStatus(`Live error: ${msg.message}`, 'error');
        break;
      case 'goodbye':
        this.disconnect();
        break;
    }
  }

  #send(msg) {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(msg));
    }
  }
}

function detectApiBase() {
  const path = window.location.pathname;
  if (path.startsWith('/fink/') || path === '/fink') return '/fink/api';
  return '/api';
}

function normalizeWsUrl(serverUrl, token) {
  const url = new URL(serverUrl);
  if (window.location.protocol === 'https:' && url.protocol === 'ws:') {
    url.protocol = 'wss:';
  }
  if (token) {
    url.searchParams.set('token', token);
  }
  return url.toString();
}
