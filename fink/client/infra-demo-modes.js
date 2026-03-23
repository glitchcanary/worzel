import { FinkEventBus } from './fink-event-bus.js';
import { FinkWsBridge } from './fink-ws-bridge.js';
import { FinkSpeaker } from './fink-speaker.js';
import { FinkMediaDisplay } from './fink-media-display.js';
import { FinkBrowserASR } from './fink-browser-asr.js';

let bus = null;
let bridge = null;
let speaker = null;
let mediaDisplay = null;
let asr = null;
let micLive = false; // hands-free continuous listening mode

const statusBar = document.querySelector('.statusbar');
const statusText = document.getElementById('statusText');
const micBtn = document.getElementById('micBtn');
const micLabel = document.getElementById('micLabel');

function setStatus(text, level = 'info') {
  statusText.textContent = text;
  statusBar.className = 'statusbar' + (level === 'error' ? ' error' : level === 'connecting' ? ' connecting' : level === 'connected' ? ' connected' : '');
  if (level === 'error') console.error('[infra-demo]', text);
  else console.log('[infra-demo]', text);
}

async function connectLive() {
  // Create bus and wire up panels + services
  bus = new FinkEventBus();
  window.connectLive(bus);
  speaker = new FinkSpeaker(bus);
  mediaDisplay = new FinkMediaDisplay(bus, document.getElementById('sceneImage'));
  asr = new FinkBrowserASR(bus);

  // When playback finishes and mic is in hands-free mode, auto-restart listening
  bus.subscribe('playback_state', (data) => {
    if (data.state === 'idle' && micLive && asr && asr.available) {
      // Small delay so suppression flag clears first
      setTimeout(() => {
        if (micLive) bus.publish('listen', { state: 'start' });
      }, 300);
    }
  });

  // Update mic button state when listen state changes
  bus.subscribe('listen_state', (data) => {
    if (data.state === 'listening') {
      micBtn.classList.add('listening');
    } else {
      micBtn.classList.remove('listening');
      // In hands-free mode, restart after utterance ends (unless suppressed by TTS)
      if (micLive && data.state === 'stopped' && asr && asr.available) {
        setTimeout(() => {
          if (micLive) bus.publish('listen', { state: 'start' });
        }, 200);
      }
    }
  });

  // Connect WebSocket to server
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  const serverUrl = isLocal ? 'https://worzel.fly.dev' : '';
  bridge = new FinkWsBridge(bus, isLocal ? { serverUrl } : {});
  const target = isLocal ? serverUrl : location.origin;
  setStatus(`connecting to ${target}...`, 'connecting');
  try {
    await bridge.connect();
    setStatus(`connected`, 'connected');
  } catch (err) {
    const hint = isLocal ? ' (CORS may block localhost)' : '';
    setStatus(`connection failed: ${err.message}${hint}`, 'error');
  }
}

// Mic button — toggle hands-free continuous listening
micBtn.addEventListener('click', () => {
  if (!asr || !asr.available) {
    setStatus('Speech recognition not available in this browser', 'error');
    return;
  }
  micLive = !micLive;
  if (micLive) {
    micBtn.classList.add('listening');
    micLabel.textContent = 'Mic On';
    bus.publish('listen', { state: 'start' });
  } else {
    micBtn.classList.remove('listening');
    micLabel.textContent = 'Mic';
    bus.publish('listen', { state: 'stop' });
  }
});

// Wait for overlay click before connecting — ensures AudioContext is created
// during a user gesture and no TTS audio is lost.
if (window.__enterClicked) {
  connectLive();
} else {
  setStatus('click to enter', 'info');
  window.addEventListener('fink-enter', () => connectLive(), { once: true });
}
