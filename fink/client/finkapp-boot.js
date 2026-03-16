// finkapp-boot.js — bootstrap script for finkapp
// Extracted from inline <script> to comply with CSP script-src 'self'.

import { FinkPlayer } from './fink-player.js';

const app = document.getElementById('app');
const player = new FinkPlayer(app);

// Check URL params for story source
const params = new URLSearchParams(window.location.search);
const storyUrl = params.get('story');
const storyId = params.get('id');

if (storyUrl) {
  // Direct story URL: ?story=/path/to/story.ink
  player.loadFromUrl(storyUrl, storyId);
} else if (storyId) {
  // Story by ID: ?id=test-garden (loads from /stories/{id}/story.ink)
  player.loadFromUrl(`/stories/${storyId}/story.ink`, storyId);
} else {
  // Default: try to load the story list from the API
  player.loadStoryList().catch(() => {
    player.ui.setStatus('Pass ?story=URL or ?id=NAME to load a story', 'muted');
    player.ui.addNarration([{
      text: 'No story loaded. Use ?story=path/to/story.ink or ?id=story-name to open a story.',
      speaker: 'narrator',
      tags: { foaf: {}, raw: [] },
    }]);
  });
}

// Expose player globally for dev console access
window.finkPlayer = player;
