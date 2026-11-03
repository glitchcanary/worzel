/**
 * stage-boot.js — Wires Stage + StageWindowManager for the Fink client.
 *
 * Replaces: splat-boot.js + gvrm-avatar-boot.js
 *
 * Two actors on the stage:
 *   'env'    — CloudActor, soar.ksplat observatory environment
 *   'avatar' — CharacterActor, sample9.gvrm gaussian-vrm character
 *
 * Exposes window.finkAvatarScene for fink.js backward-compat:
 *   { connectAudioTap(gainNode, ctx), playAnim(name) }
 */

import { Stage }              from './stage.js';
import { StageWindowManager } from './stage-windows.js';
import { StageDebug }         from './stage-debug.js';

/** Fink window geometry: 520x700 centred, shrunk to fit small screens. */
function finkWindowRect() {
  const width  = Math.min(520, window.innerWidth  - 16);
  const height = Math.min(700, window.innerHeight - 16);
  return {
    x: Math.max(8, Math.round((window.innerWidth  - width)  / 2)),
    y: Math.max(8, Math.round((window.innerHeight - height) / 2)),
    width, height,
  };
}

// ── Feature flag: GAUSSIANS=OFF disables all 3D rendering ────────────────────
const gaussiansMeta = document.querySelector('meta[name="fink:gaussians"]');
if (gaussiansMeta?.getAttribute('content') === 'off') {
  console.log('[stage-boot] Gaussians disabled (GAUSSIANS=OFF)');
  // Still create the Fink window so the chat UI works.
  const { StageWindowManager: SWM } = await import('./stage-windows.js');
  const mgr2 = new SWM(document.body, {
    setActorVisible() {},
    onAllMinimised() {},
    onAnyVisible() {},
  });
  const finkEl2 = document.createElement('fink-app');
  const finkWin2 = mgr2.add({
    id: 'fink', title: 'Fink', ...finkWindowRect(), initialState: 'normal',
  });
  finkWin2.contentEl.style.pointerEvents = 'auto';
  finkWin2.contentEl.appendChild(finkEl2);
  throw new Error('[stage-boot] Gaussians off — halting stage init');
}

// ── Canvas ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('stage-canvas');
if (!canvas) throw new Error('[stage-boot] No #stage-canvas element');

canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;
window.addEventListener('resize', () => {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
});

// ── Stage (one WebGL context, Spark renderer) ─────────────────────────────────
const stage = new Stage(canvas, {
  cameraPosition: [0, 0.4, 1.5],
  cameraLookAt:   [0, 0.4, 0],
});

// ── Window manager ────────────────────────────────────────────────────────────
const mgr = new StageWindowManager(document.body, {
  setActorVisible(id, visible) {
    const actor = stage.getActor(id);
    if (!actor) return;
    actor.visible = visible;
    if (typeof actor._flush === 'function') actor._flush();
  },
  onAllMinimised() { stage.pause(); },
  onAnyVisible()   { stage.resume(); },
});


// ── Environment cloud window (starts maximised = full screen background) ──────
mgr.add({
  id:           'env',
  title:        'Environment',
  x:            0,
  y:            0,
  width:        window.innerWidth,
  height:       window.innerHeight,
  initialState: 'maximised',
});

// ── Avatar window ─────────────────────────────────────────────────────────────
mgr.add({
  id:           'avatar',
  title:        'Avatar',
  x:            Math.round(window.innerWidth  / 2) - 150,
  y:            Math.round(window.innerHeight / 2) - 220,
  width:        300,
  height:       440,
  initialState: 'normal',
});

// ── Fink chat window ──────────────────────────────────────────────────────────
const finkEl = document.createElement('fink-app');
const finkWin = mgr.add({
  id:           'fink',
  title:        'Fink',
  ...finkWindowRect(),
  initialState: 'normal',
});
finkWin.contentEl.style.pointerEvents = 'auto';
finkWin.contentEl.appendChild(finkEl);

// ── Expose finkAvatarScene shim immediately (fink.js may call it any time) ────
// The real CharacterActor is set once GVRM finishes loading below.
window.finkAvatarScene = {
  connectAudioTap: (gainNode, ctx) => {
    window.finkAvatarScene._actor?.connectAudioTap(gainNode, ctx);
  },
  playAnim: (name) => {
    window.finkAvatarScene._actor?.playAnim(name);
  },
  _actor: null,
};

// ── Load environment cloud ────────────────────────────────────────────────────
stage.addCloud('env', './splats/soar.ksplat', {
  cameraPosition: [0, 1, 6],
  cameraLookAt:   [0, 1, 0],
}).then(actor => {
  console.log('[stage-boot] Environment cloud loaded');
}).catch(e => console.warn('[stage-boot] Environment load failed:', e));

// ── Load avatar character ─────────────────────────────────────────────────────
stage.addCharacter('avatar', './avatars/sample8.gvrm', {
  initialAnim: 'idle',
}).then(actor => {
  window.finkAvatarScene._actor = actor;
  console.log('[stage-boot] Avatar character loaded');
}).catch(e => console.warn('[stage-boot] Avatar load failed:', e));

// ── Start render loop ─────────────────────────────────────────────────────────
stage.start();

// ── Debug handles ─────────────────────────────────────────────────────────────
window.finkStage = stage;
window.finkWinMgr = mgr;
window.finkDebug = new StageDebug();  // Ctrl+Shift+D to toggle
