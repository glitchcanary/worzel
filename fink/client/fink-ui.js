// FinkUI — DOM rendering module for finkapp
//
// Renders narration segments, choice cards, images, status messages,
// and story-end states. Emits DOM events for user interactions.
//
// Events dispatched:
//   'finkapp-choice'   { detail: { index: number } }
//   'finkapp-restart'  { detail: {} }
//   'finkapp-link'     { detail: { storyId: string } }
//
// This module owns the DOM. The engine module (fink-ink.js) owns the story.
// The player module (fink-player.js) wires them together.

export class FinkUI {
  /** @type {HTMLElement} */  #root;
  /** @type {HTMLElement} */  #narrationEl;
  /** @type {HTMLElement} */  #choicesEl;
  /** @type {HTMLElement} */  #statusEl;
  /** @type {HTMLElement} */  #headerEl;
  /** @type {HTMLElement} */  #knotLabel;
  /** @type {HTMLElement} */  #bgEl;

  /**
   * @param {HTMLElement} root - container element to render into
   */
  constructor(root) {
    this.#root = root;
    this.#build();
  }

  #build() {
    this.#root.innerHTML = '';
    this.#root.classList.add('finkapp');

    // Header
    this.#headerEl = el('header', 'finkapp-header');
    const titleSpan = el('span', 'finkapp-title');
    titleSpan.textContent = 'finkapp';
    this.#knotLabel = el('span', 'finkapp-knot');
    this.#headerEl.append(titleSpan, this.#knotLabel);

    // Background layer (for BG: tags)
    this.#bgEl = el('div', 'finkapp-bg');

    // Narration (scrolling)
    this.#narrationEl = el('div', 'finkapp-narration');

    // Choices
    this.#choicesEl = el('div', 'finkapp-choices');

    // Status bar
    this.#statusEl = el('div', 'finkapp-status');

    this.#root.append(this.#headerEl, this.#bgEl, this.#narrationEl, this.#choicesEl, this.#statusEl);
  }

  /**
   * Set the story title displayed in the header.
   * @param {string} title
   */
  setTitle(title) {
    this.#headerEl.querySelector('.finkapp-title').textContent = title;
  }

  /**
   * Show the current knot name in the header.
   * @param {string|null} knot
   */
  setKnot(knot) {
    this.#knotLabel.textContent = knot ? `· ${knot}` : '';
  }

  /**
   * Set a status message in the footer bar.
   * @param {string} text
   * @param {'info'|'error'|'muted'} [level='info']
   */
  setStatus(text, level = 'info') {
    this.#statusEl.textContent = text;
    this.#statusEl.dataset.level = level;
  }

  /**
   * Clear all narration content.
   */
  clearNarration() {
    this.#narrationEl.innerHTML = '';
    this.#bgEl.style.backgroundImage = '';
    this.#bgEl.classList.remove('active');
  }

  /**
   * Render narration segments from a StoryState.
   * @param {import('./fink-ink.js').NarrationSegment[]} segments
   */
  addNarration(segments) {
    for (const seg of segments) {
      // Handle media-only tags
      if (seg.tags?.bg) {
        this.#setBg(seg.tags.bg);
      }
      if (seg.tags?.image) {
        this.#addImage(seg.tags.image);
      }
      if (seg.tags?.vizprom) {
        this.#addVizprom(seg.tags.vizprom);
      }
      if (seg.tags?.audio) {
        this.#addAudioTag(seg.tags.audio);
      }
      if (seg.tags?.foley) {
        this.#addFoleyTag(seg.tags.foley);
      }
      if (seg.tags?.video) {
        this.#addVideoTag(seg.tags.video);
      }

      // Text narration
      if (seg.text) {
        const p = el('p', 'finkapp-para');
        if (seg.speaker && seg.speaker !== 'narrator') {
          const label = el('span', 'finkapp-speaker');
          label.textContent = seg.speaker;
          p.append(label, document.createTextNode(' '));
        }
        if (seg.mood) {
          p.dataset.mood = seg.mood;
        }
        p.append(document.createTextNode(seg.text));
        this.#narrationEl.appendChild(p);
      }
    }

    this.#scrollToBottom();
  }

  /**
   * Render choices as tappable cards.
   * @param {import('./fink-ink.js').InkChoice[]} choices
   */
  setChoices(choices) {
    this.#choicesEl.innerHTML = '';

    if (choices.length === 0) return;

    for (const choice of choices) {
      const btn = el('button', 'finkapp-choice-btn');
      const num = el('span', 'finkapp-choice-num');
      num.textContent = `${choice.index + 1}`;
      const text = el('span', 'finkapp-choice-text');
      text.textContent = choice.text;
      btn.append(num, text);

      if (choice.tags?.finkLink) {
        btn.dataset.finkLink = choice.tags.finkLink;
      }

      btn.addEventListener('click', () => {
        if (choice.tags?.finkLink) {
          this.#root.dispatchEvent(new CustomEvent('finkapp-link', {
            bubbles: true,
            detail: { storyId: choice.tags.finkLink },
          }));
        } else {
          this.#root.dispatchEvent(new CustomEvent('finkapp-choice', {
            bubbles: true,
            detail: { index: choice.index },
          }));
        }
      });

      this.#choicesEl.appendChild(btn);
    }

    this.#scrollToBottom();
  }

  /**
   * Show the story-ended state with an optional restart button.
   * @param {boolean} [showRestart=true]
   */
  showEnded(showRestart = true) {
    this.#choicesEl.innerHTML = '';
    const msg = el('div', 'finkapp-ended');
    msg.textContent = 'Story ended.';
    this.#choicesEl.appendChild(msg);

    if (showRestart) {
      const btn = el('button', 'finkapp-restart-btn');
      btn.textContent = 'Restart';
      btn.addEventListener('click', () => {
        this.#root.dispatchEvent(new CustomEvent('finkapp-restart', {
          bubbles: true,
        }));
      });
      this.#choicesEl.appendChild(btn);
    }
  }

  /**
   * Show compilation or runtime errors.
   * @param {string[]} errors
   */
  showErrors(errors) {
    for (const err of errors) {
      const p = el('p', 'finkapp-error');
      p.textContent = err;
      this.#narrationEl.appendChild(p);
    }
    this.#scrollToBottom();
  }

  // ── Media helpers ──────────────────────────────────────────────────

  #setBg(url) {
    this.#bgEl.style.backgroundImage = `url(${url})`;
    this.#bgEl.classList.add('active');
  }

  #addImage(url) {
    const img = el('img', 'finkapp-image');
    img.src = url;
    img.loading = 'lazy';
    this.#narrationEl.appendChild(img);
  }

  #addVizprom(prompt) {
    const div = el('div', 'finkapp-vizprom');
    div.textContent = `[vizprom: ${prompt}]`;
    this.#narrationEl.appendChild(div);
  }

  #addAudioTag(src) {
    const div = el('div', 'finkapp-media-tag');
    div.textContent = `♪ ${src}`;
    this.#narrationEl.appendChild(div);
  }

  #addFoleyTag(name) {
    const div = el('div', 'finkapp-media-tag');
    div.textContent = `♫ foley: ${name}`;
    this.#narrationEl.appendChild(div);
  }

  #addVideoTag(src) {
    const video = el('video', 'finkapp-video');
    video.src = src;
    video.controls = true;
    video.preload = 'metadata';
    this.#narrationEl.appendChild(video);
  }

  #scrollToBottom() {
    requestAnimationFrame(() => {
      this.#narrationEl.scrollTop = this.#narrationEl.scrollHeight;
    });
  }
}

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
