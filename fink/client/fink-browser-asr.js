// FinkBrowserASR — bus service for in-browser speech recognition.
// Uses Web Speech API (SpeechRecognition / webkitSpeechRecognition)
// when available (Chrome, Edge, Safari). Falls back gracefully.
//
// Subscribes to: `listen` (start/stop)
// Publishes: `stt` (transcription), `listen_state` (status)

export class FinkBrowserASR {
  #bus;
  #unsubs = [];
  #recognition = null;
  #available = false;
  #listening = false;

  constructor(bus) {
    this.#bus = bus;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[fink-asr] Web Speech API not available in this browser');
      bus.publish('listen_state', { available: false, reason: 'Web Speech API not supported' });
      return;
    }

    this.#available = true;
    this.#recognition = new SpeechRecognition();
    this.#recognition.continuous = false;   // stop after each utterance
    this.#recognition.interimResults = true; // show partial results
    this.#recognition.lang = 'en-US';
    this.#recognition.maxAlternatives = 1;

    this.#recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }
      if (finalText) {
        console.log('[fink-asr] final:', finalText);
        bus.publish('stt', { text: finalText, source: 'browser' });
      }
      if (interimText) {
        bus.publish('stt_interim', { text: interimText, source: 'browser' });
      }
    };

    this.#recognition.onerror = (event) => {
      // 'no-speech' and 'aborted' are normal, not real errors
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.error('[fink-asr] error:', event.error);
      bus.publish('listen_state', { state: 'error', error: event.error });
    };

    this.#recognition.onend = () => {
      this.#listening = false;
      bus.publish('listen_state', { state: 'stopped' });
    };

    this.#recognition.onstart = () => {
      this.#listening = true;
      bus.publish('listen_state', { state: 'listening' });
    };

    // Subscribe to listen commands on the bus
    this.#unsubs.push(
      bus.subscribe('listen', (data) => {
        if (data.state === 'start') this.start();
        else if (data.state === 'stop') this.stop();
      }),
    );

    bus.publish('listen_state', { available: true, state: 'ready' });
    console.log('[fink-asr] Web Speech API ready');
  }

  get available() { return this.#available; }

  start() {
    if (!this.#available || !this.#recognition) return;
    if (this.#listening) return;
    try {
      this.#recognition.start();
    } catch (e) {
      // Already started — ignore
      console.debug('[fink-asr] start error (likely already running):', e.message);
    }
  }

  stop() {
    if (!this.#available || !this.#recognition) return;
    if (!this.#listening) return;
    this.#recognition.stop();
  }

  destroy() {
    this.stop();
    for (const unsub of this.#unsubs) unsub();
    this.#unsubs = [];
    this.#recognition = null;
  }
}
