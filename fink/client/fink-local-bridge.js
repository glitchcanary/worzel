// FinkLocalBridge — wraps existing thick-client modules (FinkInk) into bus events.
// Does NOT modify fink-ink.js or fink-player.js. Instantiates them and publishes
// their outputs as bus events.

import { FinkInk, parseTags } from './fink-ink.js';

export class FinkLocalBridge {
  #bus;
  #ink;
  #storyId;
  #turnCount = 0;

  constructor(bus) {
    this.#bus = bus;
    this.#ink = new FinkInk();

    // Subscribe to choices from the bus
    bus.subscribe('ink:choose', ({ choiceIndex }) => {
      this.#ink.choose(choiceIndex);
      this.#advance();
    });
  }

  async loadFromUrl(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load story: ${res.status}`);
    const contentType = res.headers.get('content-type') || '';

    if (url.endsWith('.fink.js') || contentType.includes('javascript')) {
      // .fink.js compiled story — evaluate to get story JSON
      const text = await res.text();
      const blob = new Blob([text], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      try {
        const module = await import(blobUrl);
        if (module.storyContent) {
          this.#ink.rawStory; // ensure inkjs loaded
          // Direct load via inkjs
          const inkjs = await import('./ink.js');
          const story = new inkjs.Story(module.storyContent);
          // Use compileAndLoad path with source instead
        }
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    } else {
      // Raw .ink source
      const source = await res.text();
      this.#ink.compileAndLoad(source);
    }

    this.#storyId = url.split('/').pop().replace(/\.(ink|fink\.js)$/, '');
    this.#turnCount = 0;
    this.#advance();
  }

  loadFromSource(source, storyId = 'local') {
    this.#ink.compileAndLoad(source);
    this.#storyId = storyId;
    this.#turnCount = 0;
    this.#advance();
  }

  #advance() {
    if (!this.#ink.loaded) return;
    const state = this.#ink.continue();
    this.#turnCount++;

    // Build ink_state matching the server protocol shape
    const inkState = {
      type: 'ink_state',
      storyId: this.#storyId,
      turnCount: this.#turnCount,
      knot: state.currentKnot,
      narration: state.narration.map(seg => ({
        text: seg.text,
        speaker: seg.speaker || undefined,
        voice: seg.voice || undefined,
        mood: seg.mood || undefined,
        tags: seg.tags,
      })),
      choices: state.choices.map(c => ({
        index: c.index,
        text: c.text,
        tags: c.tags,
        voice_hints: c.voiceHints,
      })),
      isEnded: state.ended,
    };

    this.#bus.publish('ink_state', inkState);

    // Derive voice and media from tags
    this.#deriveVoiceAndMedia(state);
  }

  #deriveVoiceAndMedia(state) {
    const firstSeg = state.narration[0];
    if (firstSeg?.speaker) {
      this.#bus.publish('voice', {
        speaker: firstSeg.speaker,
        voiceId: firstSeg.voice,
      });
    }

    for (const seg of state.narration) {
      const t = seg.tags || {};
      if (t.image) this.#bus.publish('media', { type: 'image', url: t.image, alt: t.alt, position: t.position });
      if (t.audio) this.#bus.publish('media', { type: 'audio', url: t.audio, role: t.role, loop: t.loop });
      if (t.foley) this.#bus.publish('media', { type: 'foley', name: t.foley });
    }
  }
}
