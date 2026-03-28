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

// ── Canvas ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('stage-canvas');
if (!canvas) throw new Error('[stage-boot] No #stage-canvas element');

canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;
window.addEventListener('resize', () => {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
});

// ── Stage (one WebGL context) ─────────────────────────────────────────────────
const stage = new Stage(canvas, {
  cloudCameraPosition:  [0, 1, 6],
  cloudCameraLookAt:    [0, 1, 0],
  avatarCameraPosition: [0, 1.35, 2.5],
  avatarCameraLookAt:   [0, 1.35, 0],
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

// ── Avatar window (starts as small corner panel) ──────────────────────────────
mgr.add({
  id:           'avatar',
  title:        'Avatar',
  x:            window.innerWidth  - 216,
  y:            window.innerHeight - 292,
  width:        200,
  height:       260,
  initialState: 'normal',
});

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
  cloudCameraPosition: [0, 1, 6],
  cloudCameraLookAt:   [0, 1, 0],
  splatAlphaRemovalThreshold: 5,
}).then(actor => {
  console.log('[stage-boot] Environment cloud loaded');
}).catch(e => console.warn('[stage-boot] Environment load failed:', e));

// ── Load avatar character ─────────────────────────────────────────────────────
stage.addCharacter('avatar', './avatars/sample9.gvrm', {
  initialAnim:          'idle',
  avatarCameraPosition: [0, 1.35, 2.5],
  avatarCameraLookAt:   [0, 1.35, 0],
}).then(actor => {
  window.finkAvatarScene._actor = actor;
  console.log('[stage-boot] Avatar character loaded');
}).catch(e => console.warn('[stage-boot] Avatar load failed:', e));

// ── Start render loop ─────────────────────────────────────────────────────────
stage.start();

// ── Debug handles ─────────────────────────────────────────────────────────────
window.finkStage = stage;
window.finkWinMgr = mgr;
