// finkapp-boot.js — bootstrap script for finkapp
// Extracted from inline <script> to comply with CSP script-src 'self'.

import { FinkPlayer } from './fink-player.js';
import { FinkAppLiveClient } from './finkapp-live.js';

const app = document.getElementById('app');
const player = new FinkPlayer(app);
let liveClient = null;

// Check URL params for story source
const params = new URLSearchParams(window.location.search);
const finkUrl = params.get('fink');     // ?fink=https://example.com/story.fink.js
const storyUrl = params.get('story');   // ?story=/path/to/story.fink.js or raw .ink source
const storyId = params.get('id');       // ?id=test-garden
const liveMode = params.get('live') === '1'; // ?live=1 uses the server-driven ink_state path

if (liveMode) {
  liveClient = new FinkAppLiveClient(player, app);
  liveClient.connect();
} else if (finkUrl) {
  // Direct .fink.js URL (loaded via sandbox)
  player.loadFinkJs(finkUrl);
} else if (storyUrl) {
  // Direct story URL (.fink.js preferred; raw Ink accepted)
  player.loadFromUrl(storyUrl, storyId);
} else if (storyId) {
  // Story by ID: use the same server-backed loader as the picker.
  player.loadStoryById(storyId);
} else {
  // Default: try to load the story list from the API
  player.loadStoryList().catch(() => {
    player.ui.setStatus('Pass ?story=URL, ?id=NAME, or ?fink=URL to load', 'muted');
    player.ui.addNarration([{
      text: 'No story loaded. Use ?id=story-name, ?story=path/to/story.fink.js, or ?fink=url.fink.js',
      speaker: 'narrator',
      tags: { foaf: {}, raw: [] },
    }]);
  });
}

// Expose player globally for dev console access
window.finkPlayer = player;
window.finkLiveClient = liveClient;
