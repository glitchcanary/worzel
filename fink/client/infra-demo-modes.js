import { FinkEventBus } from './fink-event-bus.js';
import { FinkWsBridge } from './fink-ws-bridge.js';
import { FinkLocalBridge } from './fink-local-bridge.js';

let currentMode = 'demo';
let bus = null;
let bridge = null;

async function switchMode(mode) {
  // Tear down previous bridge
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

  // Show/hide story tabs (only relevant in Demo mode)
  const storyTabs = document.querySelector('.topbar-tabs:not(#modeTabs)');
  storyTabs.style.display = mode === 'demo' ? '' : 'none';

  if (mode === 'demo') {
    // Restore demo mode — re-enter current story
    window.disconnectLive();
    window.switchStory(window.currentStoryKey || 'garden');
    return;
  }

  // Create bus and wire panels
  bus = new FinkEventBus();
  window.connectLive(bus);

  if (mode === 'live') {
    bridge = new FinkWsBridge(bus);
    try {
      document.getElementById('statusText').textContent = 'connecting to server...';
      await bridge.connect();
    } catch (err) {
      document.getElementById('statusText').textContent = `connection failed: ${err.message}`;
    }
  } else if (mode === 'local') {
    bridge = new FinkLocalBridge(bus);
    document.getElementById('statusText').textContent = 'local mode — load an .ink story to begin';
  }
}

// Mode tab clicks
document.querySelectorAll('#modeTabs .topbar-tab').forEach(btn => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});
