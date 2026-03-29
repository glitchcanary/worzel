/**
 * stage-debug.js — In-app tweak panel for Stage parameters.
 *
 * Reads/writes window.finkStage and window.finkWinMgr.
 * Toggle with: Ctrl+Shift+D
 *
 * Sliders:
 *   Avatar camera: pos X/Y/Z, lookAt X/Y/Z
 *   Cloud camera:  pos X/Y/Z, lookAt X/Y/Z
 *   Avatar window: x, y, width, height
 *
 * "Copy" button prints current values to console as JSON.
 */

const CSS = `
#stage-debug {
  position: fixed;
  top: 8px;
  right: 8px;
  z-index: 9999;
  background: rgba(10,10,20,0.92);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 6px;
  padding: 14px 16px;
  font: 14px/1.6 system-ui, sans-serif;
  color: #c8c8d8;
  width: 340px;
  backdrop-filter: blur(6px);
  user-select: none;
}
#stage-debug h3 {
  margin: 0 0 8px;
  font-size: 15px;
  color: #e94560;
  letter-spacing: 0.05em;
}
#stage-debug .sd-section {
  margin-bottom: 10px;
}
#stage-debug .sd-label {
  font-size: 13px;
  color: #8b8fa3;
  margin-bottom: 3px;
  margin-top: 6px;
}
#stage-debug .sd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}
#stage-debug .sd-row label {
  width: 22px;
  flex-shrink: 0;
  font-size: 13px;
  color: #8b8fa3;
}
#stage-debug input[type=range] {
  flex: 1;
  height: 4px;
  accent-color: #e94560;
}
#stage-debug .sd-val {
  width: 46px;
  text-align: right;
  font-size: 13px;
  color: #e8e8e8;
  flex-shrink: 0;
}
#stage-debug .sd-buttons {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
#stage-debug button {
  flex: 1;
  padding: 5px 0;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 3px;
  background: rgba(255,255,255,0.06);
  color: #c8c8d8;
  font-size: 13px;
  cursor: pointer;
}
#stage-debug button:hover { background: rgba(255,255,255,0.14); }
`;

function slider(label, min, max, step, value, onChange) {
  const row  = document.createElement('div');
  row.className = 'sd-row';

  const lbl = document.createElement('label');
  lbl.textContent = label;

  const inp = document.createElement('input');
  inp.type  = 'range';
  inp.min   = min;
  inp.max   = max;
  inp.step  = step;
  inp.value = value;

  const val = document.createElement('span');
  val.className = 'sd-val';
  val.textContent = Number(value).toFixed(2);

  inp.addEventListener('input', () => {
    val.textContent = Number(inp.value).toFixed(2);
    onChange(Number(inp.value));
  });

  row.append(lbl, inp, val);
  return { row, inp, val };
}

function sectionLabel(text) {
  const d = document.createElement('div');
  d.className = 'sd-label';
  d.textContent = text;
  return d;
}

export class StageDebug {
  constructor() {
    this._el     = null;
    this._visible = false;
    this._sliders = {};  // key → { inp, val }

    this._state = {
      avatarCamPosX:  0,    avatarCamPosY:  1.35, avatarCamPosZ: 2.5,
      avatarLookX:    0,    avatarLookY:    1.35, avatarLookZ:   0,
      cloudCamPosX:   0,    cloudCamPosY:   1,    cloudCamPosZ:  6,
      cloudLookX:     0,    cloudLookY:     1,    cloudLookZ:    0,
      winX:           0,    winY:           0,
      winW:           300,  winH:           440,
    };

    this._build();
    this._syncFromStage();

    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') this.toggle();
    });
  }

  toggle() {
    this._visible = !this._visible;
    this._el.style.display = this._visible ? 'block' : 'none';
    if (this._visible) this._syncFromStage();
  }

  _syncFromStage() {
    const stage = window.finkStage;
    const mgr   = window.finkWinMgr;
    if (!stage) return;

    // Read camera positions via the exposed _cameras getter if available,
    // otherwise fall back to stored state.
    const cams = stage.getCameras?.();
    if (cams) {
      const ac = cams.avatar;
      this._set('avatarCamPosX', ac.position.x);
      this._set('avatarCamPosY', ac.position.y);
      this._set('avatarCamPosZ', ac.position.z);
      const cc = cams.cloud;
      this._set('cloudCamPosX', cc.position.x);
      this._set('cloudCamPosY', cc.position.y);
      this._set('cloudCamPosZ', cc.position.z);
    }

    const win = mgr?.get('avatar');
    if (win) {
      const r = win._normalRect;
      this._set('winX', r.x);
      this._set('winY', r.y);
      this._set('winW', r.w);
      this._set('winH', r.h);
    }
  }

  _set(key, value) {
    this._state[key] = value;
    const s = this._sliders[key];
    if (s) {
      s.inp.value = value;
      s.val.textContent = Number(value).toFixed(2);
    }
  }

  _applyAvatarCam() {
    const stage = window.finkStage;
    if (!stage?.setCameraState) return;
    stage.setCameraState('avatar', {
      position: [this._state.avatarCamPosX, this._state.avatarCamPosY, this._state.avatarCamPosZ],
      lookAt:   [this._state.avatarLookX,   this._state.avatarLookY,   this._state.avatarLookZ],
    });
  }

  _applyCloudCam() {
    const stage = window.finkStage;
    if (!stage?.setCameraState) return;
    stage.setCameraState('cloud', {
      position: [this._state.cloudCamPosX, this._state.cloudCamPosY, this._state.cloudCamPosZ],
      lookAt:   [this._state.cloudLookX,   this._state.cloudLookY,   this._state.cloudLookZ],
    });
  }

  _applyWin() {
    const mgr = window.finkWinMgr;
    const win = mgr?.get('avatar');
    if (!win) return;
    win._normalRect.x = this._state.winX;
    win._normalRect.y = this._state.winY;
    win._normalRect.w = this._state.winW;
    win._normalRect.h = this._state.winH;
    if (win.state === 'normal') win._applyState('normal');
  }

  _build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'stage-debug';
    el.style.display = 'none';

    const h3 = document.createElement('h3');
    h3.textContent = 'Stage Debug  [Ctrl+Shift+D]';
    el.appendChild(h3);

    // ── Avatar camera ──
    el.appendChild(sectionLabel('Avatar camera position'));
    const avatarCamDefs = [
      ['X', 'avatarCamPosX', -5, 5,  0.05, () => this._applyAvatarCam()],
      ['Y', 'avatarCamPosY',  0, 4,  0.05, () => this._applyAvatarCam()],
      ['Z', 'avatarCamPosZ',  0.2, 10, 0.05, () => this._applyAvatarCam()],
    ];
    for (const [lbl, key, min, max, step, fn] of avatarCamDefs) {
      const s = slider(lbl, min, max, step, this._state[key], v => { this._state[key] = v; fn(); });
      this._sliders[key] = s;
      el.appendChild(s.row);
    }

    el.appendChild(sectionLabel('Avatar camera lookAt'));
    const avatarLookDefs = [
      ['X', 'avatarLookX', -2, 2,  0.05, () => this._applyAvatarCam()],
      ['Y', 'avatarLookY',  0, 3,  0.05, () => this._applyAvatarCam()],
      ['Z', 'avatarLookZ', -2, 2,  0.05, () => this._applyAvatarCam()],
    ];
    for (const [lbl, key, min, max, step, fn] of avatarLookDefs) {
      const s = slider(lbl, min, max, step, this._state[key], v => { this._state[key] = v; fn(); });
      this._sliders[key] = s;
      el.appendChild(s.row);
    }

    // ── Cloud camera ──
    el.appendChild(sectionLabel('Cloud camera position'));
    const cloudCamDefs = [
      ['X', 'cloudCamPosX', -10, 10, 0.1, () => this._applyCloudCam()],
      ['Y', 'cloudCamPosY', -5,  10, 0.1, () => this._applyCloudCam()],
      ['Z', 'cloudCamPosZ', -10, 20, 0.1, () => this._applyCloudCam()],
    ];
    for (const [lbl, key, min, max, step, fn] of cloudCamDefs) {
      const s = slider(lbl, min, max, step, this._state[key], v => { this._state[key] = v; fn(); });
      this._sliders[key] = s;
      el.appendChild(s.row);
    }

    el.appendChild(sectionLabel('Cloud camera lookAt'));
    const cloudLookDefs = [
      ['X', 'cloudLookX', -10, 10, 0.1, () => this._applyCloudCam()],
      ['Y', 'cloudLookY', -5,  10, 0.1, () => this._applyCloudCam()],
      ['Z', 'cloudLookZ', -10, 10, 0.1, () => this._applyCloudCam()],
    ];
    for (const [lbl, key, min, max, step, fn] of cloudLookDefs) {
      const s = slider(lbl, min, max, step, this._state[key], v => { this._state[key] = v; fn(); });
      this._sliders[key] = s;
      el.appendChild(s.row);
    }

    // ── Render rate ──
    el.appendChild(sectionLabel('Max FPS (0 = uncapped)'));
    const fpsSlider = slider('fps', 0, 90, 1, 24, v => {
      window.finkStage?.setMaxFps(v);
    });
    this._sliders['maxFps'] = fpsSlider;
    el.appendChild(fpsSlider.row);

    // ── Avatar window ──
    el.appendChild(sectionLabel('Avatar window'));
    const winDefs = [
      ['x',  'winX', 0, 1920, 1, () => this._applyWin()],
      ['y',  'winY', 0, 1080, 1, () => this._applyWin()],
      ['w',  'winW', 100, 1200, 1, () => this._applyWin()],
      ['h',  'winH', 100, 1200, 1, () => this._applyWin()],
    ];
    for (const [lbl, key, min, max, step, fn] of winDefs) {
      const s = slider(lbl, min, max, step, this._state[key], v => { this._state[key] = v; fn(); });
      this._sliders[key] = s;
      el.appendChild(s.row);
    }

    // ── Avatar switcher ──
    el.appendChild(sectionLabel('Avatar model'));
    const avatarRow = document.createElement('div');
    avatarRow.className = 'sd-row';
    const avatarSel = document.createElement('select');
    avatarSel.style.cssText = 'flex:1; background:#111; color:#c8c8d8; border:1px solid rgba(255,255,255,0.15); border-radius:3px; font-size:13px; padding:2px 4px;';
    ['author','sample1','sample2','sample3','sample4','sample5','sample6','sample7','sample8','sample9'].forEach(name => {
      const opt = document.createElement('option');
      opt.value = `./avatars/${name}.gvrm`;
      opt.textContent = name;
      if (name === 'sample8') opt.selected = true;
      avatarSel.appendChild(opt);
    });
    const loadBtn = document.createElement('button');
    loadBtn.textContent = 'Load';
    loadBtn.style.cssText = 'width:48px; flex-shrink:0; padding:3px 0; border:1px solid rgba(255,255,255,0.15); border-radius:3px; background:rgba(255,255,255,0.06); color:#c8c8d8; font-size:13px; cursor:pointer;';
    loadBtn.addEventListener('click', () => {
      const stage = window.finkStage;
      if (!stage) return;
      loadBtn.textContent = '...';
      stage.swapCharacter('avatar', avatarSel.value, { initialAnim: 'idle' })
        .then(() => { loadBtn.textContent = 'Load'; })
        .catch(e => { console.warn('[debug] swap failed:', e); loadBtn.textContent = 'Err'; });
    });
    avatarRow.append(avatarSel, loadBtn);
    el.appendChild(avatarRow);

    // ── Buttons ──
    const btns = document.createElement('div');
    btns.className = 'sd-buttons';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy state';
    copyBtn.addEventListener('click', () => {
      const out = {
        avatarCamera: {
          position: [this._state.avatarCamPosX, this._state.avatarCamPosY, this._state.avatarCamPosZ],
          lookAt:   [this._state.avatarLookX,   this._state.avatarLookY,   this._state.avatarLookZ],
        },
        cloudCamera: {
          position: [this._state.cloudCamPosX, this._state.cloudCamPosY, this._state.cloudCamPosZ],
          lookAt:   [this._state.cloudLookX,   this._state.cloudLookY,   this._state.cloudLookZ],
        },
        avatarWindow: {
          x: this._state.winX, y: this._state.winY,
          width: this._state.winW, height: this._state.winH,
        },
      };
      console.log('[StageDebug] state:', JSON.stringify(out, null, 2));
    });

    const syncBtn = document.createElement('button');
    syncBtn.textContent = 'Sync from stage';
    syncBtn.addEventListener('click', () => this._syncFromStage());

    btns.append(copyBtn, syncBtn);
    el.appendChild(btns);

    document.body.appendChild(el);
    this._el = el;
  }
}
