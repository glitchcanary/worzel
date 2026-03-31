# Notes from the failed Spark SplatSkinning port

## What we learned / what was worth keeping

### Architecture (correct direction)
- Single WebGL context, single SparkRenderer handling both background cloud and character splats — eliminates the dual-renderer depth sorting conflict that made the old GVRM system slow and visually wrong
- `Stage` / `CloudActor` / `CharacterActor` abstraction in `stage.js` is clean and worth keeping
- `StageWindowManager` (stage-windows.js) and `StageDebug` work fine — keep those

### Code worth reusing from stage.js

**`MIXAMO_TO_VRM` mapping table** (lines ~217-243) — 54-entry Mixamo→VRM bone name map, ported from naruya/gaussian-vrm (MIT). Correct and complete.

**`_retargetFbxToVrm(fbx, vrm)`** — quaternion retargeting with parent-space correction, VRM0/VRM1 handling, hip height scaling. The logic is right but was never actually tested because the AnimationMixer was targeting vrm.scene with raw Mixamo bone names that don't exist on VRM nodes. Needs a test with the retargeted clip actually driving VRM normalized bones.

**`_loadGvrm(url, scene)`** — unzips .gvrm, loads VRM via blob URL, applies modelScale and boneOperations, returns {vrm, plyBuffer, bindingData}. This is correct and clean.

**Keyboard focus guard** — disabling SparkControls FPS movement when a text input has focus. Keep this.

**`CharacterActor.connectAudioTap` / `_applyViseme`** — lipsync wiring is correct.

### What was wrong in _buildSkinning

The core problem: `splatRelativePoses` from data.json are **NOT** world-space offsets from bone to splat. They are small local offsets (~cm scale) in the cloud's local coordinate space (defined by `gsPosition` / `gsQuaternion`).

The gsQuaternion `[0,0,1,0]` = THREE.Quaternion(x=0,y=0,z=1,w=0) = 180° rotation around Z axis. This is a coordinate system artifact from how the GVRM tool exported the cloud (Y-down to Y-up conversion).

The approach of `bone_world_pos + gsQuat.apply(relativePose)` at commit `22994f2` produced a coherent-ish shape but upside-down / inverted because the gsQuat 180°Z was rotating the offsets incorrectly in world space.

### What the GVRM system actually does (for reference)
- Splits PLY into per-bone sub-clouds via `sortSplatsByBones` / `splitPLY`
- Loads each sub-cloud as a separate `DropInViewer` `SplatScene`
- Moves each sub-scene as a rigid body per bone — no per-splat skinning at all
- `splatRelativePoses` used ONLY for alpha culling, NOT for positioning
- The PLY positions are already in the right place in cloud-local space

### Correct approach for the next attempt
1. Don't rebake PLY positions using splatRelativePoses at all
2. The PLY is in cloud-local space (origin = gsPosition, orientation = gsQuaternion)
3. To use Spark SplatSkinning correctly:
   - Apply gsPosition/gsQuaternion as the SplatMesh's own transform
   - OR: pre-transform all PLY positions by gsPosition/gsQuaternion inverse at load time so they align with VRM skeleton world space
   - Set rest poses from bone world positions
   - Assign each splat to its bone (splatBoneIndices), weight=1.0
   - Let SplatSkinning compute deltas per frame
4. The splatRelativePoses are the offset from each splat's position to its bone's position in cloud-local space — useful for verifying the assignment but not needed for positioning

### Known working state (baseline)
- `gvrm-avatar-boot.js` + `gaussian-vrm.min.js` + `splat-boot.js` + `splat-scene.js`
- Dual renderer (two separate WebGL contexts), two canvases
- Avatar in bottom-right corner panel, background splat fullscreen
- sample9.gvrm loads and animates recognisably with Breathing idle FBX
- Lipsync wired via wawa-lipsync

### data.json fields for sample8.gvrm
- gsPosition: null (origin)
- gsQuaternion: [0, 0, 1, 0]  ← 180° around Z, Y-down artifact
- modelScale: 1
- splatBoneIndices: 151149 entries, 14 distinct bone indices used
- splatRelativePoses: 151149*3 floats, values ~0.001-0.02 range (centimetres)
- boneOperations: arm/leg rest pose adjustments
