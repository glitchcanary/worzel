# Stage Compositor — Implementation Plan

## Vocabulary

| Concept | Name |
|---------|------|
| One 3D Gaussian particle | Gaussian |
| Named collection of Gaussians from a file | Cloud |
| Cloud placed on Stage with transform/velocity | CloudActor |
| Gaussians bound to VRM skeleton | CharacterActor |
| Compositor: one WebGL context, one RAF | Stage |
| DOM window layer | StageWindowManager |

## Files

| Action | Path |
|--------|------|
| Create | fink/client/stage.js |
| Create | fink/client/stage-windows.js |
| Create | fink/client/stage-boot.js |
| Modify | fink/client/index.html |
| Deprecate | fink/client/splat-boot.js |
| Deprecate | fink/client/splat-scene.js |
| Deprecate | fink/client/gvrm-avatar-boot.js |

## Key Technical Facts

- SplatScene extends THREE.Object3D — .position/.quaternion/.scale are live
- viewer.splatMesh.getScene(i) returns SplatScene for index i
- dynamicScene:true → updateTransforms() called automatically each frame
- Viewer accepts renderer+threeScene options to share external renderer
- GVRM.load(url, scene, camera, renderer) shares same renderer
- One RAF: viewer.update() + gvrm.update() + renderer.render(scene,cam)
- viewer.render() calls renderer.clear() explicitly — autoClear=false on
  Three.js renderer is safe and prevents avatar pass from clearing clouds

## Critical Risks

### Risk A — Two cameras needed
Background clouds use cameraUp:[0,-1,0] (gaussian Y-down convention).
VRM avatar needs Y-up. Share one camera = avatar upside down.
Fix: separate splatCamera (Y-down) for Viewer, avatarCamera (Y-up) for Three.js.

### Risk B — assets/default.json fetch in GVRM
If data.json in .gvrm has no boneOperations, GVRM fetches ./assets/default.json.
Create fink/client/assets/default.json = {"boneOperations":[]} as fallback.

### Risk C — GVRM calls renderer.render() during load (bone texture bake)
Fine — renderer exists by then. Brief flash, overwritten by first RAF frame.

## Render Order Per Tick
1. Apply velocity → position for all actors (Euler integration)
2. CloudActor._flush() → sync position/quaternion/scale/opacity/visible to SplatScene
3. viewer.update() — CPU sort
4. CharacterActor._update() — FBX animation + lipsync + gvrm.update()
5. viewer.render() — draws clouds (clears canvas, uses splatCamera)
6. renderer.render(threeScene, avatarCamera) — draws CharacterActor on top (autoClear=false)

## Window States
normal ↔ maximised ↔ minimised
minimised → actor.visible=false; if ALL minimised → stage.pause()
restore → actor.visible=true; stage.resume()
