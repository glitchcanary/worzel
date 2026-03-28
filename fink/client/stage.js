/**
 * stage.js — Stage compositor.
 *
 * Vocabulary:
 *   Gaussian      — one 3D Gaussian particle
 *   Cloud         — a named collection of Gaussians loaded from a file (.ksplat/.ply)
 *   CloudActor    — a Cloud placed on the Stage with position/quaternion/velocity
 *   CharacterActor— Gaussians bound to a VRM skeleton (gaussian-vrm)
 *   Stage         — one WebGL context, one RAF loop, all actors rendered together
 *
 * Usage:
 *   const stage = new Stage(canvas);
 *   const env   = await stage.addCloud('env', './splats/soar.ksplat');
 *   const char  = await stage.addCharacter('avatar', './avatars/sample9.gvrm');
 *   stage.start();
 */

import * as THREE from './vendor/three.module.js';
import { Viewer }  from './vendor/gaussian-splats-3d.module.js';
import { GVRM }    from './vendor/gaussian-vrm.min.js';
import { Lipsync } from './vendor/wawa-lipsync.js';

// ── Viseme → VRM expression map ───────────────────────────────────────────────
const VISEME_TO_VRM = {
  viseme_aa: 'aa', viseme_E: 'ee', viseme_I: 'ih', viseme_O: 'oh', viseme_U: 'ou',
  viseme_PP: 'aa', viseme_FF: 'ih', viseme_TH: 'ih', viseme_DD: 'aa',
  viseme_kk: 'aa', viseme_CH: 'ih', viseme_SS: 'ih', viseme_nn: 'ih',
  viseme_RR: 'oh', viseme_sil: null, sil: null,
};
const ALL_MOUTH_EXPRS = ['aa', 'ee', 'ih', 'oh', 'ou'];

// ── CloudActor ─────────────────────────────────────────────────────────────────
export class CloudActor {
  constructor(id, sceneIndex, splatMesh) {
    this.id           = id;
    this._sceneIndex  = sceneIndex;
    this._splatMesh   = splatMesh;

    // Public transform — write these; _flush() pushes them to the underlying Cloud.
    this.position        = new THREE.Vector3();
    this.quaternion      = new THREE.Quaternion();
    this.scale           = new THREE.Vector3(1, 1, 1);

    // Physics — integrated by Stage.tick() each frame.
    this.velocity        = new THREE.Vector3();   // world-units / sec
    this.angularVelocity = new THREE.Vector3();   // euler rates rad/sec (XYZ)

    this.opacity = 1.0;
    this.visible = true;
  }

  /** Sync public state into the underlying SplatScene. Called by Stage.tick(). */
  _flush() {
    const cloud = this._splatMesh.getScene(this._sceneIndex);
    if (!cloud) return;
    cloud.position.copy(this.position);
    cloud.quaternion.copy(this.quaternion);
    cloud.scale.copy(this.scale);
    cloud.opacity = this.opacity;
    cloud.visible = this.visible;
  }
}

// ── CharacterActor ─────────────────────────────────────────────────────────────
export class CharacterActor {
  #gvrm    = null;
  #lipsync = null;

  constructor(id) {
    this.id       = id;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.visible  = true;

    this._animMap = {
      idle:      './animations/Breathing.fbx',
      listening: './animations/Listening.fbx',
      happy:     './animations/Happy Idle.fbx',
      pointing:  './animations/Pointing.fbx',
    };
  }

  _attach(gvrm) {
    this.#gvrm = gvrm;
  }

  playAnim(name) {
    const url = this._animMap[name] ?? name;
    this.#gvrm?.changeFBX(url)
      .catch(e => console.warn(`[CharacterActor:${this.id}] FBX switch failed:`, e));
  }

  connectAudioTap(gainNode, audioContext) {
    try {
      this.#lipsync = new Lipsync();
      const dest = audioContext.createMediaStreamDestination();
      gainNode.connect(dest);
      const src = this.#lipsync.audioContext.createMediaStreamSource(dest.stream);
      src.connect(this.#lipsync.analyser);
      console.log(`[CharacterActor:${this.id}] Lipsync tap connected`);
    } catch (err) {
      console.warn(`[CharacterActor:${this.id}] Lipsync tap failed:`, err);
    }
  }

  /** Called by Stage.tick() each frame. */
  _update() {
    if (!this.#gvrm) return;

    if (this.velocity.lengthSq() > 0) {
      // position integration done by Stage; sync to VRM scene here
    }

    if (this.#lipsync) {
      this.#lipsync.processAudio();
      this._applyViseme(this.#lipsync.viseme ?? 'sil');
    }

    this.#gvrm.update();

    const vrmScene = this.#gvrm.character?.currentVrm?.scene;
    if (vrmScene) vrmScene.visible = this.visible;
  }

  _applyViseme(viseme) {
    const em = this.#gvrm?.character?.currentVrm?.expressionManager;
    if (!em) return;
    for (const name of ALL_MOUTH_EXPRS) {
      try { em.setValue(name, 0); } catch { /* expression absent */ }
    }
    const target = VISEME_TO_VRM[viseme];
    if (target) { try { em.setValue(target, 0.8); } catch { /* absent */ } }
    em.update?.();
  }
}

// ── Stage ──────────────────────────────────────────────────────────────────────
export class Stage {
  #renderer;
  #threeScene;     // THREE.Scene — used by CharacterActor / Three.js render pass
  #avatarCamera;   // PerspectiveCamera — Y-up, for Three.js render pass
  #cloudCamera;    // PerspectiveCamera — Y-down (gaussian convention), for Viewer
  #viewer  = null;
  #clouds  = new Map();     // id → CloudActor
  #chars   = new Map();     // id → CharacterActor
  #rafId   = null;
  #clock   = new THREE.Clock();
  #resizeObs = null;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {number[]} opts.cloudCameraPosition  default [0,1,6]
   * @param {number[]} opts.cloudCameraLookAt    default [0,1,0]
   * @param {number[]} opts.avatarCameraPosition default [0,1.35,2.5]
   * @param {number[]} opts.avatarCameraLookAt   default [0,1.35,0]
   */
  constructor(canvas, opts = {}) {
    const w = canvas.clientWidth  || canvas.width  || 800;
    const h = canvas.clientHeight || canvas.height || 600;
    const aspect = w / h;

    this.#renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.setSize(w, h, false);
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Don't auto-clear — the Viewer.render() clears explicitly; the Three.js
    // pass runs on top without wiping the cloud layer.
    this.#renderer.autoClear = false;

    this.#threeScene = new THREE.Scene();
    this.#threeScene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1, 2, 2);
    this.#threeScene.add(key);

    // Cloud camera — Y-down to match gaussian-splats-3d convention.
    const cp = opts.cloudCameraPosition ?? [0, 1, 6];
    const cl = opts.cloudCameraLookAt   ?? [0, 1, 0];
    this.#cloudCamera = new THREE.PerspectiveCamera(60, aspect, 0.1, 500);
    this.#cloudCamera.up.set(0, -1, 0);
    this.#cloudCamera.position.set(...cp);
    this.#cloudCamera.lookAt(new THREE.Vector3(...cl));

    // Avatar camera — standard Y-up.
    const ap = opts.avatarCameraPosition ?? [0, 1.35, 2.5];
    const al = opts.avatarCameraLookAt   ?? [0, 1.35, 0];
    this.#avatarCamera = new THREE.PerspectiveCamera(30, aspect, 0.1, 20);
    this.#avatarCamera.position.set(...ap);
    this.#avatarCamera.lookAt(new THREE.Vector3(...al));

    this.#resizeObs = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { inlineSize: rw, blockSize: rh } = entry.contentBoxSize[0];
        if (!rw || !rh) continue;
        this.#renderer.setSize(rw, rh, false);
        const a = rw / rh;
        this.#cloudCamera.aspect = a;
        this.#cloudCamera.updateProjectionMatrix();
        this.#avatarCamera.aspect = a;
        this.#avatarCamera.updateProjectionMatrix();
      }
    });
    this.#resizeObs.observe(canvas);
  }

  /**
   * Load a Cloud from a .ksplat/.ply/.splat file and register it as a CloudActor.
   * @param {string} id   — unique actor name
   * @param {string} url  — path to cloud file
   * @param {object} opts — { position, quaternion, scale, opacity, visible,
   *                          splatAlphaRemovalThreshold,
   *                          cloudCameraPosition, cloudCameraLookAt }
   * @returns {Promise<CloudActor>}
   */
  async addCloud(id, url, opts = {}) {
    if (!this.#viewer) {
      const cp = opts.cloudCameraPosition ?? [0, 1, 6];
      const cl = opts.cloudCameraLookAt   ?? [0, 1, 0];
      this.#cloudCamera.position.set(...cp);
      this.#cloudCamera.lookAt(new THREE.Vector3(...cl));

      this.#viewer = new Viewer({
        canvas:      this.#renderer.domElement,
        rootElement: this.#renderer.domElement.parentElement ?? document.body,
        renderer:    this.#renderer,
        threeScene:  this.#threeScene,
        camera:      this.#cloudCamera,
        selfDrivenMode:          false,
        dynamicScene:            true,
        sharedMemoryForWorkers:  false,
      });
    }

    await this.#viewer.addSplatScene(url, {
      splatAlphaRemovalThreshold: opts.splatAlphaRemovalThreshold ?? 5,
    });

    const idx   = this.#viewer.splatMesh.scenes.length - 1;
    const actor = new CloudActor(id, idx, this.#viewer.splatMesh);

    if (opts.position)            actor.position.set(...opts.position);
    if (opts.quaternion)          actor.quaternion.copy(opts.quaternion);
    if (opts.scale)               actor.scale.set(...opts.scale);
    if (opts.opacity  !== undefined) actor.opacity  = opts.opacity;
    if (opts.visible  !== undefined) actor.visible  = opts.visible;

    actor._flush();
    this.#clouds.set(id, actor);
    console.log(`[Stage] Cloud '${id}' loaded (index ${idx}): ${url}`);
    return actor;
  }

  /**
   * Load a .gvrm file and register it as a CharacterActor.
   * @param {string} id
   * @param {string} url
   * @param {object} opts — { initialAnim, avatarCameraPosition, avatarCameraLookAt }
   * @returns {Promise<CharacterActor>}
   */
  async addCharacter(id, url, opts = {}) {
    // Disable pointer-events on any body-level overlay divs the DropInViewer
    // appends (gaussian-splats-3d loading spinner).
    const cleanOverlays = () => {
      document.querySelectorAll('body > div[style*="position: absolute"]').forEach(el => {
        el.style.pointerEvents = 'none';
      });
    };

    const gvrm = await GVRM.load(url, this.#threeScene, this.#avatarCamera, this.#renderer);
    cleanOverlays();

    if (opts.avatarCameraPosition) {
      this.#avatarCamera.position.set(...opts.avatarCameraPosition);
    }
    if (opts.avatarCameraLookAt) {
      this.#avatarCamera.lookAt(new THREE.Vector3(...opts.avatarCameraLookAt));
    }

    const actor = new CharacterActor(id);
    actor._attach(gvrm);
    actor.playAnim(opts.initialAnim ?? 'idle');

    this.#chars.set(id, actor);
    console.log(`[Stage] Character '${id}' loaded: ${url}`);
    return actor;
  }

  /** Return any actor (Cloud or Character) by id. */
  getActor(id) {
    return this.#clouds.get(id) ?? this.#chars.get(id) ?? null;
  }

  /** Start the RAF loop. Safe to call before actors finish loading. */
  start() {
    if (this.#rafId !== null) return;
    this.#clock.start();
    const tick = () => {
      this.#rafId = requestAnimationFrame(tick);
      this.tick(this.#clock.getDelta());
    };
    tick();
  }

  pause() {
    if (this.#rafId === null) return;
    cancelAnimationFrame(this.#rafId);
    this.#rafId = null;
    this.#clock.stop();
    console.log('[Stage] RAF paused');
  }

  resume() {
    if (this.#rafId !== null) return;
    this.start();
    console.log('[Stage] RAF resumed');
  }

  get isRunning() { return this.#rafId !== null; }

  /**
   * Main update — driven by RAF or callable manually.
   * @param {number} dt seconds since last frame
   */
  tick(dt) {
    // 1. Integrate physics for cloud actors.
    for (const actor of this.#clouds.values()) {
      if (actor.velocity.lengthSq() > 0) {
        actor.position.addScaledVector(actor.velocity, dt);
      }
      if (actor.angularVelocity.lengthSq() > 0) {
        const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(
          actor.angularVelocity.x * dt,
          actor.angularVelocity.y * dt,
          actor.angularVelocity.z * dt,
        ));
        actor.quaternion.premultiply(dq);
      }
      actor._flush();
    }

    // 2. Integrate physics for character actors.
    for (const actor of this.#chars.values()) {
      if (actor.velocity.lengthSq() > 0) {
        actor.position.addScaledVector(actor.velocity, dt);
      }
    }

    if (!this.#viewer) {
      // No clouds yet — still render the Three.js scene (character may be loaded).
      this.#renderer.clear();
      this.#renderer.render(this.#threeScene, this.#avatarCamera);
      return;
    }

    // 3. Update cloud sorting (CPU work).
    this.#viewer.update();

    // 4. Update character animation + lipsync.
    for (const actor of this.#chars.values()) {
      actor._update();
    }

    // 5. Render clouds — clears canvas, uses cloudCamera.
    this.#viewer.render();

    // 6. Render Three.js scene on top — autoClear=false preserves cloud layer.
    this.#renderer.render(this.#threeScene, this.#avatarCamera);
  }

  dispose() {
    this.pause();
    this.#resizeObs?.disconnect();
    this.#viewer?.dispose();
    this.#renderer.dispose();
  }
}
