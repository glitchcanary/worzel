import { FinkEventBus } from './fink-event-bus.js';
import { FinkWsBridge } from './fink-ws-bridge.js';
import { FinkLocalBridge } from './fink-local-bridge.js';
import { FinkSpeaker } from './fink-speaker.js';
import { FinkMediaDisplay } from './fink-media-display.js';
import { FinkBrowserASR } from './fink-browser-asr.js';

let currentMode = 'demo';
let bus = null;
let bridge = null;
let speaker = null;
let mediaDisplay = null;
let asr = null;

const statusBar = document.querySelector('.statusbar');
const statusText = document.getElementById('statusText');
const statusStreams = document.getElementById('statusStreams');

function setStatus(text, level = 'info') {
  statusText.textContent = text;
  statusBar.className = 'statusbar' + (level === 'error' ? ' error' : level === 'connecting' ? ' connecting' : level === 'connected' ? ' connected' : '');
  if (level === 'error') console.error('[infra-demo]', text);
  else console.log('[infra-demo]', text);
}

async function switchMode(mode) {
  // Tear down previous services
  if (asr) { asr.destroy(); asr = null; }
  if (speaker) { speaker.destroy(); speaker = null; }
  if (mediaDisplay) { mediaDisplay.destroy(); mediaDisplay = null; }
  if (bridge) {
    if (bridge.disconnect) bridge.disconnect();
    bridge = null;
  }
  bus = null;
  currentMode = mode;

  // Update tab UI
  document.querySelectorAll('#modeTabs .topbar-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.mode === mode)
  );

  // Show/hide story tabs and mic button (only relevant in non-Demo mode)
  const storyTabs = document.querySelector('.topbar-tabs:not(#modeTabs)');
  storyTabs.style.display = mode === 'demo' ? '' : 'none';
  document.getElementById('micBtn').style.display = mode === 'demo' ? 'none' : '';

  if (mode === 'demo') {
    window.disconnectLive();
    window.switchStory(window.currentStoryKey || 'garden');
    setStatus('demo mode — tap a choice or switch stories');
    return;
  }

  // Create bus, wire panels, and start services
  bus = new FinkEventBus();
  window.connectLive(bus);
  speaker = new FinkSpeaker(bus);
  mediaDisplay = new FinkMediaDisplay(bus, document.getElementById('sceneImage'));
  asr = new FinkBrowserASR(bus);

  // Wire STT results to choice matching — when the user speaks,
  // try to match their words to a visible choice
  bus.subscribe('stt', (data) => {
    if (data.source !== 'browser') return;
    console.log('[infra-demo] heard:', data.text);
    // Simple substring matching against visible choices
    const buttons = document.querySelectorAll('.choice-btn .choice-text');
    const spoken = data.text.toLowerCase().trim();
    for (const btn of buttons) {
      const choiceText = btn.textContent.toLowerCase();
      if (spoken.includes(choiceText) || choiceText.includes(spoken)) {
        console.log('[infra-demo] matched choice:', btn.textContent);
        btn.closest('.choice-btn').click();
        return;
      }
    }
    setStatus(`heard: "${data.text}" (no choice matched)`);
  });

  if (mode === 'live') {
    const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
    const serverUrl = isLocal ? 'https://worzel.fly.dev' : '';
    bridge = new FinkWsBridge(bus, isLocal ? { serverUrl } : {});
    const target = isLocal ? serverUrl : location.origin;
    setStatus(`connecting to ${target} ...`, 'connecting');
    try {
      await bridge.connect();
      setStatus(`connected to ${target}`, 'connected');
    } catch (err) {
      const hint = isLocal ? ' (CORS may block localhost — deploy to Fly or set WORZEL_CORS_ORIGINS)' : '';
      setStatus(`connection failed: ${err.message}${hint}`, 'error');
    }
  } else if (mode === 'local') {
    setStatus('local mode — load an .ink story to begin');
  }
}

// Mic button — toggle browser speech recognition
document.getElementById('micBtn').addEventListener('click', () => {
  if (!asr || !asr.available) {
    setStatus('Speech recognition not available in this browser', 'error');
    return;
  }
  if (asr.available) {
    bus.publish('listen', { state: 'start' });
  }
});

// Mode tab clicks
document.querySelectorAll('#modeTabs .topbar-tab').forEach(btn => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});

// Default to Live mode
switchMode('live');
