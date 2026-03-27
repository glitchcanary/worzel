/**
 * avatar.js — Three.js VRM avatar with wawa-lipsync driven from AudioPlayer tap.
 *
 * Usage:
 *   const scene = new AvatarScene(canvasElement);
 *   await scene.loadVRM('./avatars/animal.vrm');
 *   scene.connectAudioTap(audioPlayerGainNode, audioContext);
 *   scene.start();
 */

import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from './vendor/three-vrm.module.js';
import { Lipsync } from './vendor/wawa-lipsync.js';

// wawa-lipsync viseme → VRM 1.0 expression name
// wawa-lipsync outputs: viseme_PP, viseme_FF, viseme_TH, viseme_DD, viseme_kk,
//   viseme_CH, viseme_SS, viseme_nn, viseme_RR, viseme_aa, viseme_E, viseme_I,
//   viseme_O, viseme_U, sil
const VISEME_TO_VRM = {
  viseme_aa:  'aa',
  viseme_E:   'ee',
  viseme_I:   'ih',
  viseme_O:   'oh',
  viseme_U:   'ou',
  // consonants: keep mouth slightly open
  viseme_PP:  'aa',
  viseme_FF:  'ih',
  viseme_TH:  'ih',
  viseme_DD:  'aa',
  viseme_kk:  'aa',
  viseme_CH:  'ih',
  viseme_SS:  'ih',
  viseme_nn:  'ih',
  viseme_RR:  'oh',
  viseme_sil: null,
  sil:        null,
};

// VRM 0.x uses uppercase preset names
const VISEME_TO_VRM0 = {
  viseme_aa:  'A',
  viseme_E:   'E',
  viseme_I:   'I',
  viseme_O:   'O',
  viseme_U:   'U',
  viseme_PP:  'A',
  viseme_FF:  'I',
  viseme_TH:  'I',
  viseme_DD:  'A',
  viseme_kk:  'A',
  viseme_CH:  'I',
  viseme_SS:  'I',
  viseme_nn:  'I',
  viseme_RR:  'O',
  viseme_sil: null,
  sil:        null,
};

const ALL_MOUTH_VRM1 = ['aa', 'ee', 'ih', 'oh', 'ou'];
const ALL_MOUTH_VRM0 = ['A', 'E', 'I', 'O', 'U'];

export class AvatarScene {
  #canvas;
  #renderer;
  #scene;
  #camera;
  #vrm = null;
  #vrmVersion = 1; // 0 or 1
  #lipsync = null;
  #lipsyncAudio = null;
  #clock;
  #rafId = null;
  #ready = false;

  constructor(canvas) {
    this.#canvas = canvas;
    this.#clock = new THREE.Clock();

    this.#renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.setSize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height);
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.#scene = new THREE.Scene();

    this.#camera = new THREE.PerspectiveCamera(
      30,
      (canvas.clientWidth || canvas.width) / (canvas.clientHeight || canvas.height),
      0.1,
      20,
    );
    this.#camera.position.set(0, 1.35, 1.8);
    this.#camera.lookAt(0, 1.35, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.#scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1, 2, 2);
    this.#scene.add(key);
  }

  async loadVRM(url) {
    const loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser));

    const gltf = await new Promise((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });

    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.removeUnnecessaryJoints(gltf.scene);

    this.#vrm = gltf.userData.vrm;
    if (!this.#vrm) throw new Error('No VRM data found in file');

    // Detect VRM version
    const meta = this.#vrm.meta;
    this.#vrmVersion = (meta?.metaVersion === '1' || meta?.specVersion?.startsWith('1')) ? 1 : 0;

    if (this.#vrmVersion === 0) {
      VRMUtils.rotateVRM0(this.#vrm);
    }

    this.#scene.add(this.#vrm.scene);
    this.#ready = true;
    console.log(`[avatar] VRM loaded (version ${this.#vrmVersion})`);
  }

  /**
   * Connect wawa-lipsync to the AudioPlayer's gain node.
   * Creates a MediaStreamDestination tap and wires it to LipSync.
   */
  connectAudioTap(gainNode, audioContext) {
    try {
      const dest = audioContext.createMediaStreamDestination();
      gainNode.connect(dest);
      const audio = new Audio();
      audio.srcObject = dest.stream;
      // wawa-lipsync checks audio.src — set srcObject via a blob URL workaround
      // by using createObjectURL on the stream
      audio.src = URL.createObjectURL(dest.stream);
      audio.muted = true; // prevent double playback
      this.#lipsyncAudio = audio;
      this.#lipsync = new Lipsync();
      this.#lipsync.connectAudio(audio);
      console.log('[avatar] Lipsync tap connected');
    } catch (err) {
      console.warn('[avatar] Lipsync tap failed:', err);
    }
  }

  start() {
    if (this.#rafId) return;
    const tick = () => {
      this.#rafId = requestAnimationFrame(tick);
      const delta = this.#clock.getDelta();
      this.#update(delta);
    };
    tick();
  }

  stop() {
    if (this.#rafId) { cancelAnimationFrame(this.#rafId); this.#rafId = null; }
  }

  resize(w, h) {
    this.#renderer.setSize(w, h);
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
  }

  #update(delta) {
    if (this.#ready && this.#vrm) {
      if (this.#lipsync) {
        this.#lipsync.processAudio();
        const viseme = this.#lipsync.viseme ?? 'sil';
        this.#applyViseme(viseme);
      }
      this.#vrm.update(delta);
    }
    this.#renderer.render(this.#scene, this.#camera);
  }

  #applyViseme(viseme) {
    const em = this.#vrm.expressionManager ?? this.#vrm.blendShapeProxy;
    if (!em) return;

    const map = this.#vrmVersion === 0 ? VISEME_TO_VRM0 : VISEME_TO_VRM;
    const allMouth = this.#vrmVersion === 0 ? ALL_MOUTH_VRM0 : ALL_MOUTH_VRM1;

    // Zero all mouth expressions
    for (const name of allMouth) {
      try { em.setValue(name, 0); } catch { /* not supported by this model */ }
    }

    const target = map[viseme];
    if (target) {
      try { em.setValue(target, 0.8); } catch { /* not supported */ }
    }

    if (em.update) em.update();
  }
}
