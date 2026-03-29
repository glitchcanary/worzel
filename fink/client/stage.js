/**
 * stage.js — Stage compositor.
 *
 * Vocabulary:
 *   Gaussian      — one 3D Gaussian particle
 *   Cloud         — a named collection of Gaussians loaded from a file (.ksplat/.ply/.spz)
 *   CloudActor    — a Cloud placed on the Stage with position/quaternion/velocity
 *   CharacterActor— Gaussians bound to a VRM skeleton (gaussian-vrm)
 *   Stage         — one WebGL context, one RAF loop, all actors rendered together
 *
 * Renderer: Spark (@sparkjsdev/spark) — GPU-accelerated splat sorting, THREE.js integration.
 * SparkRenderer is added to the scene once; SplatMesh objects are regular THREE.js objects.
 * gaussian-vrm handles skeleton/FBX animation/lipsync on top.
 *
 * Usage:
 *   const stage = new Stage(canvas);
 *   const env   = await stage.addCloud('env', './splats/soar.ksplat');
 *   const char  = await stage.addCharacter('avatar', './avatars/sample9.gvrm');
 *   stage.start();
 */

import * as THREE from './vendor/three.module.js';
import { SparkRenderer, SplatLoader, SplatMesh, SparkControls } from './vendor/spark.module.js';
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
  constructor(id, splatMesh) {
    this.id         = id;
    this._splatMesh = splatMesh;  // THREE.js Object3D (SplatMesh), already in scene

    // Public transform — write these; _flush() syncs to the SplatMesh.
    this.position        = new THREE.Vector3();
    this.quaternion      = new THREE.Quaternion();
    this.scale           = new THREE.Vector3(1, 1, 1);

    // Physics — integrated by Stage.tick() each frame.
    this.velocity        = new THREE.Vector3();   // world-units / sec
    this.angularVelocity = new THREE.Vector3();   // euler rates rad/sec (XYZ)

    this.opacity = 1.0;
    this.visible = true;
  }

  /** Sync public state into the underlying SplatMesh. Called by Stage.tick(). */
  _flush() {
    this._splatMesh.position.copy(this.position);
    this._splatMesh.quaternion.copy(this.quaternion);
    this._splatMesh.scale.copy(this.scale);
    this._splatMesh.visible = this.visible;
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
  #scene;          // Single THREE.Scene — splats + VRM meshes coexist via Spark
  #camera;         // Single PerspectiveCamera — Y-up standard
  #sparkRenderer = null;  // SparkRenderer THREE.js object added to scene
  #controls   = null;    // SparkControls for orbit/fly navigation
  #clouds     = new Map();   // id → CloudActor
  #chars      = new Map();   // id → CharacterActor
  #rafId      = null;
  #clock      = new THREE.Clock();
  #resizeObs  = null;
  #avatarRect = null;  // { x, y, width, height } in CSS pixels — set by boot script
  #maxFps     = 24;    // cap render rate; 0 = uncapped
  #lastFrameT = 0;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {number[]} opts.cameraPosition  default [0,1,6]
   * @param {number[]} opts.cameraLookAt    default [0,1,0]
   * @param {number}   opts.maxFps          default 24 (0 = uncapped)
   */
  constructor(canvas, opts = {}) {
    this.#maxFps = opts.maxFps ?? 24;
    const w = canvas.clientWidth  || canvas.width  || 800;
    const h = canvas.clientHeight || canvas.height || 600;
    const aspect = w / h;

    this.#renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.setSize(w, h, false);
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.#scene = new THREE.Scene();
    this.#scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1, 2, 2);
    this.#scene.add(key);

    // Single Y-up camera for everything — Spark handles splat depth correctly.
    const cp = opts.cameraPosition ?? opts.cloudCameraPosition ?? [0, 1, 6];
    const cl = opts.cameraLookAt   ?? opts.cloudCameraLookAt   ?? [0, 1, 0];
    this.#camera = new THREE.PerspectiveCamera(65, aspect, 0.01, 500);
    this.#camera.position.set(...cp);
    this.#camera.lookAt(new THREE.Vector3(...cl));

    this.#resizeObs = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { inlineSize: rw, blockSize: rh } = entry.contentBoxSize[0];
        if (!rw || !rh) continue;
        this.#renderer.setSize(rw, rh, false);
        this.#camera.aspect = rw / rh;
        this.#camera.updateProjectionMatrix();
      }
    });
    this.#resizeObs.observe(canvas);

    // Orbit/fly controls — pointer drag to look, WASD to move.
    this.#controls = new SparkControls({ canvas });
  }

  /**
   * Load a Cloud from a .ksplat/.ply/.splat/.spz file and register it as a CloudActor.
   * @param {string} id   — unique actor name
   * @param {string} url  — path to cloud file
   * @param {object} opts — { position, quaternion, scale, opacity, visible,
   *                          cameraPosition, cameraLookAt }
   * @returns {Promise<CloudActor>}
   */
  async addCloud(id, url, opts = {}) {
    // Initialise SparkRenderer on first cloud load.
    if (!this.#sparkRenderer) {
      this.#sparkRenderer = new SparkRenderer({ renderer: this.#renderer });
      this.#scene.add(this.#sparkRenderer);
    }

    if (opts.cameraPosition ?? opts.cloudCameraPosition) {
      const cp = opts.cameraPosition ?? opts.cloudCameraPosition;
      this.#camera.position.set(...cp);
    }
    if (opts.cameraLookAt ?? opts.cloudCameraLookAt) {
      const cl = opts.cameraLookAt ?? opts.cloudCameraLookAt;
      this.#camera.lookAt(new THREE.Vector3(...cl));
    }

    const packedSplats = await new SplatLoader().loadAsync(url);
    const splatMesh = new SplatMesh({ packedSplats });
    this.#scene.add(splatMesh);

    const actor = new CloudActor(id, splatMesh);

    if (opts.position)               actor.position.set(...opts.position);
    if (opts.quaternion)             actor.quaternion.copy(opts.quaternion);
    if (opts.scale)                  actor.scale.set(...opts.scale);
    if (opts.visible !== undefined)  actor.visible = opts.visible;

    actor._flush();
    this.#clouds.set(id, actor);
    console.log(`[Stage] Cloud '${id}' loaded: ${url}`);
    return actor;
  }

  /**
   * Load a .gvrm file and register it as a CharacterActor.
   * @param {string} id
   * @param {string} url
   * @param {object} opts — { initialAnim, cameraPosition, cameraLookAt }
   * @returns {Promise<CharacterActor>}
   */
  async addCharacter(id, url, opts = {}) {
    const gvrm = await GVRM.load(url, this.#scene, this.#camera, this.#renderer);

    // gaussian-vrm appends overlay divs to body — disable their pointer-events.
    document.querySelectorAll('body > div[style*="position: absolute"]').forEach(el => {
      el.style.pointerEvents = 'none';
    });

    if (opts.cameraPosition ?? opts.avatarCameraPosition) {
      const cp = opts.cameraPosition ?? opts.avatarCameraPosition;
      this.#camera.position.set(...cp);
    }
    if (opts.cameraLookAt ?? opts.avatarCameraLookAt) {
      const cl = opts.cameraLookAt ?? opts.avatarCameraLookAt;
      this.#camera.lookAt(new THREE.Vector3(...cl));
    }

    const actor = new CharacterActor(id);
    actor._attach(gvrm);
    actor.playAnim(opts.initialAnim ?? 'idle');

    this.#chars.set(id, actor);
    console.log(`[Stage] Character '${id}' loaded: ${url}`);
    return actor;
  }

  /**
   * Replace an existing CharacterActor with a new .gvrm file.
   * Removes the old VRM scene from threeScene, loads the new one.
   */
  async swapCharacter(id, url, opts = {}) {
    const old = this.#chars.get(id);
    if (old?._gvrmScene) this.#scene.remove(old._gvrmScene);
    this.#chars.delete(id);
    return this.addCharacter(id, url, opts);
  }

  /** Return any actor (Cloud or Character) by id. */
  getActor(id) {
    return this.#clouds.get(id) ?? this.#chars.get(id) ?? null;
  }

  /** Set FPS cap. 0 = uncapped. Takes effect immediately. */
  setMaxFps(fps) { this.#maxFps = fps; }

  /** Start the RAF loop. Safe to call before actors finish loading. */
  start() {
    if (this.#rafId !== null) return;
    this.#clock.start();
    const tick = (now) => {
      this.#rafId = requestAnimationFrame(tick);
      if (this.#maxFps > 0) {
        const minInterval = 1000 / this.#maxFps;
        if (now - this.#lastFrameT < minInterval) return;
        this.#lastFrameT = now;
      }
      this.tick(this.#clock.getDelta());
    };
    requestAnimationFrame(tick);
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

  /** For debug panel: returns live camera reference. */
  getCameras() {
    return { avatar: this.#camera, cloud: this.#camera };
  }

  /**
   * For debug panel: set camera position + lookAt.
   * @param {'avatar'|'cloud'} which  (both refer to same camera now)
   * @param {{ position: number[], lookAt: number[] }} state
   */
  setCameraState(_which, { position, lookAt }) {
    this.#camera.position.set(...position);
    this.#camera.lookAt(new THREE.Vector3(...lookAt));
    this.#camera.updateProjectionMatrix();
  }

  /**
   * Tell the Stage where to scissor the character (avatar) render.
   * rect: { x, y, width, height } in CSS pixels from getBoundingClientRect().
   * Pass null to render full-screen.
   * NOTE: with Spark, all actors share one scene+camera. This rect currently unused.
   */
  setAvatarRect(rect) { this.#avatarRect = rect; }

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

    // 3. Update controls (orbit/fly navigation).
    this.#controls.update(this.#camera);

    // 4. Update character animation + lipsync.
    for (const actor of this.#chars.values()) {
      actor._update();
    }

    // 5. Render everything — Spark handles splat sorting + depth composite internally.
    this.#renderer.render(this.#scene, this.#camera);
  }

  dispose() {
    this.pause();
    this.#resizeObs?.disconnect();
    this.#renderer.dispose();
  }
}
