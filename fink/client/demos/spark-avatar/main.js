/**
 * Minimal standalone test for the Spark SplatSkinning port.
 * Uses vendor files from ../../vendor/ (no build step).
 * No fink, no supabase, no server config needed.
 *
 * Controls: drag to orbit, scroll to zoom.
 */

import * as THREE from '../../vendor/three.module.js';
import { SparkRenderer, SplatLoader, SplatMesh, SplatSkinning,
         unpackSplat, setPackedSplat } from '../../vendor/spark.module.js';
import { GLTFLoader }                  from '../../vendor/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils }   from '../../vendor/three-vrm.module.js';
import { FBXLoader }                   from '../../vendor/FBXLoader.js';
import JSZip                           from '../../vendor/jszip.module.js';

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

function retargetFbxToVrm(fbx, vrm) {
  const clip = THREE.AnimationClip.findByName(fbx.animations, 'mixamo.com') ?? fbx.animations[0];
  if (!clip) return null;

  const hipNode   = fbx.getObjectByName('mixamorigHips');
  const hipHeight = hipNode ? hipNode.position.y : 1;
  const isVrm0    = !(vrm.meta?.metaVersion === '1' || vrm.meta?.specVersion?.startsWith('1'));

  const hipsNode = vrm.humanoid?.getNormalizedBoneNode('hips');
  let hipPos0Y = 1;
  if (hipsNode) hipsNode.getWorldPosition(new THREE.Vector3()).y && (hipPos0Y = hipsNode.getWorldPosition(new THREE.Vector3()).y);
  const scale = Math.abs(hipPos0Y) * (vrm.scene.scale.y || 1) / hipHeight;

  const tracks = [];
  const _restQ = new THREE.Quaternion(), _parentQ = new THREE.Quaternion(), _animQ = new THREE.Quaternion();

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
        _animQ.fromArray(vals, h).premultiply(_parentQ).multiply(_restQ);
        if (isVrm0) { _animQ.x = -_animQ.x; _animQ.z = -_animQ.z; }
        _animQ.toArray(vals, h);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${vrmBoneName}.${prop}`, track.times, vals));
    } else if (track instanceof THREE.VectorKeyframeTrack) {
      const vals = track.values.map((v, idx) => (isVrm0 && idx % 3 !== 1 ? -v : v) * scale);
      tracks.push(new THREE.VectorKeyframeTrack(`${vrmBoneName}.${prop}`, track.times, vals));
    }
  }
  console.log('[retarget] tracks:', tracks.length, 'duration:', clip.duration);
  return new THREE.AnimationClip('vrmAnimation', clip.duration, tracks);
}

const info = document.getElementById('info');
const log  = (...args) => { console.log(...args); info.textContent = args.join(' '); };
const warn = (...args) => { console.warn(...args); info.textContent = '⚠ ' + args.join(' '); };

// ── Renderer + scene ──────────────────────────────────────────────────────────
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const key = new THREE.DirectionalLight(0xffffff, 1.2);
key.position.set(1, 2, 2);
scene.add(key);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 200);
camera.position.set(0, 1.4, 3.5);
camera.lookAt(0, 1.0, 0);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ── Simple orbit controls (no vendor dep) ────────────────────────────────────
let drag = null;
let spherical = { theta: 0, phi: Math.PI / 2.5, r: 3.5 };
const target = new THREE.Vector3(0, 1.0, 0);

canvas.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY }; });
window.addEventListener('mouseup',   () => { drag = null; });
window.addEventListener('mousemove', e => {
  if (!drag) return;
  spherical.theta -= (e.clientX - drag.x) * 0.01;
  spherical.phi    = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi - (e.clientY - drag.y) * 0.01));
  drag = { x: e.clientX, y: e.clientY };
  camera.position.set(
    target.x + spherical.r * Math.sin(spherical.phi) * Math.sin(spherical.theta),
    target.y + spherical.r * Math.cos(spherical.phi),
    target.z + spherical.r * Math.sin(spherical.phi) * Math.cos(spherical.theta),
  );
  camera.lookAt(target);
});
canvas.addEventListener('wheel', e => {
  spherical.r = Math.max(0.5, Math.min(20, spherical.r + e.deltaY * 0.005));
  camera.position.set(
    target.x + spherical.r * Math.sin(spherical.phi) * Math.sin(spherical.theta),
    target.y + spherical.r * Math.cos(spherical.phi),
    target.z + spherical.r * Math.sin(spherical.phi) * Math.cos(spherical.theta),
  );
  camera.lookAt(target);
}, { passive: true });

// ── Spark renderer ────────────────────────────────────────────────────────────
const sparkRenderer = new SparkRenderer({ renderer });
scene.add(sparkRenderer);

// ── Load .gvrm ────────────────────────────────────────────────────────────────
async function loadGvrm(url) {
  log('fetching', url);
  const resp   = await fetch(url);
  const zipBuf = await resp.arrayBuffer();
  const zip    = await JSZip.loadAsync(zipBuf);

  const dataJson    = await zip.file('data.json').async('string');
  const bindingData = JSON.parse(dataJson);

  const vrmBuf  = await zip.file('model.vrm').async('arraybuffer');
  const vrmBlob = new Blob([vrmBuf], { type: 'model/gltf-binary' });
  const vrmUrl  = URL.createObjectURL(vrmBlob);
  const gltfLoader = new GLTFLoader();
  gltfLoader.register(p => new VRMLoaderPlugin(p));
  const gltf = await new Promise((res, rej) => gltfLoader.load(vrmUrl, res, undefined, rej));
  URL.revokeObjectURL(vrmUrl);

  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('No VRM in model.vrm');

  const meta = vrm.meta;
  const isVrm0 = !(meta?.metaVersion === '1' || meta?.specVersion?.startsWith('1'));
  if (isVrm0) VRMUtils.rotateVRM0(vrm);

  vrm.scene.scale.setScalar(bindingData.modelScale ?? 1);
  vrm.scene.visible = false;   // mesh hidden — splat cloud is the visual
  scene.add(vrm.scene);

  const plyBuffer = await zip.file('model.ply').async('arraybuffer');

  console.log('[loadGvrm] splats:', bindingData.splatBoneIndices?.length,
    'bones:', new Set(bindingData.splatBoneIndices).size,
    'gsQuat:', bindingData.gsQuaternion);

  return { vrm, plyBuffer, bindingData };
}

async function buildSkinning(splatMesh, packedSplats, bindingData, skeleton) {
  const { splatBoneIndices } = bindingData;
  const numSplats = splatBoneIndices.length;

  for (const bone of skeleton.bones) bone.updateMatrixWorld(true);

  let maxBoneIndex = 0;
  for (const idx of splatBoneIndices) if (idx > maxBoneIndex) maxBoneIndex = idx;
  const numBones = maxBoneIndex + 1;

  const skinning = new SplatSkinning({ mesh: splatMesh, numSplats, numBones });

  // Set rest pose for each bone
  const _q = new THREE.Quaternion(), _p = new THREE.Vector3();
  for (let b = 0; b < numBones; b++) {
    const bone = skeleton.bones[b];
    if (!bone) continue;
    bone.getWorldQuaternion(_q);
    bone.getWorldPosition(_p);
    skinning.setRestQuatPos(b, _q, _p);
  }

  // Transform PLY positions from cloud-local → world space using gsPosition/gsQuaternion.
  // splatRelativePoses are NOT used for positioning (they're alpha-culling hints in GVRM).
  const gsPos  = bindingData.gsPosition
    ? new THREE.Vector3(...bindingData.gsPosition)
    : new THREE.Vector3();
  const gsQuat = bindingData.gsQuaternion
    ? new THREE.Quaternion(...bindingData.gsQuaternion)
    : new THREE.Quaternion();

  console.log('[buildSkinning] gsQuat norm:', gsQuat.length().toFixed(4),
    'gsPos:', gsPos.toArray().map(v => v.toFixed(3)));

  const _newPos  = new THREE.Vector3();
  const _newQuat = new THREE.Quaternion();
  for (let i = 0; i < numSplats; i++) {
    const s = unpackSplat(packedSplats.packedArray, i, packedSplats.splatEncoding);
    _newPos.copy(s.center).applyQuaternion(gsQuat).add(gsPos);
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

  // Assign each splat to its single bone
  const _bi = new THREE.Vector4(), _bw = new THREE.Vector4(1, 0, 0, 0);
  for (let i = 0; i < numSplats; i++) {
    _bi.set(splatBoneIndices[i], 0, 0, 0);
    skinning.setSplatBones(i, _bi, _bw);
  }
  skinning.skinTexture.needsUpdate = true;

  splatMesh.skinning = skinning;
  splatMesh.updateGenerator();

  return skinning;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const GVRM_URL = '../../avatars/sample8.gvrm';
const ANIM_URL = '../../animations/Breathing.fbx';

try {
  const { vrm, plyBuffer, bindingData } = await loadGvrm(GVRM_URL);

  log('parsing PLY…');
  const plyBlob      = new Blob([plyBuffer], { type: 'application/octet-stream' });
  const plyUrl       = URL.createObjectURL(plyBlob);
  const packedSplats = await new SplatLoader().loadAsync(plyUrl);
  URL.revokeObjectURL(plyUrl);
  log('PLY numSplats:', packedSplats.numSplats);

  const splatMesh = new SplatMesh({ packedSplats });
  scene.add(splatMesh);

  let skeleton = null;
  vrm.scene.traverse(o => { if (!skeleton && o.isSkinnedMesh) skeleton = o.skeleton; });
  if (!skeleton) throw new Error('No skeleton in VRM');

  log('building skinning…');
  const skinning = await buildSkinning(splatMesh, packedSplats, bindingData, skeleton);
  log('skinning built — numBones:', skinning.numBones);

  // Log bone count vs splatBoneIndices max for diagnostics
  console.log('[diag] skeleton.bones.length:', skeleton.bones.length,
    'splatBoneIndices max:', Math.max(...bindingData.splatBoneIndices),
    'distinct bone indices:', [...new Set(bindingData.splatBoneIndices)].sort((a,b)=>a-b).join(','));

  // Load and retarget idle FBX animation
  let mixer = null;
  try {
    const fbx  = await new Promise((res, rej) => new FBXLoader().load(ANIM_URL, res, undefined, rej));
    const clip = retargetFbxToVrm(fbx, vrm);
    if (clip && clip.tracks.length > 0) {
      mixer = new THREE.AnimationMixer(vrm.scene);
      mixer.clipAction(clip).play();
      log('avatar ready (retargeted anim) — drag to orbit');
    } else {
      log('avatar ready (retarget produced no tracks) — drag to orbit');
    }
  } catch (e) {
    warn('FBX failed, static pose:', e.message);
  }

  const clock = new THREE.Clock();
  const _q = new THREE.Quaternion(), _p = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (mixer) mixer.update(dt);
    vrm.update(dt);

    // Push bone transforms to GPU
    for (let b = 0; b < skeleton.bones.length; b++) {
      const bone = skeleton.bones[b];
      if (!bone) continue;
      bone.getWorldQuaternion(_q);
      bone.getWorldPosition(_p);
      skinning.setBoneQuatPos(b, _q, _p);
    }
    skinning.updateBones();

    renderer.render(scene, camera);
  });

} catch (e) {
  warn('FAILED:', e.message);
  console.error(e);
}
