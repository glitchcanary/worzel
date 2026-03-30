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
 * Rebakes splat world positions (bone_world_pos + relative_offset) into PackedSplats,
 * then sets rest poses and assigns each splat to its bone.
 *
 * The splatRelativePoses in data.json are the offsets from each splat to its bone's
 * world position in the original cloud-local space. We convert them to world positions
 * and bake them into the PackedSplats so Spark's dual-quat skinning can compute
 * correct deltas at runtime.
 */
function _buildSkinning(splatMesh, packedSplats, bindingData, skeleton) {
  const { splatBoneIndices, splatRelativePoses } = bindingData;
  const numSplats = splatBoneIndices.length;

  // Ensure all bone world matrices are current in bind pose
  for (const bone of skeleton.bones) {
    bone.updateMatrixWorld(true);
  }

  let maxBoneIndex = 0;
  for (let i = 0; i < splatBoneIndices.length; i++) {
    if (splatBoneIndices[i] > maxBoneIndex) maxBoneIndex = splatBoneIndices[i];
  }
  const numBones = maxBoneIndex + 1;

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

  // --- Rebake splat world positions ---
  // splatRelativePoses[i*3 .. i*3+2] is the offset from the splat to its bone's
  // world position, expressed in the original gsPosition/gsQuaternion cloud space.
  // We need each splat at: bone_world_pos + relative_offset_in_world_space.
  const _bonePos = new THREE.Vector3();
  const _rel     = new THREE.Vector3();
  const _newPos  = new THREE.Vector3();

  for (let i = 0; i < numSplats; i++) {
    const boneIdx = splatBoneIndices[i];
    const bone    = skeleton.bones[boneIdx];
    if (!bone) continue;

    bone.getWorldPosition(_bonePos);

    // splatRelativePoses is the world-space offset from the bone to each splat
    // in the bind pose. No coordinate transform needed — add directly.
    _rel.set(
      splatRelativePoses[i * 3],
      splatRelativePoses[i * 3 + 1],
      splatRelativePoses[i * 3 + 2],
    );

    _newPos.copy(_bonePos).add(_rel);

    // Preserve all other splat attributes (colour, scale, orientation)
    const s = unpackSplat(packedSplats.packedArray, i, packedSplats.splatEncoding);
    setPackedSplat(
      packedSplats.packedArray, i,
      _newPos.x, _newPos.y, _newPos.z,
      s.scales.x, s.scales.y, s.scales.z,
      s.quaternion.x, s.quaternion.y, s.quaternion.z, s.quaternion.w,
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
  return skinning;
}

// ── Mixamo → VRM bone name map (ported from naruya/gaussian-vrm, MIT) ─────────
const MIXAMO_TO_VRM = {
  mixamorigHips:'hips', mixamorigSpine:'spine', mixamorigSpine1:'chest',
  mixamorigSpine2:'upperChest', mixamorigNeck:'neck', mixamorigHead:'head',
  mixamorigLeftShoulder:'leftShoulder', mixamorigLeftArm:'leftUpperArm',
  mixamorigLeftForeArm:'leftLowerArm', mixamorigLeftHand:'leftHand',
  mixamorigLeftHandThumb1:'leftThumbMetacarpal', mixamorigLeftHandThumb2:'leftThumbProximal',
  mixamorigLeftHandThumb3:'leftThumbDistal', mixamorigLeftHandIndex1:'leftIndexProximal',
  mixamorigLeftHandIndex2:'leftIndexIntermediate', mixamorigLeftHandIndex3:'leftIndexDistal',
  mixamorigLeftHandMiddle1:'leftMiddleProximal', mixamorigLeftHandMiddle2:'leftMiddleIntermediate',
  mixamorigLeftHandMiddle3:'leftMiddleDistal', mixamorigLeftHandRing1:'leftRingProximal',
  mixamorigLeftHandRing2:'leftRingIntermediate', mixamorigLeftHandRing3:'leftRingDistal',
  mixamorigLeftHandPinky1:'leftLittleProximal', mixamorigLeftHandPinky2:'leftLittleIntermediate',
  mixamorigLeftHandPinky3:'leftLittleDistal', mixamorigRightShoulder:'rightShoulder',
  mixamorigRightArm:'rightUpperArm', mixamorigRightForeArm:'rightLowerArm',
  mixamorigRightHand:'rightHand', mixamorigRightHandPinky1:'rightLittleProximal',
  mixamorigRightHandPinky2:'rightLittleIntermediate', mixamorigRightHandPinky3:'rightLittleDistal',
  mixamorigRightHandRing1:'rightRingProximal', mixamorigRightHandRing2:'rightRingIntermediate',
  mixamorigRightHandRing3:'rightRingDistal', mixamorigRightHandMiddle1:'rightMiddleProximal',
  mixamorigRightHandMiddle2:'rightMiddleIntermediate', mixamorigRightHandMiddle3:'rightMiddleDistal',
  mixamorigRightHandIndex1:'rightIndexProximal', mixamorigRightHandIndex2:'rightIndexIntermediate',
  mixamorigRightHandIndex3:'rightIndexDistal', mixamorigRightHandThumb1:'rightThumbMetacarpal',
  mixamorigRightHandThumb2:'rightThumbProximal', mixamorigRightHandThumb3:'rightThumbDistal',
  mixamorigLeftUpLeg:'leftUpperLeg', mixamorigLeftLeg:'leftLowerLeg',
  mixamorigLeftFoot:'leftFoot', mixamorigLeftToeBase:'leftToes',
  mixamorigRightUpLeg:'rightUpperLeg', mixamorigRightLeg:'rightLowerLeg',
  mixamorigRightFoot:'rightFoot', mixamorigRightToeBase:'rightToes',
};

/**
 * Retarget a Mixamo FBX animation to a VRM skeleton.
 * Ported from naruya/gaussian-vrm (MIT licence).
 */
function _retargetFbxToVrm(fbx, vrm) {
  const clip = THREE.AnimationClip.findByName(fbx.animations, 'mixamo.com')
    ?? fbx.animations[0];
  if (!clip) return null;

  const hipNode  = fbx.getObjectByName('mixamorigHips');
  const hipHeight = hipNode ? hipNode.position.y : 1;
  const vrmMeta  = vrm.meta;
  const isVrm0   = !(vrmMeta?.metaVersion === '1' || vrmMeta?.specVersion?.startsWith('1'));

  // Compute height scale so Hips translation matches avatar size
  let hipPos0Y = 0;
  vrm.scene.traverse(obj => {
    if (obj.name && obj.name.toLowerCase().includes('hips')) hipPos0Y = obj.position.y;
  });
  const hipsNode = vrm.humanoid?.getNormalizedBoneNode('hips');
  if (hipsNode) hipsNode.getWorldPosition({ set(x,y,z){ hipPos0Y = y; } });
  const scale = Math.abs(hipPos0Y) * (vrm.scene.scale.y || 1) / hipHeight;

  const tracks = [];
  const _restQ = new THREE.Quaternion();
  const _parentQ = new THREE.Quaternion();
  const _animQ  = new THREE.Quaternion();

  for (const track of clip.tracks) {
    const parts    = track.name.split('.');
    const boneName = parts[0];
    const prop     = parts[1];
    const vrmBoneId = MIXAMO_TO_VRM[boneName];
    if (!vrmBoneId) continue;

    const vrmBoneName = vrm.humanoid?.getNormalizedBoneNode(vrmBoneId)?.name;
    if (!vrmBoneName) continue;

    const srcBone = fbx.getObjectByName(boneName);
    if (!srcBone) continue;

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      srcBone.getWorldQuaternion(_restQ).invert();
      srcBone.parent?.getWorldQuaternion(_parentQ);

      const vals = track.values.slice();
      for (let h = 0; h < vals.length; h += 4) {
        _animQ.fromArray(vals, h);
        _animQ.premultiply(_parentQ).multiply(_restQ);
        // VRM0 needs X and Z negated
        if (isVrm0) {
          _animQ.x = -_animQ.x;
          _animQ.z = -_animQ.z;
        }
        _animQ.toArray(vals, h);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${vrmBoneName}.${prop}`, track.times, vals));
    } else if (track instanceof THREE.VectorKeyframeTrack) {
      const vals = track.values.map((v, idx) =>
        (isVrm0 && idx % 3 !== 1 ? -v : v) * scale
      );
      tracks.push(new THREE.VectorKeyframeTrack(`${vrmBoneName}.${prop}`, track.times, vals));
    }
  }

  return new THREE.AnimationClip('vrmAnimation', clip.duration, tracks);
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
    if (!this._vrm) { console.warn(`[CharacterActor:${this.id}] playAnim before VRM ready`); return; }
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
      const clip = _retargetFbxToVrm(fbx, this._vrm);
      if (!clip) {
        console.warn(`[CharacterActor:${this.id}] Retargeting failed for ${url}`);
        return;
      }
      if (!this._mixer) {
        this._mixer = new THREE.AnimationMixer(this._vrm.scene);
      } else {
        this._mixer.stopAllAction();
      }
      this._mixer.clipAction(clip).play();
      console.log(`[CharacterActor:${this.id}] Playing anim: ${name}`);
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
