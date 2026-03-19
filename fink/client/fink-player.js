// FinkPlayer — coordination layer for finkapp
//
// Wires FinkInk (engine) to FinkUI (rendering). Handles:
// - Story loading from URL (.fink.js preferred, raw Ink accepted for direct URLs)
// - Fetching the story list from the /fink/api/stories endpoint
// - Advance loop (continue → render → await choice → continue)
// - FINK: cross-story links (loads external .fink.js files)
// - BASEHREF: media path resolution for images/audio
// - Bookmarks (save/restore via localStorage)
// - Keyboard shortcuts (number keys for choices)
//
// Usage:
//   const player = new FinkPlayer(document.getElementById('app'));
//   await player.loadFromUrl('/stories/test-garden/story.fink.js');
//   await player.loadFinkJs('https://example.com/story.fink.js');
//   // or: await player.loadStoryList(); player.start();

import { FinkInk } from './fink-ink.js';
import { FinkUI } from './fink-ui.js';
import { loadFinkJs, clearLoadRecord } from './fink-sandbox.js';

const BOOKMARK_PREFIX = 'finkapp-bookmark-';

export class FinkPlayer {
  /** @type {FinkInk} */     #engine;
  /** @type {FinkUI} */      #ui;
  /** @type {HTMLElement} */  #root;
  /** @type {string|null} */ #storyId = null;
  /** @type {string|null} */ #storySource = null;
  /** @type {string|null} */ #apiBase = null;

  /** @type {string|null} - Current story URL (for resolving relative FINK: links) */
  #currentStoryUrl = null;

  /** @type {string|null} - Media base path from BASEHREF tag */
  #mediaBasePath = null;

  /**
   * @param {HTMLElement} root - container element
   * @param {object} [options]
   * @param {string} [options.apiBase] - base URL for the stories API (e.g. '/fink/api')
   * @param {any} [options.localSvg] - experimental local SVG generator
   */
  constructor(root, options = {}) {
    this.#root = root;
    this.#engine = new FinkInk();
    this.#ui = new FinkUI(root, { localSvg: options.localSvg });
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
   * Load a story from a URL. Detects .fink.js and otherwise treats content as raw Ink source.
   * @param {string} url
   * @param {string} [storyId]
   */
  async loadFromUrl(url, storyId) {
    this.#storyId = storyId ?? urlToId(url);
    this.#ui.setStatus('Loading story...', 'info');

    try {
      if (url.endsWith('.fink.js')) {
        await this.#loadFinkJsUrl(url);
        return;
      }

      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const text = await resp.text();

      this.#currentStoryUrl = url;

      if (url.endsWith('.json') || url.endsWith('.ink.json')) {
        console.error(`[finkapp] Legacy compiled Ink JSON is no longer supported: ${url}`);
        throw new Error('Legacy compiled Ink JSON is no longer supported; use story.fink.js');
      }

      this.#storySource = text;
      this.#engine.compileAndLoad(text);

      this.#ui.setTitle(this.#storyId ?? 'finkapp');
      this.#ui.clearNarration();
      if (!this.resumeBookmark()) this.#advance();
    } catch (err) {
      this.#ui.setStatus(`Load failed: ${err.message}`, 'error');
      this.#ui.showErrors([err.message]);
    }
  }

  /**
   * Load a .fink.js file via the sandbox loader.
   * @param {string} url - URL of the .fink.js file
   */
  async loadFinkJs(url) {
    this.#storyId = urlToId(url);
    this.#ui.setStatus(`Loading ${url.split('/').pop()}...`, 'info');
    await this.#loadFinkJsUrl(url);
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
      this.#ui.clearNarration();
      if (!this.resumeBookmark()) this.#advance();
    } catch (err) {
      this.#ui.setStatus(`Compile failed: ${err.message}`, 'error');
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

      // Auto-load a concrete story, but keep the virtual menu as a picker.
      if (stories.length === 1) {
        await this.#loadServerStory(stories[0].id);
        return;
      }

      if (defaultId && defaultId !== 'menu') {
        await this.#loadServerStory(defaultId);
        return;
      }

      // Show story picker as "choices"
      this.#showStoryPicker(stories);

    } catch (err) {
      this.#ui.setStatus(`API error: ${err.message}`, 'error');
    }
  }

  /**
   * Load a server-hosted story by ID, trying compiled JSON before Ink source.
   * @param {string} storyId
   */
  async loadStoryById(storyId) {
    await this.#loadServerStory(storyId);
  }

  // ── Internal loaders ───────────────────────────────────────────────

  /**
   * Load a .fink.js URL via sandbox.
   * @param {string} url
   */
  async #loadFinkJsUrl(url) {
    try {
      const inkSource = await loadFinkJs(url);
      if (inkSource === null) {
        // Duplicate load skipped
        this.#ui.setStatus('Already loaded', 'muted');
        return;
      }

      this.#currentStoryUrl = url;
      this.#storySource = inkSource;
      this.#mediaBasePath = null;
      this.#engine.compileAndLoad(inkSource);
      this.#ui.setTitle(this.#storyId ?? 'finkapp');
      this.#ui.clearNarration();
      if (!this.resumeBookmark()) this.#advance();
    } catch (err) {
      this.#ui.setStatus(`Load failed: ${err.message}`, 'error');
      this.#ui.showErrors([err.message]);
    }
  }

  /**
   * Load a specific story from the server's stories directory.
   * Uses story.fink.js for bundled local stories.
   * @param {string} storyId
   */
  async #loadServerStory(storyId) {
    const base = this.#storiesBase();
    const storyIds = uniqueStoryIds(storyId);

    for (const candidateId of storyIds) {
      const url = `${base}/${candidateId}/story.fink.js`;
      try {
        const resp = await fetch(url, { method: 'HEAD' });
        if (resp.ok) {
          this.#storyId = candidateId;
          this.#currentStoryUrl = url;
          this.#mediaBasePath = null;
          await this.#loadFinkJsUrl(url);
          return;
        }
      } catch { /* try next */ }
    }

    this.#ui.setStatus(`Story '${storyId}' not found`, 'error');
  }

  // ── Core loop ──────────────────────────────────────────────────────

  #advance() {
    const state = this.#engine.continue();
    this.#presentState(state);
  }

  /**
   * Apply a server-driven ink_state payload to the shared renderer.
   * This is the first seam toward a unified local/server Fink client.
   * @param {object} inkState
   */
  applyInkState(inkState) {
    const normalized = {
      narration: inkState.narration ?? [],
      choices: (inkState.choices ?? []).map(choice => ({
        index: choice.index,
        text: choice.text,
        tags: choice.tags ?? { foaf: {}, raw: [] },
        voiceHints: choice.voiceHints ?? [],
      })),
      suggestion: inkState.suggestion,
      ended: Boolean(inkState.isEnded),
      currentKnot: inkState.storyId ?? null,
      errors: [],
    };

    if (inkState.storyId) {
      this.#storyId = inkState.storyId;
      this.#ui.setTitle(inkState.storyId);
    }

    this.#presentState(normalized, { saveBookmark: false });
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
    this.#mediaBasePath = null;

    if (this.#storySource) {
      this.#engine.compileAndLoad(this.#storySource);
    }
    this.#advance();
  }

  // ── FINK: cross-story navigation ──────────────────────────────────

  /**
   * Handle a FINK: tag — load the referenced .fink.js file.
   * @param {string} finkRef - filename or relative URL from the FINK: tag
   */
  async #handleFinkLink(finkRef) {
    const baseUrl = this.#currentStoryUrl ?? window.location.href;
    const resolvedUrl = new URL(finkRef, baseUrl).href;

    this.#ui.setStatus(`Loading ${finkRef}...`, 'info');

    // Clear duplicate detection for intentional navigation
    clearLoadRecord(resolvedUrl);

    try {
      const inkSource = await loadFinkJs(resolvedUrl);
      if (inkSource === null) {
        this.#ui.setStatus('Already loaded', 'muted');
        return;
      }

      this.#storyId = urlToId(resolvedUrl);
      this.#currentStoryUrl = resolvedUrl;
      this.#storySource = inkSource;
      this.#mediaBasePath = null;
      this.#engine.compileAndLoad(inkSource);
      this.#ui.setTitle(this.#storyId);
      this.#ui.clearNarration();
      this.#advance();
    } catch (err) {
      this.#ui.setStatus(`FINK load failed: ${err.message}`, 'error');
      this.#ui.showErrors([`Failed to load ${finkRef}: ${err.message}`]);
    }
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
      const ref = e.detail.storyId;
      // Detect whether this is a .fink.js reference or a server story ID
      if (ref.endsWith('.fink.js') || ref.includes('/')) {
        await this.#handleFinkLink(ref);
      } else {
        this.#ui.clearNarration();
        await this.#loadServerStory(ref);
      }
    });
  }

  #bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const n = parseInt(e.key);
      if (!isNaN(n) && n >= 1 && n <= 9) {
        this.#choose(n - 1);
      }
      if (e.key === 'r' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.#restart();
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.#ui.focusChoice(1);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.#ui.focusChoice(-1);
      }
      if ((e.key === 'Enter' || e.key === ' ') && this.#ui.hasChoices()) {
        const active = document.activeElement;
        if (active?.classList?.contains('finkapp-choice-btn')) {
          e.preventDefault();
          active.click();
        }
      }
    });
  }

  /**
   * Shared rendering path for both local inkjs state and server ink_state payloads.
   * @param {import('./fink-ink.js').StoryState} state
   * @param {{ saveBookmark?: boolean }} [options]
   */
  #presentState(state, options = {}) {
    const saveBookmark = options.saveBookmark ?? true;

    if (state.errors.length > 0) {
      this.#ui.showErrors(state.errors);
    }

    let finkLink = null;
    for (const seg of state.narration) {
      if (seg.tags?.basehref) {
        this.#mediaBasePath = seg.tags.basehref;
        if (!this.#mediaBasePath.endsWith('/')) this.#mediaBasePath += '/';
      }
      if (seg.tags?.finkLink) {
        finkLink = seg.tags.finkLink;
      }
      if (seg.tags?.image) {
        seg.tags.image = this.#resolveMediaUrl(seg.tags.image);
      }
      if (seg.tags?.audio) {
        seg.tags.audio = this.#resolveMediaUrl(seg.tags.audio);
      }
      if (seg.tags?.video) {
        seg.tags.video = this.#resolveMediaUrl(seg.tags.video);
      }
    }

    if (state.narration.length > 0) {
      this.#ui.addNarration(state.narration);
    }

    this.#ui.setKnot(formatKnotLabel(state.currentKnot));

    if (finkLink) {
      this.#handleFinkLink(finkLink);
      return;
    }

    if (state.ended) {
      this.#ui.showEnded();
      this.#ui.setStatus('Story ended', 'muted');
      if (saveBookmark) this.#clearBookmark();
    } else {
      this.#ui.setChoices(state.choices, state.suggestion);
      const n = state.choices.length;
      this.#ui.setStatus(`${n} choice${n !== 1 ? 's' : ''} · tap or press 1–${Math.min(n, 9)}`, 'info');
      if (saveBookmark) this.#saveBookmark();
    }
  }

  // ── Media URL resolution ───────────────────────────────────────────

  /**
   * Resolve a media URL against the current BASEHREF or story URL.
   * @param {string} path
   * @returns {string}
   */
  #resolveMediaUrl(path) {
    if (!path) return path;
    // Already absolute
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
      return path;
    }
    // Resolve against BASEHREF if set
    if (this.#mediaBasePath) {
      try { return new URL(path, this.#mediaBasePath).href; } catch { /* fall through */ }
    }
    // Resolve against current story URL
    if (this.#currentStoryUrl) {
      try { return new URL(path, this.#currentStoryUrl).href; } catch { /* fall through */ }
    }
    return path;
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
    const path = window.location.pathname;
    if (path.startsWith('/fink/') || path === '/fink') return '/fink/api';
    return '/api';
  }

  /**
   * Render the server story list in the shared choice UI.
   * This stays entirely inside finkapp so the main endpoints are unaffected.
   * @param {{id: string, title?: string}[]} stories
   */
  #showStoryPicker(stories) {
    this.#ui.clearNarration();
    this.#ui.addNarration([{
      text: 'Choose a story:',
      speaker: 'narrator',
      tags: { foaf: {}, raw: [] },
    }]);
    this.#ui.setStatus(`${stories.length} stories available`, 'info');

    const fakeChoices = stories.map((story, index) => ({
      index,
      text: story.title || story.id,
      tags: { foaf: {}, raw: [] },
      voiceHints: [],
    }));

    this.#ui.setChoices(fakeChoices);

    const handler = async (e) => {
      this.#root.removeEventListener('finkapp-choice', handler);
      const story = stories[e.detail.index];
      if (story) await this.#loadServerStory(story.id);
    };
    this.#root.addEventListener('finkapp-choice', handler);
  }

  #storiesBase() {
    const path = window.location.pathname;
    if (path.startsWith('/fink/') || path === '/fink') return '/fink/stories';
    return '/stories';
  }
}

function urlToId(url) {
  const parts = url.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? 'unknown';
  if (last.endsWith('.fink.js')) return last.replace('.fink.js', '');
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].startsWith('story.')) {
      return parts[i - 1] ?? 'unknown';
    }
  }
  return last.replace(/\.ink$/, '') ?? 'unknown';
}

function uniqueStoryIds(storyId) {
  const raw = `${storyId ?? ''}`.trim();
  const normalized = raw
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return [...new Set([raw, normalized].filter(Boolean))];
}

function formatKnotLabel(knot) {
  if (!knot) return null;
  // Raw internal knot ids like office_wagon are useful for debugging,
  // but too implementation-flavoured for normal reading.
  if (/[_-]/.test(knot)) return null;
  return knot;
}
