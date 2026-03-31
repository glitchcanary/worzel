/**
 * stage.js — Stage compositor.
 *
 * Vocabulary:
 *   Gaussian       — one 3D Gaussian particle
 *   Cloud          — a named collection of Gaussians loaded from a file (.ksplat/.ply/.spz)
 *   CloudActor     — a Cloud placed on the Stage with position/quaternion/velocity
 *   CharacterActor — Gaussians bound to a VRM skeleton via Spark SplatSkinning
 *   Stage          — one WebGL context, one RAF loop, all actors rendered together
 *
 * Renderer: Spark (@sparkjsdev/spark) — GPU-accelerated splat sorting, THREE.js integration.
 * One SparkRenderer handles ALL splats (background clouds AND rigged characters).
 * VRM skeleton drives Spark's built-in SplatSkinning (dual-quaternion, GPU-side).
 *
 * .gvrm files are unpacked directly here (no gaussian-vrm.min.js dependency):
 *   model.vrm  → loaded by three-vrm, skeleton drives SplatSkinning
 *   model.ply  → loaded by Spark SplatLoader into SplatMesh
 *   data.json  → splatBoneIndices + splatRelativePoses → SplatSkinning.setSplatBones()
 *
 * Usage:
 *   const stage = new Stage(canvas);
 *   const env   = await stage.addCloud('env', './splats/soar.ksplat');
 *   const char  = await stage.addCharacter('avatar', './avatars/sample9.gvrm');
 *   stage.start();
 */

import * as THREE from './vendor/three.module.js';
import { SparkRenderer, SplatLoader, SplatMesh, SplatSkinning, PackedSplats,
         SparkControls, unpackSplat, setPackedSplat } from './vendor/spark.module.js';
import { GLTFLoader }                from './vendor/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from './vendor/three-vrm.module.js';
import { FBXLoader }                 from './vendor/FBXLoader.js';
import JSZip                         from './vendor/jszip.module.js';
import { Lipsync }                   from './vendor/wawa-lipsync.js';

// ── Viseme → VRM expression map ───────────────────────────────────────────────
const VISEME_TO_VRM = {
  viseme_aa: 'aa', viseme_E: 'ee', viseme_I: 'ih', viseme_O: 'oh', viseme_U: 'ou',
  viseme_PP: 'aa', viseme_FF: 'ih', viseme_TH: 'ih', viseme_DD: 'aa',
  viseme_kk: 'aa', viseme_CH: 'ih', viseme_SS: 'ih', viseme_nn: 'ih',
  viseme_RR: 'oh', viseme_sil: null, sil: null,
};
const ALL_MOUTH_EXPRS = ['aa', 'ee', 'ih', 'oh', 'ou'];

// ── .gvrm unpacker ────────────────────────────────────────────────────────────
/**
 * Unpack a .gvrm ZIP and return { vrm, plyBuffer, bindingData }.
 *
 * vrm         — loaded @pixiv/three-vrm VRM object, already added to scene
 * plyBuffer   — ArrayBuffer of the raw PLY file
 * bindingData — parsed data.json
 */
async function _loadGvrm(url, scene) {
  const resp   = await fetch(url);
  const zipBuf = await resp.arrayBuffer();
  const zip    = await JSZip.loadAsync(zipBuf);

  // 1. Parse data.json
  const dataJson   = await zip.file('data.json').async('string');
  const bindingData = JSON.parse(dataJson);
  // Support legacy field name
  if (!bindingData.splatRelativePoses && bindingData.relativePoses) {
    bindingData.splatRelativePoses = bindingData.relativePoses;
  }

  // 2. Load VRM
  const vrmBuf  = await zip.file('model.vrm').async('arraybuffer');
  const vrmBlob = new Blob([vrmBuf], { type: 'model/gltf-binary' });
  const vrmUrl  = URL.createObjectURL(vrmBlob);

  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  const gltf = await new Promise((resolve, reject) =>
    loader.load(vrmUrl, resolve, undefined, reject)
  );
  URL.revokeObjectURL(vrmUrl);

  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);

  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('[_loadGvrm] No VRM data in model.vrm');

  // Detect VRM version (0 needs rotation fix)
  const meta = vrm.meta;
  const isVrm0 = !(meta?.metaVersion === '1' || meta?.specVersion?.startsWith('1'));
  if (isVrm0) VRMUtils.rotateVRM0(vrm);

  // Apply model scale
  const scale = bindingData.modelScale ?? 1;
  vrm.scene.scale.setScalar(scale);

  // Apply rest-pose bone adjustments from data.json
  if (Array.isArray(bindingData.boneOperations)) {
    for (const op of bindingData.boneOperations) {
      const rawBone  = vrm.humanoid?.getRawBoneNode(op.boneName);
      const normBone = vrm.humanoid?.getNormalizedBoneNode(op.boneName);
      if (rawBone && op.position) {
        rawBone.position.x += op.position.x ?? 0;
        rawBone.position.y += op.position.y ?? 0;
        rawBone.position.z += op.position.z ?? 0;
      }
      if (normBone && op.rotation) {
        normBone.rotation.x = (op.rotation.x ?? 0) * Math.PI / 180;
        normBone.rotation.y = (op.rotation.y ?? 0) * Math.PI / 180;
        normBone.rotation.z = (op.rotation.z ?? 0) * Math.PI / 180;
      }
    }
  }

  // Add VRM mesh to scene (hidden — splat cloud is the visual)
  vrm.scene.visible = false;
  scene.add(vrm.scene);

  // 3. Get PLY bytes
  const plyBuffer = await zip.file('model.ply').async('arraybuffer');

  console.log(`[_loadGvrm] ${url} — splats: ${bindingData.splatBoneIndices?.length ?? '?'}` +
    `, bones used: ${new Set(bindingData.splatBoneIndices).size}` +
    `, scale: ${scale}`);

  return { vrm, plyBuffer, bindingData };
}

// ── SplatSkinning builder ─────────────────────────────────────────────────────
/**
 * Build a SplatSkinning from .gvrm binding data + VRM skeleton.
 * Pre-transforms PLY positions from cloud-local space (gsPosition/gsQuaternion)
 * to world space so they align with the VRM skeleton. Sets bone rest poses and
 * assigns each splat to its single bone. splatRelativePoses are NOT used here
 * (they're for alpha culling in the original GVRM system, not positioning).
 */
function _buildSkinning(splatMesh, packedSplats, bindingData, skeleton) {
  const { splatBoneIndices } = bindingData;
  const numSplats = splatBoneIndices.length;

  // Ensure all bone world matrices are current in bind pose
  for (const bone of skeleton.bones) {
    bone.updateMatrixWorld(true);
  }

  let maxBoneIndex = 0;
  for (let i = 0; i < splatBoneIndices.length; i++) {
    if (splatBoneIndices[i] > maxBoneIndex) maxBoneIndex = splatBoneIndices[i];
  }
  const numBones     = maxBoneIndex + 1;

  const skinning = new SplatSkinning({ mesh: splatMesh, numSplats, numBones });

  // --- Set rest pose for every bone we'll use ---
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();

  for (let b = 0; b < numBones; b++) {
    const bone = skeleton.bones[b];
    if (!bone) continue;
    bone.getWorldQuaternion(_q);
    bone.getWorldPosition(_p);
    skinning.setRestQuatPos(b, _q, _p);
  }

  // --- Transform splat positions from cloud-local to world space ---
  // The PLY positions are in cloud-local space defined by gsPosition/gsQuaternion.
  // splatRelativePoses are NOT used for positioning (they're for alpha culling).
  // We pre-transform each splat by the cloud's gsPosition/gsQuaternion so the
  // positions align with the VRM skeleton world space. SplatSkinning then computes
  // delta transforms per bone correctly.
  const gsPos = bindingData.gsPosition
    ? new THREE.Vector3(...bindingData.gsPosition)
    : new THREE.Vector3();
  const gsQuat = bindingData.gsQuaternion
    ? new THREE.Quaternion(...bindingData.gsQuaternion)
    : new THREE.Quaternion();

  const _newPos = new THREE.Vector3();
  const _newQuat = new THREE.Quaternion();

  for (let i = 0; i < numSplats; i++) {
    const s = unpackSplat(packedSplats.packedArray, i, packedSplats.splatEncoding);

    // Transform position: world = gsPos + gsQuat.apply(plyPos)
    _newPos.copy(s.center).applyQuaternion(gsQuat).add(gsPos);

    // Rotate splat orientation by gsQuat
    _newQuat.copy(gsQuat).multiply(s.quaternion);

    setPackedSplat(
      packedSplats.packedArray, i,
      _newPos.x, _newPos.y, _newPos.z,
      s.scales.x, s.scales.y, s.scales.z,
      _newQuat.x, _newQuat.y, _newQuat.z, _newQuat.w,
      s.opacity, s.color.r, s.color.g, s.color.b,
      packedSplats.splatEncoding,
    );
  }
  packedSplats.needsUpdate = true;

  // --- Assign each splat to its single bone (weight 1.0) ---
  const _boneIdx = new THREE.Vector4();
  const _weights = new THREE.Vector4(1, 0, 0, 0);
  for (let i = 0; i < numSplats; i++) {
    _boneIdx.set(splatBoneIndices[i], 0, 0, 0);
    skinning.setSplatBones(i, _boneIdx, _weights);
  }
  skinning.skinTexture.needsUpdate = true;

  splatMesh.skinning = skinning;
  splatMesh.updateGenerator();  // rebuild GPU pipeline to include skinning modifier
  return skinning;
}

// ── CloudActor ─────────────────────────────────────────────────────────────────
export class CloudActor {
  constructor(id, splatMesh) {
    this.id         = id;
    this._splatMesh = splatMesh;

    this.position        = new THREE.Vector3();
    this.quaternion      = new THREE.Quaternion();
    this.scale           = new THREE.Vector3(1, 1, 1);
    this.velocity        = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();
    this.opacity         = 1.0;
    this.visible         = true;
  }

  _flush() {
    this._splatMesh.position.copy(this.position);
    this._splatMesh.quaternion.copy(this.quaternion);
    this._splatMesh.scale.copy(this.scale);
    this._splatMesh.visible = this.visible;
  }
}

// ── CharacterActor ─────────────────────────────────────────────────────────────
export class CharacterActor {
  constructor(id) {
    this.id         = id;
    this.position   = new THREE.Vector3();
    this.velocity   = new THREE.Vector3();
    this.visible    = true;

    // Set by _attachSplats after load
    this._vrm        = null;
    this._splatMesh  = null;
    this._packedSplats = null;
    this._skinning   = null;
    this._skeleton   = null;
    this._mixer      = null;
    this._lipsync    = null;

    this._animMap = {
      idle:      './animations/Breathing.fbx',
      listening: './animations/Listening.fbx',
      happy:     './animations/Happy Idle.fbx',
      pointing:  './animations/Pointing.fbx',
    };
  }

  _attachSplats(splatMesh, packedSplats, vrm, skeleton, skinning) {
    this._splatMesh   = splatMesh;
    this._packedSplats = packedSplats;
    this._vrm         = vrm;
    this._skeleton    = skeleton;
    this._skinning    = skinning;
  }

  async playAnim(name) {
    const url = this._animMap[name] ?? name;
    try {
      const fbxLoader = new FBXLoader();
      const fbx = await new Promise((resolve, reject) =>
        fbxLoader.load(url, resolve, undefined, reject)
      );
      if (!fbx.animations?.length) {
        console.warn(`[CharacterActor:${this.id}] No animations in ${url}`);
        return;
      }
      if (!this._mixer) {
        this._mixer = new THREE.AnimationMixer(this._vrm.scene);
      } else {
        this._mixer.stopAllAction();
      }
      const clip   = fbx.animations[0];
      const action = this._mixer.clipAction(clip);
      action.play();
    } catch (err) {
      console.warn(`[CharacterActor:${this.id}] FBX load failed: ${url}`, err);
    }
  }

  connectAudioTap(gainNode, audioContext) {
    try {
      this._lipsync = new Lipsync();
      const dest = audioContext.createMediaStreamDestination();
      gainNode.connect(dest);
      const src = this._lipsync.audioContext.createMediaStreamSource(dest.stream);
      src.connect(this._lipsync.analyser);
      console.log(`[CharacterActor:${this.id}] Lipsync tap connected`);
    } catch (err) {
      console.warn(`[CharacterActor:${this.id}] Lipsync tap failed:`, err);
    }
  }

  /** Called by Stage.tick() each frame with delta seconds. */
  _update(dt) {
    if (!this._vrm) return;

    // Advance FBX animation mixer
    if (this._mixer) this._mixer.update(dt);

    // Advance VRM spring bones, expression update
    this._vrm.update(dt);

    // Lipsync
    if (this._lipsync) {
      this._lipsync.processAudio();
      this._applyViseme(this._lipsync.viseme ?? 'sil');
    }

    // Push current bone world transforms to Spark GPU skinning
    this._updateBones();

    // Visibility
    if (this._splatMesh) this._splatMesh.visible = this.visible;
  }

  _applyViseme(viseme) {
    const em = this._vrm?.expressionManager;
    if (!em) return;
    for (const name of ALL_MOUTH_EXPRS) {
      try { em.setValue(name, 0); } catch { /* expression absent */ }
    }
    const target = VISEME_TO_VRM[viseme];
    if (target) { try { em.setValue(target, 0.8); } catch { /* absent */ } }
    em.update?.();
  }

  _updateBones() {
    if (!this._skinning || !this._skeleton) return;
    const { _skinning: skinning, _skeleton: skeleton } = this;
    const _q = new THREE.Quaternion();
    const _p = new THREE.Vector3();
    for (let b = 0; b < skeleton.bones.length; b++) {
      const bone = skeleton.bones[b];
      if (!bone) continue;
      bone.getWorldQuaternion(_q);
      bone.getWorldPosition(_p);
      skinning.setBoneQuatPos(b, _q, _p);
    }
    skinning.updateBones();
  }
}

// ── Stage ──────────────────────────────────────────────────────────────────────
export class Stage {
  #renderer;
  #scene;
  #camera;
  #sparkRenderer = null;
  #controls      = null;
  #clouds        = new Map();
  #chars         = new Map();
  #rafId         = null;
  #clock         = new THREE.Clock();
  #resizeObs     = null;
  #avatarRect    = null;
  #maxFps        = 24;
  #lastFrameT    = 0;

  constructor(canvas, opts = {}) {
    this.#maxFps = opts.maxFps ?? 24;
    const w      = canvas.clientWidth  || canvas.width  || 800;
    const h      = canvas.clientHeight || canvas.height || 600;

    this.#renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.setSize(w, h, false);
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.#scene = new THREE.Scene();
    this.#scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1, 2, 2);
    this.#scene.add(key);

    const cp = opts.cameraPosition ?? opts.cloudCameraPosition ?? [0, 1, 6];
    const cl = opts.cameraLookAt   ?? opts.cloudCameraLookAt   ?? [0, 1, 0];
    this.#camera = new THREE.PerspectiveCamera(65, w / h, 0.01, 500);
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

    this.#controls = new SparkControls({ canvas });
  }

  async addCloud(id, url, opts = {}) {
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
    const splatMesh    = new SplatMesh({ packedSplats });
    this.#scene.add(splatMesh);

    const actor = new CloudActor(id, splatMesh);
    if (opts.position)              actor.position.set(...opts.position);
    if (opts.quaternion)            actor.quaternion.copy(opts.quaternion);
    if (opts.scale)                 actor.scale.set(...opts.scale);
    if (opts.visible !== undefined) actor.visible = opts.visible;
    actor._flush();

    this.#clouds.set(id, actor);
    console.log(`[Stage] Cloud '${id}' loaded: ${url}`);
    return actor;
  }

  async addCharacter(id, url, opts = {}) {
    // Ensure SparkRenderer exists (needed for SplatMesh rendering)
    if (!this.#sparkRenderer) {
      this.#sparkRenderer = new SparkRenderer({ renderer: this.#renderer });
      this.#scene.add(this.#sparkRenderer);
    }

    // 1. Unpack .gvrm
    const { vrm, plyBuffer, bindingData } = await _loadGvrm(url, this.#scene);

    if (opts.cameraPosition ?? opts.avatarCameraPosition) {
      const cp = opts.cameraPosition ?? opts.avatarCameraPosition;
      this.#camera.position.set(...cp);
    }
    if (opts.cameraLookAt ?? opts.avatarCameraLookAt) {
      const cl = opts.cameraLookAt ?? opts.avatarCameraLookAt;
      this.#camera.lookAt(new THREE.Vector3(...cl));
    }

    // 2. Load PLY into Spark SplatMesh
    const plyBlob      = new Blob([plyBuffer], { type: 'application/octet-stream' });
    const plyUrl       = URL.createObjectURL(plyBlob);
    const packedSplats = await new SplatLoader().loadAsync(plyUrl);
    URL.revokeObjectURL(plyUrl);
    console.log(`[Stage] PLY loaded — numSplats: ${packedSplats.numSplats}`);

    const splatMesh = new SplatMesh({ packedSplats });
    this.#scene.add(splatMesh);

    // 3. Find VRM skeleton
    let skeleton = null;
    vrm.scene.traverse(obj => {
      if (!skeleton && obj.isSkinnedMesh) skeleton = obj.skeleton;
    });
    if (!skeleton) throw new Error(`[Stage] No skeleton found in VRM: ${url}`);

    // 4. Build SplatSkinning (rebakes positions + assigns bones)
    const skinning = _buildSkinning(splatMesh, packedSplats, bindingData, skeleton);
    console.log(`[Stage] SplatSkinning built — numBones: ${skinning.numBones}`);

    // 5. Create and wire CharacterActor
    const actor = new CharacterActor(id);
    actor._attachSplats(splatMesh, packedSplats, vrm, skeleton, skinning);
    actor.playAnim(opts.initialAnim ?? 'idle');

    this.#chars.set(id, actor);
    console.log(`[Stage] Character '${id}' loaded: ${url}`);
    return actor;
  }

  async swapCharacter(id, url, opts = {}) {
    const old = this.#chars.get(id);
    if (old) {
      if (old._vrm?.scene)  this.#scene.remove(old._vrm.scene);
      if (old._splatMesh)   this.#scene.remove(old._splatMesh);
    }
    this.#chars.delete(id);
    return this.addCharacter(id, url, opts);
  }

  getActor(id) {
    return this.#clouds.get(id) ?? this.#chars.get(id) ?? null;
  }

  setMaxFps(fps) { this.#maxFps = fps; }

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

  getCameras() {
    return { avatar: this.#camera, cloud: this.#camera };
  }

  setCameraState(_which, { position, lookAt }) {
    this.#camera.position.set(...position);
    this.#camera.lookAt(new THREE.Vector3(...lookAt));
    this.#camera.updateProjectionMatrix();
  }

  setAvatarRect(rect) { this.#avatarRect = rect; }

  tick(dt) {
    // 1. Integrate physics for cloud actors
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

    // 2. Integrate physics for character actors
    for (const actor of this.#chars.values()) {
      if (actor.velocity.lengthSq() > 0) {
        actor.position.addScaledVector(actor.velocity, dt);
      }
    }

    // 3. Update orbit/fly controls
    this.#controls.update(this.#camera);

    // 4. Update character animation + lipsync + bone → GPU
    for (const actor of this.#chars.values()) {
      actor._update(dt);
    }

    // 5. Render — Spark handles splat sorting + depth composite
    this.#renderer.render(this.#scene, this.#camera);
  }

  dispose() {
    this.pause();
    this.#resizeObs?.disconnect();
    this.#renderer.dispose();
  }
}
