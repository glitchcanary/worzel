// FinkInk — Client-side Ink engine module
//
// Wraps inkjs (full, with compiler) to provide:
// - Compilation from raw .ink source
// - Loading from pre-compiled .ink.json
// - Tag parsing (speaker, voice, mood, image, foley, audio, etc.)
// - Story advancement (continue + choices)
// - State serialization for bookmarks
//
// Designed as a standalone module that can later migrate to server middleware
// without changing its interface.

/**
 * @typedef {Object} ParsedTags
 * @property {string} [speaker]
 * @property {string} [voice]
 * @property {Record<string, string>} [voiceDirectives]
 * @property {string} [mood]
 * @property {string[]} [voiceHints]
 * @property {string} [inputMode]
 * @property {number} [pauseMs]
 * @property {string} [finkLink]
 * @property {string} [image]
 * @property {string} [basehref]
 * @property {string} [vizprom]
 * @property {string} [audio]
 * @property {string} [video]
 * @property {string} [foley]
 * @property {string} [bg]
 * @property {Record<string, string>} foaf
 * @property {string[]} raw
 */

/**
 * @typedef {Object} NarrationSegment
 * @property {string} text
 * @property {string} speaker
 * @property {string} [voice]
 * @property {string} [mood]
 * @property {ParsedTags} tags
 */

/**
 * @typedef {Object} InkChoice
 * @property {number} index
 * @property {string} text
 * @property {ParsedTags} tags
 * @property {string[]} voiceHints
 */

/**
 * @typedef {Object} StoryState
 * @property {NarrationSegment[]} narration
 * @property {InkChoice[]} choices
 * @property {boolean} ended
 * @property {string|null} currentKnot
 * @property {string[]} errors
 */

/**
 * Parse an array of Ink tag strings into structured metadata.
 * Matches the server-side parseTags from ink-tags.ts.
 * @param {string[]} tags
 * @returns {ParsedTags}
 */
export function parseTags(tags) {
  const result = { foaf: {}, raw: tags };

  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;

    // foaf: prefix — multi-part (foaf:name:The Keeper)
    if (trimmed.startsWith('foaf:')) {
      const rest = trimmed.slice(5);
      const ci = rest.indexOf(':');
      if (ci > 0) {
        result.foaf[rest.slice(0, ci).trim()] = rest.slice(ci + 1).trim();
      }
      continue;
    }

    const ci = trimmed.indexOf(':');
    if (ci <= 0) {
      // Valueless tags (e.g. STOP_AUDIO)
      const bare = trimmed.toLowerCase();
      if (bare === 'stop_audio') result.stopAudio = true;
      continue;
    }

    const key = trimmed.slice(0, ci).trim().toLowerCase();
    const value = trimmed.slice(ci + 1).trim();

    // voice.* directives (voice.emotion:sad)
    if (key.startsWith('voice.')) {
      result.voiceDirectives ??= {};
      result.voiceDirectives[key.slice(6)] = value;
      continue;
    }

    switch (key) {
      case 'speaker':    result.speaker = value; break;
      case 'voice':      result.voice = value; break;
      case 'mood':       result.mood = value; break;
      case 'voice_hint': result.voiceHints = value.split(',').map(h => h.trim().toLowerCase()).filter(Boolean); break;
      case 'input':      if (value === 'freeform') result.inputMode = 'freeform'; break;
      case 'pause':      result.pauseMs = parseInt(value, 10) || undefined; break;
      case 'fink':       result.finkLink = value; break;
      case 'image':      result.image = value; break;
      case 'basehref':   result.basehref = value; break;
      case 'vizprom':    result.vizprom = value; break;
      case 'audio':      result.audio = value; break;
      case 'video':      result.video = value; break;
      case 'foley':      result.foley = value; break;
      case 'bg':         result.bg = value; break;
      case 'class':      result.cssClass = value; break;
      case 'minigame':   result.minigame = value; break;
      case 'stop_audio': result.stopAudio = true; break;
    }
  }

  return result;
}

/**
 * Merge incoming tags over existing (later values win for scalars).
 * @param {ParsedTags} existing
 * @param {ParsedTags} incoming
 * @returns {ParsedTags}
 */
export function mergeTags(existing, incoming) {
  return {
    speaker:         incoming.speaker ?? existing.speaker,
    voice:           incoming.voice ?? existing.voice,
    voiceDirectives: { ...(existing.voiceDirectives ?? {}), ...(incoming.voiceDirectives ?? {}) },
    mood:            incoming.mood ?? existing.mood,
    voiceHints:      incoming.voiceHints ?? existing.voiceHints,
    inputMode:       incoming.inputMode ?? existing.inputMode,
    pauseMs:         incoming.pauseMs ?? existing.pauseMs,
    finkLink:        incoming.finkLink ?? existing.finkLink,
    image:           incoming.image ?? existing.image,
    basehref:        incoming.basehref ?? existing.basehref,
    vizprom:         incoming.vizprom ?? existing.vizprom,
    audio:           incoming.audio ?? existing.audio,
    video:           incoming.video ?? existing.video,
    foley:           incoming.foley ?? existing.foley,
    bg:              incoming.bg ?? existing.bg,
    foaf:            { ...existing.foaf, ...incoming.foaf },
    raw:             [...existing.raw, ...incoming.raw],
  };
}

export class FinkInk {
  /** @type {any} - inkjs Story instance */
  #story = null;

  /** @type {ParsedTags} - accumulated "sticky" tags (speaker/voice persist across lines) */
  #stickyTags = { foaf: {}, raw: [] };

  /** @type {string|null} */
  #currentKnot = null;

  /** @type {Map<string, unknown>} - external variable observers */
  #variableObservers = new Map();

  /**
   * Compile raw .ink source and initialise the story.
   * Requires the full inkjs bundle (with compiler) on window.inkjs or passed in.
   * @param {string} source - raw Ink source text
   * @param {object} [inkjsModule] - optional inkjs module reference
   */
  compileAndLoad(source, inkjsModule) {
    const ink = inkjsModule ?? window.inkjs;
    if (!ink) throw new Error('inkjs not loaded — include ink-full.js before use');

    const CompilerClass = ink.Compiler || (ink.compiler && ink.compiler.Compiler);
    if (!CompilerClass) throw new Error('inkjs compiler not found — ensure the full bundle is loaded');

    const compiler = new CompilerClass(source);
    this.#story = compiler.Compile();
    this.#stickyTags = { foaf: {}, raw: [] };
    this.#currentKnot = null;
  }

  /**
   * Load a pre-compiled story from JSON string.
   * @param {string} json - compiled Ink JSON
   * @param {object} [inkjsModule] - optional inkjs module reference
   */
  loadJson(json, inkjsModule) {
    const ink = inkjsModule ?? window.inkjs;
    if (!ink) throw new Error('inkjs not loaded');

    const StoryClass = ink.Story || (ink.story && ink.story.Story);
    if (!StoryClass) throw new Error('inkjs Story class not found');

    this.#story = new StoryClass(json);
    this.#stickyTags = { foaf: {}, raw: [] };
    this.#currentKnot = null;
  }

  /** @returns {boolean} */
  get loaded() { return this.#story !== null; }

  /** @returns {boolean} */
  get canContinue() { return this.#story?.canContinue ?? false; }

  /** @returns {boolean} */
  get ended() { return !this.canContinue && (this.#story?.currentChoices?.length ?? 0) === 0; }

  /** @returns {string|null} */
  get currentKnot() { return this.#currentKnot; }

  /**
   * Advance the story, collecting all narration segments until the next choice point or end.
   * @returns {StoryState}
   */
  continue() {
    if (!this.#story) throw new Error('No story loaded');

    /** @type {NarrationSegment[]} */
    const narration = [];
    const errors = [];

    while (this.#story.canContinue) {
      const text = this.#story.Continue()?.trim();
      const rawTags = this.#story.currentTags ?? [];

      // Track current knot from path
      const path = this.#story.state?.currentPathString;
      if (path) {
        const knot = path.split('.')[0];
        if (knot) this.#currentKnot = knot;
      }

      // Parse and merge tags (speaker/voice are sticky)
      const lineTags = parseTags(rawTags);
      this.#stickyTags = mergeTags(this.#stickyTags, lineTags);

      if (text) {
        narration.push({
          text,
          speaker: this.#stickyTags.speaker ?? 'narrator',
          voice: this.#stickyTags.voice,
          mood: this.#stickyTags.mood,
          tags: { ...this.#stickyTags },
        });
      } else if (lineTags.image || lineTags.vizprom || lineTags.audio || lineTags.video || lineTags.foley || lineTags.bg) {
        // Tag-only line (no text) — emit a segment so media tags are visible
        narration.push({
          text: '',
          speaker: this.#stickyTags.speaker ?? 'narrator',
          tags: { ...this.#stickyTags },
        });
      }
    }

    // Collect errors
    if (this.#story.currentErrors) {
      errors.push(...this.#story.currentErrors);
    }

    // Build choices
    const choices = (this.#story.currentChoices ?? []).map(c => {
      const choiceTags = parseTags(c.tags ?? []);
      return {
        index: c.index,
        text: c.text,
        tags: choiceTags,
        voiceHints: choiceTags.voiceHints ?? [],
      };
    });

    return {
      narration,
      choices,
      ended: this.ended,
      currentKnot: this.#currentKnot,
      errors,
    };
  }

  /**
   * Choose a choice by index.
   * @param {number} index
   */
  choose(index) {
    if (!this.#story) throw new Error('No story loaded');
    this.#story.ChooseChoiceIndex(index);
  }

  /**
   * Jump to a named knot/stitch path.
   * @param {string} path
   */
  choosePath(path) {
    if (!this.#story) throw new Error('No story loaded');
    this.#story.ChoosePathString(path);
  }

  /**
   * Get a story variable value.
   * @param {string} name
   * @returns {unknown}
   */
  getVariable(name) {
    return this.#story?.variablesState?.[name];
  }

  /**
   * Set a story variable.
   * @param {string} name
   * @param {unknown} value
   */
  setVariable(name, value) {
    if (this.#story?.variablesState) {
      this.#story.variablesState[name] = value;
    }
  }

  /**
   * Save story state as a serializable JSON string.
   * @returns {string}
   */
  saveState() {
    if (!this.#story) throw new Error('No story loaded');
    return this.#story.state.toJson();
  }

  /**
   * Restore story state from a previously saved JSON string.
   * @param {string} json
   */
  loadState(json) {
    if (!this.#story) throw new Error('No story loaded');
    this.#story.state.LoadJson(json);
    this.#stickyTags = { foaf: {}, raw: [] };
  }

  /**
   * Bind an external function that Ink can call.
   * @param {string} name
   * @param {Function} fn
   * @param {boolean} [lookaheadSafe=false]
   */
  bindExternalFunction(name, fn, lookaheadSafe = false) {
    if (!this.#story) throw new Error('No story loaded');
    this.#story.BindExternalFunction(name, fn, lookaheadSafe);
  }

  /**
   * Observe a variable for changes.
   * @param {string} name
   * @param {(varName: string, newValue: unknown) => void} callback
   */
  observeVariable(name, callback) {
    if (!this.#story) throw new Error('No story loaded');
    this.#story.ObserveVariable(name, callback);
  }

  /**
   * Get the raw inkjs Story instance (escape hatch for advanced use).
   * @returns {any}
   */
  get rawStory() { return this.#story; }
}
