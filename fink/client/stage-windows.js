/**
 * stage-windows.js — DOM window manager for the Stage compositor.
 *
 * Pure DOM — no WebGL, no Three.js imports.
 * Each window wraps a Stage actor (Cloud or Character) with:
 *   - draggable title bar
 *   - minimise / maximise buttons
 *   - click-to-raise z-ordering
 *
 * Fires callbacks into Stage when visibility changes so the RAF loop can
 * be paused when all windows are minimised.
 */

// ── CSS injected once into document.head ──────────────────────────────────────
const STAGE_WINDOW_CSS = `
.stage-win {
  position: fixed;
  box-sizing: border-box;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 6px;
  overflow: hidden;
  background: transparent;
  user-select: none;
  transition: box-shadow 0.15s;
}
.stage-win:focus-within,
.stage-win.sw-raised {
  box-shadow: 0 0 0 1px rgba(233,69,96,0.6);
}
.sw-titlebar {
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 6px;
  background: rgba(15,52,96,0.88);
  cursor: grab;
  gap: 4px;
  backdrop-filter: blur(4px);
}
.sw-titlebar:active { cursor: grabbing; }
.sw-title {
  flex: 1;
  font-size: 11px;
  color: #c8c8d8;
  font-family: system-ui, sans-serif;
  pointer-events: none;
}
.sw-btn {
  width: 18px; height: 18px;
  border: none; border-radius: 3px;
  background: rgba(255,255,255,0.08);
  color: #c8c8d8;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.sw-btn:hover { background: rgba(255,255,255,0.22); }
.sw-content {
  width: 100%;
  height: calc(100% - 26px);
  overflow: hidden;
  pointer-events: none; /* content (canvas) handled by stage-boot */
}
.stage-win.sw-minimised .sw-content { display: none; }
.stage-win.sw-maximised {
  border-radius: 0;
  border: none;
}
`;

let cssInjected = false;
function injectCSS() {
  if (cssInjected) return;
  const style = document.createElement('style');
  style.textContent = STAGE_WINDOW_CSS;
  document.head.appendChild(style);
  cssInjected = true;
}

// ── StageWindow ────────────────────────────────────────────────────────────────
export class StageWindow {
  /**
   * @param {object} opts
   * @param {string}   opts.id
   * @param {string}   opts.title
   * @param {number}   opts.x
   * @param {number}   opts.y
   * @param {number}   opts.width
   * @param {number}   opts.height
   * @param {'normal'|'maximised'|'minimised'} [opts.initialState='normal']
   * @param {Function} [opts.onVisibilityChange]  (id, visible:bool) => void
   * @param {Function} [opts.onStateChange]       (id, state:string) => void
   * @param {Function} [opts.onFocus]             (id) => void
   */
  constructor(opts) {
    injectCSS();

    this.id    = opts.id;
    this.title = opts.title;

    this._normalRect = {
      x: opts.x ?? 16,
      y: opts.y ?? 16,
      w: opts.width  ?? 200,
      h: opts.height ?? 260,
    };

    this._onVisibilityChange = opts.onVisibilityChange ?? (() => {});
    this._onStateChange      = opts.onStateChange      ?? (() => {});
    this._onFocus            = opts.onFocus            ?? (() => {});

    this.state = null; // set by _applyState below
    this.el    = this._build();
    this._applyState(opts.initialState ?? 'normal');
  }

  _build() {
    const el = document.createElement('div');
    el.className     = 'stage-win';
    el.dataset.winId = this.id;
    el.innerHTML = `
      <div class="sw-titlebar">
        <span class="sw-title">${this.title}</span>
        <button class="sw-btn sw-min" title="Minimise">&#x2014;</button>
        <button class="sw-btn sw-max" title="Maximise/Restore">&#x25A1;</button>
      </div>
      <div class="sw-content"></div>
    `;

    el.querySelector('.sw-titlebar')
      .addEventListener('pointerdown', e => this._startDrag(e));

    el.querySelector('.sw-min')
      .addEventListener('click', e => { e.stopPropagation(); this._toggleMinimise(); });

    el.querySelector('.sw-max')
      .addEventListener('click', e => { e.stopPropagation(); this._toggleMaximise(); });

    el.addEventListener('pointerdown', () => this._onFocus(this.id));

    return el;
  }

  /** The inner div where external content (e.g. a canvas) can be appended. */
  get contentEl() {
    return this.el.querySelector('.sw-content');
  }

  _applyState(newState) {
    const prev = this.state;
    this.state = newState;

    this.el.classList.remove('sw-normal', 'sw-maximised', 'sw-minimised');
    this.el.classList.add(`sw-${newState}`);

    if (newState === 'maximised') {
      Object.assign(this.el.style, {
        left: '0', top: '0', width: '100vw', height: '100vh',
      });
    } else if (newState === 'minimised') {
      Object.assign(this.el.style, {
        left:   `${this._normalRect.x}px`,
        top:    `${this._normalRect.y}px`,
        width:  `${this._normalRect.w}px`,
        height: '26px',
      });
    } else {
      // normal
      Object.assign(this.el.style, {
        left:   `${this._normalRect.x}px`,
        top:    `${this._normalRect.y}px`,
        width:  `${this._normalRect.w}px`,
        height: `${this._normalRect.h}px`,
      });
    }

    const visible = newState !== 'minimised';
    if (prev !== newState) {
      this._onVisibilityChange(this.id, visible);
      this._onStateChange(this.id, newState);
    }
  }

  _toggleMinimise() {
    this._applyState(this.state === 'minimised' ? 'normal' : 'minimised');
  }

  _toggleMaximise() {
    this._applyState(this.state === 'maximised' ? 'normal' : 'maximised');
  }

  _startDrag(e) {
    if (e.target.classList.contains('sw-btn')) return;
    if (this.state === 'maximised') return;
    e.preventDefault();

    const el = this.el;
    const ox = e.clientX - el.offsetLeft;
    const oy = e.clientY - el.offsetTop;

    const onMove = mv => {
      const x = mv.clientX - ox;
      const y = mv.clientY - oy;
      el.style.left = `${x}px`;
      el.style.top  = `${y}px`;
      this._normalRect.x = x;
      this._normalRect.y = y;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
      el.querySelector('.sw-titlebar').style.cursor = 'grab';
    };
    el.querySelector('.sw-titlebar').style.cursor = 'grabbing';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);
  }
}

// ── StageWindowManager ─────────────────────────────────────────────────────────
export class StageWindowManager {
  /**
   * @param {HTMLElement} container  — typically document.body
   * @param {object} stageCallbacks
   * @param {Function} stageCallbacks.setActorVisible  (id, bool) => void
   * @param {Function} stageCallbacks.onAllMinimised   () => void
   * @param {Function} stageCallbacks.onAnyVisible     () => void
   */
  constructor(container, stageCallbacks) {
    this._container = container;
    this._cbs       = stageCallbacks;
    this._windows   = new Map();  // id → StageWindow
    this._zBase     = 10;
  }

  /**
   * Register a window and append it to the container.
   * @param {object} opts — StageWindow constructor opts
   * @returns {StageWindow}
   */
  add(opts) {
    const win = new StageWindow({
      ...opts,
      onVisibilityChange: (id, visible) => {
        this._cbs.setActorVisible(id, visible);
        this._checkAllMinimised();
      },
      onFocus: id => this._raise(id),
    });
    this._container.appendChild(win.el);
    this._windows.set(opts.id, win);
    this._raise(opts.id);
    return win;
  }

  get(id) { return this._windows.get(id) ?? null; }

  _raise(id) {
    const n = this._windows.size;
    let z = this._zBase;
    // Give every window a z-index, raised window gets the highest.
    const others = [...this._windows.keys()].filter(k => k !== id);
    for (const k of others) {
      this._windows.get(k).el.style.zIndex = String(z++);
      this._windows.get(k).el.classList.remove('sw-raised');
    }
    const raised = this._windows.get(id);
    if (raised) {
      raised.el.style.zIndex = String(this._zBase + n);
      raised.el.classList.add('sw-raised');
    }
  }

  _checkAllMinimised() {
    const allMin = [...this._windows.values()].every(w => w.state === 'minimised');
    if (allMin) {
      this._cbs.onAllMinimised();
    } else {
      this._cbs.onAnyVisible();
    }
  }
}
