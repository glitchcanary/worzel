// finkapp-boot.js — bootstrap script for finkapp
// Extracted from inline <script> to comply with CSP script-src 'self'.

import { FinkPlayer } from './fink-player.js';

const app = document.getElementById('app');
const player = new FinkPlayer(app);

// Check URL params for story source
const params = new URLSearchParams(window.location.search);
const finkUrl = params.get('fink');     // ?fink=https://example.com/story.fink.js
const storyUrl = params.get('story');   // ?story=/path/to/story.ink
const storyId = params.get('id');       // ?id=test-garden

if (finkUrl) {
  // Direct .fink.js URL (loaded via sandbox)
  player.loadFinkJs(finkUrl);
} else if (storyUrl) {
  // Direct story URL (any format: .ink, .ink.json, .fink.js)
  player.loadFromUrl(storyUrl, storyId);
} else if (storyId) {
  // Story by ID: loads from /stories/{id}/story.ink
  const storiesBase = window.location.pathname.startsWith('/fink') ? '/fink/stories' : '/stories';
  player.loadFromUrl(`${storiesBase}/${storyId}/story.ink`, storyId);
} else {
  // Default: try to load the story list from the API
  player.loadStoryList().catch(() => {
    player.ui.setStatus('Pass ?story=URL, ?id=NAME, or ?fink=URL to load', 'muted');
    player.ui.addNarration([{
      text: 'No story loaded. Use ?id=story-name, ?story=path/to/story.ink, or ?fink=url.fink.js',
      speaker: 'narrator',
      tags: { foaf: {}, raw: [] },
    }]);
  });
}

// Expose player globally for dev console access
window.finkPlayer = player;
