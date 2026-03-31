# Gaussian Splat Avatar — Pure Spark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dual-renderer hack (Spark for background clouds + gaussian-splats-3d DropInViewer inside GVRM for avatars) with a single Spark pipeline that handles both, achieving photorealistic animated avatars like https://naruya.github.io/gaussian-vrm/examples/simple-key-walker.html — with lipsync and viseme-driven facial animation.

**Architecture:** Load `.gvrm` files in `stage.js` directly (unzip → VRM + PLY), feed PLY into a Spark `SplatMesh`, and wire the VRM skeleton to Spark's built-in `SplatSkinning` API using the `splatBoneIndices`/`splatRelativePoses` from `data.json`. One WebGL context, one RAF, one renderer. The `gaussian-vrm.min.js` and `gaussian-splats-3d.module.js` vendor files are no longer imported.

**Tech Stack:** Three.js (existing vendor), `@pixiv/three-vrm` (existing vendor), `FBXLoader` (existing vendor), Spark `SplatMesh` + `SplatSkinning` + `SplatLoader` + `PackedSplats` + `unpackSplat` + `setPackedSplat` (all exported from existing `spark.module.js`), `jszip.module.js` (existing vendor), wawa-lipsync (existing vendor).

---

## Background: What We Know

### The problem with the old approach
`GVRM.load()` internally creates a `gaussian-splats-3d DropInViewer` which is a completely separate splat renderer from Spark. Both add objects to the same THREE.js scene and both do depth-sorted alpha compositing independently — they don't know about each other's splats, so depth ordering breaks, producing coloured blobs with missing surface texture/colour.

Additionally gaussian-splats-3d uses `sphericalHarmonicsDegree:2` but the degree-2 SH rendering path in its DropInViewer requires its own internal sort + render pipeline which conflicts with Spark's. The photorealistic texture (face, t-shirt) comes from SH colour evaluation — if the render pipeline is wrong, SH is evaluated against wrong view directions, producing grey/colour blobs.

### Why Spark can do this natively
Spark exports `SplatSkinning` — a GPU dual-quaternion skinning system for splats, with exactly the right API:
- `setSplatBones(splatIndex, boneIndices, weights)` — matches `data.json`'s `splatBoneIndices` (one bone per splat, weight=1.0)
- `setRestQuatPos(boneIndex, quat, pos)` — set bind-pose bone transform
- `setBoneQuatPos(boneIndex, quat, pos)` — set current bone transform each frame
- `updateBones()` — marks boneTexture dirty; GPU recalculates all splat positions next frame

### The .gvrm format
A `.gvrm` file is a ZIP containing:
- `model.vrm` — GLB with VRM skeleton + blend shapes (loaded by three-vrm)
- `model.ply` — Gaussian splat cloud in PLY format
- `data.json` — binding data:
  - `splatBoneIndices[N]` — one bone index per splat (index into VRM skeleton)
  - `splatRelativePoses[N*3]` — rest-pose offset of splat centre from its bone's world position (x,y,z triples)
  - `splatVertexIndices[N]` — which VRM mesh vertex the splat is near (not used for skinning, optional)
  - `gsPosition[3]`, `gsQuaternion[4]` — initial world transform of the splat cloud
  - `modelScale` — uniform scale for the VRM
  - `boneOperations[]` — rest-pose adjustments to specific bones
  - `customType` — integer flag (1 = standard binding)

### Spark SplatSkinning mapping
The `.gvrm` data maps cleanly:
- Each splat has exactly ONE bone (weight = 1.0). Call `setSplatBones(i, {x:boneIdx,y:0,z:0,w:0}, {x:1,y:0,z:0,w:0})`.
- For `setRestQuatPos`: bone's world quaternion and world position in the bind/rest pose.
- For `setBoneQuatPos` each frame: bone's current world quaternion and world position from `THREE.Skeleton`.
- `splatRelativePoses` gives the splat's offset from the bone in rest space — this must be baked into the PLY positions before uploading to Spark (i.e. shift each splat to `bone_rest_world_pos + relative_pose`).

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| **Rewrite** | `fink/client/stage.js` | Replace `CharacterActor` to use Spark skinning; remove GVRM import |
| **Delete import** | `fink/client/stage.js` | Remove `gaussian-vrm.min.js` import |
| **No change** | `fink/client/stage-boot.js` | API unchanged — `addCharacter(id, url)` still works |
| **No change** | `fink/client/stage-windows.js` | Pure DOM, untouched |
| **No change** | `fink/client/stage-debug.js` | Reads `window.finkStage`, untouched |
| **No change** | `fink/client/avatar.js` | Retained as-is (mesh-VRM fallback reference) |
| **No change** | `fink/client/vendor/*` | Keep all vendors; `gaussian-vrm.min.js` and `gaussian-splats-3d.module.js` remain on disk but are no longer imported |

---

## Task 1: Load and unpack a `.gvrm` file without GVRM

**Files:**
- Modify: `fink/client/stage.js` — replace `addCharacter` internals

**What we're doing:** Load the ZIP, extract the three assets, and verify we have what we need. No skinning yet — just prove we can get the PLY bytes, the VRM, and the data.json.

- [ ] **Step 1: Add gvrm unpacking helper at the top of stage.js**

Replace the existing `import { GVRM }` line and add the unzip helper. The `jszip.module.js` vendor is already present.

```js
// Remove this line entirely:
// import { GVRM }    from './vendor/gaussian-vrm.min.js';

// Add these imports at the top (after the existing Spark imports):
import JSZip from './vendor/jszip.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from './vendor/three-vrm.module.js';
import { FBXLoader } from './vendor/FBXLoader.js';
import { SplatSkinning, SplatLoader, PackedSplats, unpackSplat, setPackedSplat } from './vendor/spark.module.js';
```

Note: `SplatLoader`, `PackedSplats`, `unpackSplat`, `setPackedSplat` are already exported from `spark.module.js`. Check the current import line at the top of `stage.js` — it imports `{ SparkRenderer, SplatLoader, SplatMesh, SparkControls }`. Extend it to also import `{ SplatSkinning, PackedSplats, unpackSplat, setPackedSplat }`.

- [ ] **Step 2: Write the `_loadGvrm(url)` helper function**

Add this as a module-level function (not a class method) in `stage.js`, below the imports:

```js
/**
 * Unpack a .gvrm ZIP and return { vrm, plyBuffer, bindingData }.
 *
 * vrm        — loaded @pixiv/three-vrm VRM object (already added to scene by caller)
 * plyBuffer  — ArrayBuffer of the raw PLY file
 * bindingData — parsed data.json object
 */
async function _loadGvrm(url, scene) {
  const resp = await fetch(url);
  const zipBuf = await resp.arrayBuffer();
  const zip = await JSZip.loadAsync(zipBuf);

  // 1. Parse data.json
  const dataJson = await zip.file('data.json').async('string');
  const bindingData = JSON.parse(dataJson);

  // 2. Load VRM via GLTFLoader + three-vrm plugin
  const vrmBuf = await zip.file('model.vrm').async('arraybuffer');
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

  // Apply model scale and bone rest-pose adjustments from data.json
  const scale = bindingData.modelScale ?? 1;
  vrm.scene.scale.setScalar(scale);
  if (Array.isArray(bindingData.boneOperations)) {
    for (const op of bindingData.boneOperations) {
      const rawBone = vrm.humanoid?.getRawBoneNode(op.boneName);
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

  scene.add(vrm.scene);

  // 3. Get PLY as ArrayBuffer (Spark SplatLoader will parse it)
  const plyBuffer = await zip.file('model.ply').async('arraybuffer');

  return { vrm, plyBuffer, bindingData };
}
```

- [ ] **Step 3: Verify _loadGvrm works — console log the binding data counts**

In `addCharacter`, replace the `GVRM.load(...)` call with:

```js
const { vrm, plyBuffer, bindingData } = await _loadGvrm(url, this.#scene);
console.log('[Stage] gvrm unpacked — splats:', bindingData.splatBoneIndices.length,
  'bones used:', new Set(bindingData.splatBoneIndices).size,
  'scale:', bindingData.modelScale);
```

Load the page and confirm these numbers appear in the console. For `sample8.gvrm` expect ~76337 splats.

- [ ] **Step 4: Commit**

```bash
git add fink/client/stage.js
git commit -m "feat: unpack .gvrm ZIP natively, remove GVRM/gaussian-splats-3d dependency"
```

---

## Task 2: Load PLY into Spark PackedSplats

**Files:**
- Modify: `fink/client/stage.js`

**What we're doing:** Convert the raw PLY bytes into a Spark `PackedSplats` buffer that Spark can render. At this stage the avatar will appear in the scene but in its rest/bind pose, unrigged — like a static point cloud.

- [ ] **Step 1: Load PLY via SplatLoader**

After the `_loadGvrm` call in `addCharacter`, add:

```js
// Parse PLY into PackedSplats via a Blob URL
const plyBlob = new Blob([plyBuffer], { type: 'application/octet-stream' });
const plyUrl  = URL.createObjectURL(plyBlob);
const packedSplats = await new SplatLoader().loadAsync(plyUrl);
URL.revokeObjectURL(plyUrl);
console.log('[Stage] PLY loaded into PackedSplats, num splats:', packedSplats.numSplats);
```

- [ ] **Step 2: Create SplatMesh and add to scene**

```js
const splatMesh = new SplatMesh({ packedSplats });
// Apply the cloud transform from data.json (gsPosition / gsQuaternion)
const gsPos = bindingData.gsPosition ?? [0, 0, 0];
const gsQuat = bindingData.gsQuaternion ?? [0, 0, 0, 1];
splatMesh.position.set(gsPos[0], gsPos[1], gsPos[2]);
splatMesh.quaternion.set(gsQuat[0], gsQuat[1], gsQuat[2], gsQuat[3]);
this.#scene.add(splatMesh);
```

- [ ] **Step 3: Remove the old DropInViewer overlay cleanup code**

In the current `addCharacter`, there's this code that suppresses GVRM's DOM overlays — remove it entirely since we no longer use GVRM:

```js
// DELETE this block:
document.querySelectorAll('body > div[style*="position: absolute"]').forEach(el => {
  el.style.pointerEvents = 'none';
});
```

- [ ] **Step 4: Store splatMesh and packedSplats on CharacterActor**

The `CharacterActor` class needs to hold these. Update `CharacterActor` class to add:

```js
_splatMesh = null;
_packedSplats = null;
_skinning = null;
_vrm = null;
_mixer = null;
```

And add a `_attachSplats(splatMesh, packedSplats, vrm)` method:

```js
_attachSplats(splatMesh, packedSplats, vrm) {
  this._splatMesh = splatMesh;
  this._packedSplats = packedSplats;
  this._vrm = vrm;
}
```

In `addCharacter`, after creating the SplatMesh:

```js
actor._attachSplats(splatMesh, packedSplats, vrm);
```

- [ ] **Step 5: Verify avatar appears as a static cloud**

Reload. The avatar should appear as a static Gaussian splat cloud in rest pose. It will look photorealistic (face, clothing visible) but won't animate yet. If you see coloured blobs without surface detail, SH is not being evaluated — check that `SplatLoader` is returning a `PackedSplats` with `numSplats > 0`.

- [ ] **Step 6: Commit**

```bash
git add fink/client/stage.js
git commit -m "feat: render gvrm avatar as static Spark SplatMesh (rest pose)"
```

---

## Task 3: Wire Spark SplatSkinning with .gvrm binding data

**Files:**
- Modify: `fink/client/stage.js`

**What we're doing:** Build the `SplatSkinning` object from `data.json`, set rest poses from the VRM skeleton's bind pose, and attach it to the `SplatMesh`. The avatar should now deform when the VRM skeleton moves (tested with a manual bone rotation first).

- [ ] **Step 1: Understand the bone index mapping**

The `splatBoneIndices` array contains indices into `vrm.scene.children[2].skeleton.bones` (the THREE.js Skeleton). We need to map these to our own `SplatSkinning` bone indices. Because Spark's `SplatSkinning` uses a flat bone array indexed by the values we choose, we map VRM skeleton bone indices 1:1: our `sparkBoneIndex = vrmSkeletonBoneIndex`.

The max bone index determines `numBones`:

```js
const maxBoneIndex = Math.max(...bindingData.splatBoneIndices);
const numBones = maxBoneIndex + 1;
```

- [ ] **Step 2: Add `_buildSkinning()` module-level helper**

Add this function in `stage.js` (module level, not inside any class):

```js
/**
 * Build a SplatSkinning from .gvrm binding data + VRM skeleton.
 *
 * @param {SplatMesh} splatMesh
 * @param {object} bindingData  — parsed data.json
 * @param {THREE.Skeleton} skeleton  — vrm.scene.children[2].skeleton
 * @returns {SplatSkinning}
 */
function _buildSkinning(splatMesh, bindingData, skeleton) {
  const { splatBoneIndices, splatRelativePoses } = bindingData;
  const numSplats = splatBoneIndices.length;
  const maxBoneIndex = Math.max(...splatBoneIndices);
  const numBones = maxBoneIndex + 1;

  const skinning = new SplatSkinning({ mesh: splatMesh, numSplats, numBones });

  // Compute rest-pose world transforms for each bone.
  // Force a full world-matrix update before reading.
  skeleton.pose();  // reset to bind pose
  for (const bone of skeleton.bones) {
    bone.updateMatrixWorld(true);
  }

  // Set rest pose for every bone we'll use.
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  for (let b = 0; b < numBones; b++) {
    const bone = skeleton.bones[b];
    if (!bone) continue;
    bone.getWorldQuaternion(_q);
    bone.getWorldPosition(_p);
    skinning.setRestQuatPos(b, _q, _p);
  }

  // Assign each splat to its single bone (weight = 1.0).
  const _boneIdx = new THREE.Vector4();
  const _weights = new THREE.Vector4(1, 0, 0, 0);
  for (let i = 0; i < numSplats; i++) {
    _boneIdx.set(splatBoneIndices[i], 0, 0, 0);
    skinning.setSplatBones(i, _boneIdx, _weights);
  }
  skinning.skinTexture.needsUpdate = true;

  // Attach skinning to the SplatMesh.
  splatMesh.skinning = skinning;

  return skinning;
}
```

- [ ] **Step 3: Shift splat positions to rest-pose bone world positions**

The PLY file stores splat positions in "cloud local space" relative to the initial `gsPosition`/`gsQuaternion` transform, NOT relative to individual bones. The `splatRelativePoses` encodes each splat's offset from its bone's world position in the bind pose. We need to bake the bind-pose bone position + relative offset into the PackedSplats data so that Spark's skinning shader (which applies delta from rest) gets the right result.

Add this function (module-level):

```js
/**
 * Rebake splat world positions to be at (bone_rest_world_pos + relative_pose).
 * This is needed so Spark's dual-quaternion skinning can correctly compute deltas.
 *
 * Mutates packedSplats in place.
 */
function _rebakeSplatPositions(packedSplats, bindingData, skeleton) {
  const { splatBoneIndices, splatRelativePoses } = bindingData;
  const numSplats = splatBoneIndices.length;

  const _bonePos = new THREE.Vector3();
  const _boneQuat = new THREE.Quaternion();
  const _rel = new THREE.Vector3();

  for (let i = 0; i < numSplats; i++) {
    const boneIdx = splatBoneIndices[i];
    const bone = skeleton.bones[boneIdx];
    if (!bone) continue;

    bone.getWorldPosition(_bonePos);
    bone.getWorldQuaternion(_boneQuat);

    // relative pose is in bone-local space (3 floats per splat)
    _rel.set(
      splatRelativePoses[i * 3],
      splatRelativePoses[i * 3 + 1],
      splatRelativePoses[i * 3 + 2],
    );
    // Transform relative offset from bone-local to world space
    _rel.applyQuaternion(_boneQuat);
    _rel.add(_bonePos);

    // Read existing splat to preserve colour, scale, rotation
    const existing = unpackSplat(packedSplats.data, i, packedSplats.splatEncoding);
    setPackedSplat(
      packedSplats.data, i,
      _rel.x, _rel.y, _rel.z,
      existing.scaleX, existing.scaleY, existing.scaleZ,
      existing.quatX, existing.quatY, existing.quatZ, existing.quatW,
      existing.opacity, existing.r, existing.g, existing.b,
      packedSplats.splatEncoding,
    );
  }
  packedSplats.needsUpdate = true;
}
```

- [ ] **Step 4: Call both helpers from `addCharacter`**

After `actor._attachSplats(...)`:

```js
// Get the THREE.Skeleton from the VRM scene graph
// VRM1: skeleton is at vrm.scene.children[2] (SkinnedMesh)
// Use the first SkinnedMesh we can find:
let skeleton = null;
vrm.scene.traverse(obj => {
  if (!skeleton && obj.isSkinnedMesh) skeleton = obj.skeleton;
});
if (!skeleton) throw new Error('[Stage] No skeleton found in VRM');

// Bake rest-pose bone positions into splat data
_rebakeSplatPositions(packedSplats, bindingData, skeleton);

// Build SplatSkinning (sets rest poses + assigns each splat to its bone)
const skinning = _buildSkinning(splatMesh, bindingData, skeleton);

// Store skeleton ref on actor for per-frame bone updates
actor._skeleton = skeleton;
actor._skinning = skinning;
```

- [ ] **Step 5: Remove splatMesh transform (let skinning handle world positions)**

After `_buildSkinning`, remove the `splatMesh.position/quaternion` assignment from Task 2. With skinning active the splat positions are now bone-absolute world positions; the `gsPosition`/`gsQuaternion` transform was only needed for the gaussian-splats-3d rendering path.

- [ ] **Step 6: Verify avatar appears in rest pose, skinned**

Reload. In the browser console run:
```js
const actor = window.finkStage.getActor('avatar');
const bone = actor._skeleton.bones[0];
bone.rotation.y += 0.3;
bone.updateMatrixWorld(true);
actor._skinning.setBoneQuatPos(0, bone.getWorldQuaternion(new THREE.Quaternion()), bone.getWorldPosition(new THREE.Vector3()));
actor._skinning.updateBones();
```
The corresponding part of the avatar should visibly deform.

- [ ] **Step 7: Commit**

```bash
git add fink/client/stage.js
git commit -m "feat: wire Spark SplatSkinning to VRM skeleton bind data"
```

---

## Task 4: Per-frame bone update — live skeleton animation

**Files:**
- Modify: `fink/client/stage.js` — `CharacterActor._update()`

**What we're doing:** Each frame, push all current VRM bone world transforms into `SplatSkinning` and call `updateBones()` so the GPU sees them. This makes the avatar animate.

- [ ] **Step 1: Add `_updateBones()` method to `CharacterActor`**

Inside the `CharacterActor` class, add:

```js
_updateBones() {
  if (!this._skinning || !this._skeleton) return;
  const skinning = this._skinning;
  const skeleton = this._skeleton;
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
```

- [ ] **Step 2: Call `_updateBones()` from `CharacterActor._update()`**

In the existing `_update()` method, after `this.#gvrm.update()` (which no longer exists — we removed GVRM). The method becomes:

```js
_update(dt) {
  if (!this._vrm) return;

  // Advance VRM/FBX animation
  if (this._mixer) {
    this._mixer.update(dt);
  }
  this._vrm.update(dt);

  // Lipsync visemes
  if (this.#lipsync) {
    this.#lipsync.processAudio();
    this._applyViseme(this.#lipsync.viseme ?? 'sil');
  }

  // Push bone transforms to GPU
  this._updateBones();

  // Visibility
  if (this._vrm.scene) this._vrm.scene.visible = this.visible;
  if (this._splatMesh) this._splatMesh.visible = this.visible;
}
```

Note: `this.#gvrm` private field reference in the old `_update` must be removed since GVRM is gone. The `dt` parameter needs to be passed in from `Stage.tick()`.

- [ ] **Step 3: Pass `dt` from Stage.tick() to CharacterActor._update()**

In `Stage.tick(dt)`, change the character update call:

```js
// Old:
for (const actor of this.#chars.values()) {
  actor._update();
}

// New:
for (const actor of this.#chars.values()) {
  actor._update(dt);
}
```

The `CharacterActor._update()` signature becomes `_update(dt)`.

- [ ] **Step 4: Wire FBX animation via THREE.AnimationMixer (replace GVRM.changeFBX)**

The old `CharacterActor.playAnim()` called `this.#gvrm?.changeFBX(url)`. Replace with FBX loading via `FBXLoader`:

```js
async playAnim(name) {
  const url = this._animMap[name] ?? name;
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
  const clip = THREE.AnimationClip.findByName(fbx.animations, fbx.animations[0].name)
    ?? fbx.animations[0];
  const action = this._mixer.clipAction(clip);
  action.play();
}
```

Remove the `this.#gvrm` private field and its `_attach(gvrm)` method entirely — they are no longer needed.

- [ ] **Step 5: Verify animation drives splat deformation**

Reload. The avatar should animate: the splat cloud should deform in sync with the skeleton. Open the debug panel (Ctrl+Shift+D) and use the avatar switcher to hot-swap between sample models. They should all animate.

- [ ] **Step 6: Commit**

```bash
git add fink/client/stage.js
git commit -m "feat: per-frame VRM skeleton → Spark SplatSkinning bone updates"
```

---

## Task 5: Lipsync viseme → VRM expressionManager

**Files:**
- Modify: `fink/client/stage.js` — `CharacterActor._applyViseme()`

**What we're doing:** The old lipsync path called into GVRM's expression manager. Now we call `vrm.expressionManager` directly, which is the same three-vrm API.

- [ ] **Step 1: Update `_applyViseme` to use `this._vrm` directly**

The existing `_applyViseme` method in `CharacterActor` already accesses:
```js
const em = this.#gvrm?.character?.currentVrm?.expressionManager;
```

Replace with:
```js
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
```

This is identical to the existing code except the expression manager path is direct.

- [ ] **Step 2: Verify lipsync drives splat facial deformation**

With a character loaded, trigger audio playback via the Fink chat UI. The mouth area splats should move with speech.

**Note:** VRM blend shapes deform the skeleton mesh, but Spark's `SplatSkinning` is bone-based (not blend-shape based). Blend shape deformation of splats requires a separate mechanism not in Spark's current `SplatSkinning` API. For now, only skeletal animation (including any blend shapes baked into the FBX) will deform the splats. Lipsync visemes will still animate the underlying VRM mesh (which remains visible as a fallback, or can be hidden).

Decision point: hide the VRM mesh (show only splats) or keep it visible under the splats. Initial implementation: **hide the VRM mesh** (`vrm.scene.visible = false`) so only the splat cloud is seen. This gives the Gaussian look. If blend-shape lipsync is critical, the VRM mesh can be unhidden.

```js
// In addCharacter, after loading:
vrm.scene.visible = false;  // hide mesh skeleton, show splats only
```

- [ ] **Step 3: Commit**

```bash
git add fink/client/stage.js
git commit -m "feat: lipsync viseme drives three-vrm expressionManager directly"
```

---

## Task 6: Remove dead code and clean up

**Files:**
- Modify: `fink/client/stage.js`
- Modify: `fink/client/avatar-boot.js` (update comment)

- [ ] **Step 1: Remove `#gvrm` private field from CharacterActor**

The `#gvrm` field and `_attach(gvrm)` method exist only for the old GVRM path. Delete:
- `#gvrm = null;`
- `#lipsync = null;` (move to `_lipsync` public-ish field since we now init it differently)
- `_attach(gvrm)` method

The `#lipsync` usage in `connectAudioTap` and `_update` should use `this._lipsync` (regular field set in constructor as `this._lipsync = null`).

- [ ] **Step 2: Remove old GVRM-specific `swapCharacter` VRM scene removal**

The current `swapCharacter` has:
```js
if (old?._gvrmScene) this.#scene.remove(old._gvrmScene);
```
Replace with proper cleanup:
```js
async swapCharacter(id, url, opts = {}) {
  const old = this.#chars.get(id);
  if (old) {
    if (old._vrm?.scene) this.#scene.remove(old._vrm.scene);
    if (old._splatMesh) this.#scene.remove(old._splatMesh);
  }
  this.#chars.delete(id);
  return this.addCharacter(id, url, opts);
}
```

- [ ] **Step 3: Verify hot-swap still works**

Open Ctrl+Shift+D debug panel. Use avatar selector to load a different sample. Old avatar should disappear, new one appear and animate.

- [ ] **Step 4: Commit**

```bash
git add fink/client/stage.js fink/client/avatar-boot.js
git commit -m "refactor: remove GVRM dead code, fix swapCharacter cleanup"
```

---

## Task 7: Verify end-to-end — photorealistic animated avatar

- [ ] **Step 1: Load the page and check visual quality**

The avatar should look like the naruya demo: photorealistic texture (face features, clothing visible) from spherical harmonics, animated by the FBX Breathing idle. If it looks like grey/flat blobs, the PLY's SH data is not being evaluated. Check:
- `packedSplats.numSplats` is > 0 in console
- `SplatLoader` is parsing the PLY with `sphericalHarmonicsDegree > 0` (check Spark SplatLoader options)

- [ ] **Step 2: Test with multiple avatar models**

Via the debug panel, test `sample1` through `sample9`. Each should load, animate, and look photorealistic.

- [ ] **Step 3: Test background cloud + avatar coexist**

The `soar.ksplat` environment should still render. Both the cloud and the avatar are now in the same Spark pipeline — splat depth sorting should be correct. You should not see bleeding or z-fighting between environment and avatar.

- [ ] **Step 4: Test lipsync**

Use the Fink chat UI to generate speech. Confirm that `connectAudioTap` is called and lipsync tap connects without errors in console.

- [ ] **Step 5: Commit final**

```bash
git add fink/client/stage.js
git commit -m "feat: full Spark-native gvrm rendering — photorealistic animated splat avatars"
```

---

## Known Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `splatRelativePoses` is in VRM mesh-local space, not bone-local | Splats in wrong position | After Task 3 Step 5: if avatar appears offset, try applying `gsPosition`/`gsQuaternion` as additional transform |
| SH degree in PLY not parsed by Spark SplatLoader | Flat coloured blobs, no texture | Pass `{ sphericalHarmonicsDegree: 2 }` option to `SplatLoader` if available; check Spark docs |
| VRM skeleton is NOT at `scene.children[2]` for all models | Skeleton not found | The `traverse` approach in Task 3 Step 4 handles this generically |
| Blend-shape lipsync not visible in splat cloud | Mouth doesn't open | Document limitation; the VRM mesh can be made semi-transparent overlay if needed |
| `unpackSplat` / `setPackedSplat` API mismatch | PLY positions not rebaked | Verify field names against Spark source: `existing.scaleX` etc. — check `unpackSplat` return shape |
| FBX retargeting to VRM bones may fail silently | No animation | Fall back to testing with `vrm.update(delta)` only (which drives spring bones) |

---

## Notes on License Compatibility (user question)

- **gaussian-vrm.min.js**: MIT (naruya/gaussian-vrm on GitHub states MIT)
- **gaussian-splats-3d.module.js**: MIT (Mark Kellogg)
- **spark.module.js**: Apache-2.0 (@sparkjsdev/spark)
- **three-vrm**: MIT (@pixiv/three-vrm)

All MIT/Apache-2.0 — compatible. We are porting the **binding logic** from gaussian-vrm (MIT) into our own code in `stage.js`. Since both are MIT and we're not redistributing, this is fine. The core skinning algorithm is implemented by Spark's `SplatSkinning` (Apache-2.0, compatible with this use).
