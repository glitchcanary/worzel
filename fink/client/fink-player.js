// FinkPlayer — coordination layer for finkapp
//
// Wires FinkInk (engine) to FinkUI (rendering). Handles:
// - Story loading from URL (.ink or .ink.json) or inline source
// - Fetching the story list from the /fink/api/stories endpoint
// - Advance loop (continue → render → await choice → continue)
// - Bookmarks (save/restore via localStorage)
// - Keyboard shortcuts (number keys for choices)
// - FINK: cross-story links
//
// Usage:
//   const player = new FinkPlayer(document.getElementById('app'));
//   await player.loadFromUrl('/stories/test-garden/story.ink');
//   // or: await player.loadStoryList(); player.start();

import { FinkInk } from './fink-ink.js';
import { FinkUI } from './fink-ui.js';

const BOOKMARK_PREFIX = 'finkapp-bookmark-';

export class FinkPlayer {
  /** @type {FinkInk} */     #engine;
  /** @type {FinkUI} */      #ui;
  /** @type {HTMLElement} */  #root;
  /** @type {string|null} */ #storyId = null;
  /** @type {string|null} */ #storySource = null;
  /** @type {string|null} */ #apiBase = null;

  /**
   * @param {HTMLElement} root - container element
   * @param {object} [options]
   * @param {string} [options.apiBase] - base URL for the stories API (e.g. '/fink/api')
   */
  constructor(root, options = {}) {
    this.#root = root;
    this.#engine = new FinkInk();
    this.#ui = new FinkUI(root);
    this.#apiBase = options.apiBase ?? this.#detectApiBase();

    this.#bindEvents();
    this.#bindKeyboard();
  }

  /** @returns {FinkInk} */
  get engine() { return this.#engine; }

  /** @returns {FinkUI} */
  get ui() { return this.#ui; }

  // ── Story loading ──────────────────────────────────────────────────

  /**
   * Load a story from a URL. Detects .ink vs .ink.json by extension.
   * @param {string} url
   * @param {string} [storyId]
   */
  async loadFromUrl(url, storyId) {
    this.#storyId = storyId ?? urlToId(url);
    this.#ui.setStatus('Loading story...', 'info');

    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const text = await resp.text();

      if (url.endsWith('.json') || url.endsWith('.ink.json')) {
        this.#engine.loadJson(text);
      } else {
        this.#storySource = text;
        this.#engine.compileAndLoad(text);
      }

      this.#ui.setTitle(this.#storyId ?? 'finkapp');
      this.#advance();
    } catch (err) {
      this.#ui.setStatus(`Load failed: ${err.message}`, 'error');
      this.#ui.showErrors([err.message]);
    }
  }

  /**
   * Load from inline Ink source.
   * @param {string} source - raw .ink source
   * @param {string} [storyId='inline']
   */
  loadFromSource(source, storyId = 'inline') {
    this.#storyId = storyId;
    this.#storySource = source;

    try {
      this.#engine.compileAndLoad(source);
      this.#ui.setTitle(storyId);
      this.#advance();
    } catch (err) {
      this.#ui.setStatus(`Compile failed: ${err.message}`, 'error');
      this.#ui.showErrors([err.message]);
    }
  }

  /**
   * Load from pre-compiled JSON string.
   * @param {string} json
   * @param {string} [storyId='compiled']
   */
  loadFromJson(json, storyId = 'compiled') {
    this.#storyId = storyId;

    try {
      this.#engine.loadJson(json);
      this.#ui.setTitle(storyId);
      this.#advance();
    } catch (err) {
      this.#ui.setStatus(`Load failed: ${err.message}`, 'error');
      this.#ui.showErrors([err.message]);
    }
  }

  /**
   * Fetch the story list from the server API and present a menu,
   * or auto-load the default story if there's only one.
   */
  async loadStoryList() {
    if (!this.#apiBase) {
      this.#ui.setStatus('No API base configured', 'error');
      return;
    }

    this.#ui.setStatus('Fetching stories...', 'info');

    try {
      const resp = await fetch(`${this.#apiBase}/stories`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      /** @type {{id: string, title: string}[]} */
      const stories = data.stories ?? [];
      const defaultId = data.default;

      if (stories.length === 0) {
        this.#ui.setStatus('No stories found on server', 'muted');
        return;
      }

      // Auto-load default or single story
      if (stories.length === 1 || defaultId) {
        const id = defaultId ?? stories[0].id;
        await this.#loadServerStory(id);
        return;
      }

      // Show story picker as "choices"
      this.#ui.clearNarration();
      this.#ui.addNarration([{ text: 'Choose a story:', speaker: 'narrator', tags: { foaf: {}, raw: [] } }]);
      this.#ui.setStatus(`${stories.length} stories available`, 'info');

      // We abuse the choice UI for the story picker
      const fakeChoices = stories.map((s, i) => ({
        index: i,
        text: s.title || s.id,
        tags: { foaf: {}, raw: [] },
        voiceHints: [],
        _storyId: s.id,
      }));

      this.#ui.setChoices(fakeChoices);

      // Override the choice handler for this special case
      const handler = async (e) => {
        this.#root.removeEventListener('finkapp-choice', handler);
        const idx = e.detail.index;
        const story = stories[idx];
        if (story) await this.#loadServerStory(story.id);
      };
      this.#root.addEventListener('finkapp-choice', handler);

    } catch (err) {
      this.#ui.setStatus(`API error: ${err.message}`, 'error');
    }
  }

  /**
   * Load a specific story from the server's stories directory.
   * Tries .ink.json first, falls back to .ink.
   * @param {string} storyId
   */
  async #loadServerStory(storyId) {
    // The stories are not served via the API — they're on disk.
    // For the client-side player we need them served as static files.
    // Try common paths: /stories/{id}/story.ink.json, /stories/{id}/story.ink
    const base = this.#storiesBase();

    for (const file of ['story.ink.json', 'story.ink']) {
      const url = `${base}/${storyId}/${file}`;
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const text = await resp.text();
          this.#storyId = storyId;
          if (file.endsWith('.json')) {
            this.#engine.loadJson(text);
          } else {
            this.#storySource = text;
            this.#engine.compileAndLoad(text);
          }
          this.#ui.setTitle(storyId);
          this.#advance();
          return;
        }
      } catch { /* try next */ }
    }

    this.#ui.setStatus(`Story '${storyId}' not found`, 'error');
  }

  // ── Core loop ──────────────────────────────────────────────────────

  #advance() {
    const state = this.#engine.continue();

    if (state.errors.length > 0) {
      this.#ui.showErrors(state.errors);
    }

    if (state.narration.length > 0) {
      this.#ui.addNarration(state.narration);
    }

    this.#ui.setKnot(state.currentKnot);

    if (state.ended) {
      this.#ui.showEnded();
      this.#ui.setStatus('Story ended', 'muted');
      this.#clearBookmark();
    } else {
      this.#ui.setChoices(state.choices);
      const n = state.choices.length;
      this.#ui.setStatus(`${n} choice${n !== 1 ? 's' : ''} · tap or press 1–${Math.min(n, 9)}`, 'info');
      this.#saveBookmark();
    }
  }

  #choose(index) {
    if (!this.#engine.loaded) return;
    this.#engine.choose(index);
    this.#advance();
  }

  #restart() {
    if (!this.#engine.loaded) return;
    this.#ui.clearNarration();
    this.#clearBookmark();

    // Re-compile from source if available, otherwise reload JSON
    if (this.#storySource) {
      this.#engine.compileAndLoad(this.#storySource);
    }
    this.#advance();
  }

  // ── Events ─────────────────────────────────────────────────────────

  #bindEvents() {
    this.#root.addEventListener('finkapp-choice', (e) => {
      this.#choose(e.detail.index);
    });

    this.#root.addEventListener('finkapp-restart', () => {
      this.#restart();
    });

    this.#root.addEventListener('finkapp-link', async (e) => {
      const storyId = e.detail.storyId;
      this.#ui.clearNarration();
      await this.#loadServerStory(storyId);
    });
  }

  #bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const n = parseInt(e.key);
      if (!isNaN(n) && n >= 1 && n <= 9) {
        // Number keys select choices (1-indexed)
        this.#choose(n - 1);
      }
      if (e.key === 'r' && (e.ctrlKey || e.metaKey)) {
        // Ctrl+R restarts (prevent browser reload)
        e.preventDefault();
        this.#restart();
      }
    });
  }

  // ── Bookmarks ──────────────────────────────────────────────────────

  #saveBookmark() {
    if (!this.#storyId || !this.#engine.loaded) return;
    try {
      const json = this.#engine.saveState();
      localStorage.setItem(BOOKMARK_PREFIX + this.#storyId, json);
    } catch { /* localStorage may be unavailable */ }
  }

  #clearBookmark() {
    if (!this.#storyId) return;
    try {
      localStorage.removeItem(BOOKMARK_PREFIX + this.#storyId);
    } catch { /* ignore */ }
  }

  /**
   * Resume from a saved bookmark if one exists.
   * @returns {boolean} true if a bookmark was restored
   */
  resumeBookmark() {
    if (!this.#storyId || !this.#engine.loaded) return false;
    try {
      const json = localStorage.getItem(BOOKMARK_PREFIX + this.#storyId);
      if (!json) return false;
      this.#engine.loadState(json);
      this.#ui.clearNarration();
      this.#advance();
      this.#ui.setStatus('Resumed from bookmark', 'info');
      return true;
    } catch {
      return false;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  #detectApiBase() {
    // If served from /fink/, the API is at /fink/api
    const path = window.location.pathname;
    if (path.startsWith('/fink/') || path === '/fink') return '/fink/api';
    // Standalone mode: API at /api
    return '/api';
  }

  #storiesBase() {
    // Stories are expected to be served as static files.
    // In the unified server, the fink module serves from /fink/ prefix,
    // but stories are a separate directory. We try /stories/ as the default.
    return '/stories';
  }
}

function urlToId(url) {
  // Extract a story ID from a URL path like /stories/test-garden/story.ink
  const parts = url.split('/').filter(Boolean);
  // Find the directory name before story.ink or story.ink.json
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].startsWith('story.')) {
      return parts[i - 1] ?? 'unknown';
    }
  }
  return parts[parts.length - 1]?.replace(/\.ink(\.json)?$/, '') ?? 'unknown';
}
