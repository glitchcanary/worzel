// FinkWsBridge — adapts the existing Worzel WebSocket protocol into bus events.
// Borrows connection logic from fink.js WsClient (does NOT modify it).

export class FinkWsBridge {
  #bus;
  #ws = null;
  #pingInterval = null;
  #serverUrl;

  constructor(bus, { serverUrl = '' } = {}) {
    this.#bus = bus;
    this.#serverUrl = serverUrl || window.location.origin;

    // Forward client-side choices to server
    bus.subscribe('ink:choose', ({ choiceIndex }) => {
      this.#send({ type: 'ink', action: 'choose', choice_index: choiceIndex });
    });
  }

  async connect() {
    // Authenticate via OTA endpoint
    const otaUrl = this.#serverUrl.replace(/\/$/, '') + '/fink/api/ota';
    const deviceId = `infra-demo-${crypto.randomUUID().slice(0, 8)}`;

    const res = await fetch(otaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId }),
    });
    if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
    const data = await res.json();

    // Connect WebSocket
    let wsUrl = data.server_url + '?token=' + encodeURIComponent(data.token);
    if (window.location.protocol === 'https:' && wsUrl.startsWith('ws://')) {
      wsUrl = 'wss://' + wsUrl.slice(5);
    }

    this.#ws = new WebSocket(wsUrl);
    this.#ws.binaryType = 'arraybuffer';

    this.#ws.onopen = () => {
      this.#ws.send(JSON.stringify({
        type: 'hello', version: 1, transport: 'websocket',
        audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 },
        features: ['tts', 'stt'],
      }));
    };

    this.#ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        console.debug('[fink-ws] audio binary:', event.data.byteLength, 'bytes');
        this.#bus.publish('audio_frame', event.data);
        return;
      }
      try {
        const msg = JSON.parse(event.data);
        this.#handleMessage(msg);
      } catch { /* ignore parse errors */ }
    };

    this.#ws.onclose = () => this.#cleanup();
    this.#ws.onerror = () => this.#cleanup();
  }

  #handleMessage(msg) {
    switch (msg.type) {
      case 'hello':
        console.log('[fink-ws] connected, session:', msg.session_id);
        this.#startPing();
        break;

      case 'ink_state':
        console.log('[fink-ws] ink_state:', msg.knot || msg.storyId, '| narration:', msg.narration?.length, '| choices:', msg.choices?.length);
        this.#bus.publish('ink_state', msg);
        // Derive voice/media from narration tags
        this.#deriveVoiceAndMedia(msg);
        break;

      case 'tts':
        console.log('[fink-ws] tts:', msg.state, msg.text?.slice(0, 50) || '');
        this.#bus.publish('tts', {
          state: msg.state,
          text: msg.text,
          provider: msg.provider,
          fallback: msg.fallback,
        });
        break;

      case 'stt':
        this.#bus.publish('stt', { text: msg.text });
        break;

      case 'pong':
      case 'goodbye':
        break;

      default:
        // Forward any other message types as-is
        this.#bus.publish(msg.type, msg);
        break;
    }
  }

  #deriveVoiceAndMedia(inkState) {
    // Extract voice info from first narration segment
    const firstSeg = inkState.narration?.[0];
    if (firstSeg?.speaker) {
      this.#bus.publish('voice', {
        speaker: firstSeg.speaker,
        voiceId: firstSeg.voice,
        provider: firstSeg.provider,
      });
    }

    // Extract media descriptors from narration tags
    for (const seg of inkState.narration || []) {
      const tags = seg.tags || {};
      if (tags.image) this.#bus.publish('media', { type: 'image', url: tags.image, alt: tags.alt, position: tags.position });
      if (tags.audio) this.#bus.publish('media', { type: 'audio', url: tags.audio, role: tags.role, loop: tags.loop });
      if (tags.foley) this.#bus.publish('media', { type: 'foley', name: tags.foley });
    }
  }

  #send(msg) {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(msg));
    }
  }

  #startPing() {
    this.#pingInterval = setInterval(() => this.#send({ type: 'ping' }), 30000);
  }

  #cleanup() {
    if (this.#pingInterval) { clearInterval(this.#pingInterval); this.#pingInterval = null; }
    this.#ws = null;
  }

  disconnect() {
    if (this.#ws) {
      try { this.#send({ type: 'goodbye', reason: 'user_disconnect' }); } catch {}
      this.#ws.close();
    }
    this.#cleanup();
  }
}
