/**
 * gvrm-avatar-boot.js — Loads a .gvrm Gaussian-VRM avatar with wawa-lipsync.
 *
 * Replaces avatar-boot.js for characters with Gaussian splat meshes bound to VRM bones.
 * Lipsync drives gvrm.character.currentVrm.expressionManager (same API as three-vrm).
 */

import * as THREE from './vendor/three.module.js';
import { GVRM } from './vendor/gaussian-vrm.min.js';
import { Lipsync } from './vendor/wawa-lipsync.js';

const GVRM_URL = './avatars/sample9.gvrm';

// wawa-lipsync viseme → VRM 1.x expression name
const VISEME_TO_VRM = {
  viseme_aa: 'aa', viseme_E: 'ee', viseme_I: 'ih', viseme_O: 'oh', viseme_U: 'ou',
  viseme_PP: 'aa', viseme_FF: 'ih', viseme_TH: 'ih', viseme_DD: 'aa',
  viseme_kk: 'aa', viseme_CH: 'ih', viseme_SS: 'ih', viseme_nn: 'ih',
  viseme_RR: 'oh', viseme_sil: null, sil: null,
};
const ALL_MOUTH = ['aa', 'ee', 'ih', 'oh', 'ou'];

const canvas = document.getElementById('avatar-canvas');
if (!canvas) throw new Error('[gvrm-avatar] No #avatar-canvas element');

canvas.width  = canvas.clientWidth  || 200;
canvas.height = canvas.clientHeight || 260;

// Three.js boilerplate — shared with the GVRM loader
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(canvas.clientWidth, canvas.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  30,
  canvas.clientWidth / canvas.clientHeight,
  0.1,
  20,
);
camera.position.set(0, 1.35, 2.5);
camera.lookAt(0, 1.35, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const key = new THREE.DirectionalLight(0xffffff, 1.2);
key.position.set(1, 2, 2);
scene.add(key);

let gvrm = null;
let lipsync = null;

// Called by the audio player once the gain node is available
function connectAudioTap(gainNode, audioContext) {
  try {
    lipsync = new Lipsync();
    const dest = audioContext.createMediaStreamDestination();
    gainNode.connect(dest);
    const src = lipsync.audioContext.createMediaStreamSource(dest.stream);
    src.connect(lipsync.analyser);
    console.log('[gvrm-avatar] Lipsync tap connected');
  } catch (err) {
    console.warn('[gvrm-avatar] Lipsync tap failed:', err);
  }
}

function applyViseme(viseme) {
  if (!gvrm?.character?.currentVrm) return;
  const em = gvrm.character.currentVrm.expressionManager;
  if (!em) return;
  for (const name of ALL_MOUTH) {
    try { em.setValue(name, 0); } catch { /* expression not present */ }
  }
  const target = VISEME_TO_VRM[viseme];
  if (target) {
    try { em.setValue(target, 0.8); } catch { /* expression not present */ }
  }
  em.update?.();
}

function animate() {
  requestAnimationFrame(animate);
  if (gvrm) {
    if (lipsync) {
      lipsync.processAudio();
      applyViseme(lipsync.viseme ?? 'sil');
    }
    gvrm.update();
  }
  renderer.render(scene, camera);
}

// Expose tap callback for fink.js audio player
window.finkAvatarScene = { connectAudioTap };

GVRM.load(GVRM_URL, scene, camera, renderer)
  .then((_gvrm) => {
    gvrm = _gvrm;
    window.finkGvrm = gvrm;
    console.log('[gvrm-avatar] Loaded', GVRM_URL);
    // Position avatar — sample9 loads at origin, nudge into frame
    if (gvrm.character?.currentVrm?.scene) {
      gvrm.character.currentVrm.scene.position.set(0, 0, 0);
    }
    animate();
  })
  .catch(err => console.error('[gvrm-avatar] Load failed:', err));
