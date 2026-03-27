# Gaussian Splat Avatars for Fink Characters

> **Status**: Prototype / research phase
> **Goal**: Low-lag, browser-native puppeteering of splat-based AI avatars driven by TTS audio, for use as visual representations of `/fink/characters`.

## Overview

We want real-time Gaussian Splatting (3DGS/4DGS) avatars that lip-sync to our existing TTS pipeline output, entirely in the browser. The priority is **minimizing latency** over max FPS or photorealism. Our middleware already outputs speech audio from LLM text, so the key addition is a lightweight audio-to-viseme/expression pipeline that deforms a pre-trained splat avatar in real time.

### Design Principles

- **Browser-native runtimes** — WebGPU preferred (fallback to WebGL) for compute/deformation.
- **WASM/ONNX/WebAudio for audio processing** — sub-50ms end-to-end on decent hardware.
- **Pre-baked lightweight splat avatars** — lower splat count is fine for storytelling; drive them via mesh skinning or per-Gaussian deformation. No heavy per-frame retraining.

## How Facial Animation Works in gaussian-vrm

The key mechanism: each Gaussian splat is bound to the nearest vertices of the underlying VRM mesh. When the mesh deforms — whether via skeletal animation **or blend shapes** — the splats follow. This means the `@pixiv/three-vrm` expression API drives Gaussian facial animation directly, with no custom deformation code needed.

```javascript
// Access the underlying VRM's expression manager
const expressionManager = gvrm.vrm.expressionManager;

// Set blend shape weights (0.0 to 1.0)
expressionManager.setValue('aa', 0.8);   // mouth open vowel
expressionManager.setValue('joy', 0.5);  // smile

// In the animation loop — this makes splats follow the new face shape
function animate() {
    requestAnimationFrame(animate);
    gvrm.update();  // recalculates splat positions from current mesh state
    renderer.render(scene, camera);
}
```

### Lipsync Integration Pattern

```javascript
// wawa-lipsync → expressionManager each frame
lipsync.processAudio();
const viseme = lipsync.viseme ?? 'sil';

// zero all mouth shapes
['aa', 'ih', 'ou', 'ee', 'oh'].forEach(v => expressionManager.setValue(v, 0));

// apply current viseme
const target = VISEME_TO_VRM[viseme];
if (target) expressionManager.setValue(target, 0.8);

gvrm.update(); // splats follow
```

### Webcam / Real-Time Facial Tracking

For full facial animation beyond lipsync, use **MediaPipe Face Landmarker** → 52 ARKit blend shape coefficients → map to VRM `expressionManager`. Works for blinks, brow raises, smile, etc. **Kalidokit** automates the MediaPipe-to-VRM mapping.

### Known Limitations

- **Mouth interior**: Gaussian scans (e.g. from Scaniverse) don't capture teeth/tongue. When the mouth opens it looks hollow. Fix: add a 3D mouth interior mesh inside the VRM before scanning.
- **Splat density**: Facial animation quality depends on scan density around lips and eyes — ensure high quality capture in those areas.
- **Performance**: GVRM uses GLSL for splat updates. Driving 10+ blend shapes simultaneously requires a modern GPU for 60fps.

## Recommended Open-Source Stack (2026)

### 1. Skinned/Rigged Avatar: gaussian-vrm

- **Project**: `naruya/gaussian-vrm` — MIT, fully browser-based (WebGL/GLSL)
- Gaussians bind to VRM mesh vertices; blend shapes and skeletal animation both deform splats automatically via `gvrm.update()`
- Built on `@pixiv/three-vrm` — full VRM expression API available
- Real-time performance; demo at `naruya.github.io/gaussian-vrm`
- Avatar creation: smartphone scan → PLY + VRM mesh via gaussian-vrm browser tool (~30s)
- No built-in lipsync — pair with Wawa-Lipsync

### 2. Real-Time Lipsync: Wawa-Lipsync

- **Repo**: `wass08/wawa-lipsync` (MIT, pure TypeScript)
- Takes live audio (TTS output) and outputs viseme weights in real time (MFCC-style, no ML)
- Sub-frame latency; already integrated in Fink client
- **Alternative**: `wLipSync` (mrxz/wLipSync) — WASM version for lower CPU use

### 3. Optional: Visionary (WebGPU + ONNX Web)

- **Repo**: `Visionary-Laboratory/visionary` (Apache-2.0)
- WebGPU-native 3DGS/4DGS renderer with ONNX Runtime Web for per-frame inference
- Supports SMPL-X body pose animation; facial expression not yet implemented
- Useful if gaussian-vrm WebGL performance is insufficient on target hardware

## Runtime Pipeline (Minimal Lag)

```
LLM -> text -> TTS -> audio buffer (stream via WebSocket)
                          |
                    [Browser receives audio]
                          |
                    Wawa-Lipsync (already integrated)
                          |
                    viseme weights (aa, ee, ih, oh, ou)
                          |
              expressionManager.setValue(viseme, weight)
                          |
                    gvrm.update()
                          |
              GLSL splat position recalc (GPU)
                          |
                 WebGL canvas @ 60+ FPS
```

Everything after the audio stream is fully in-browser. No cloud round-trips.

## Offline Avatar Creation (One-Time)

1. Scan character head with smartphone (Scaniverse or similar) → PLY
2. Use gaussian-vrm browser tool to bind splats to VRM mesh
3. Add mouth interior mesh in Blender if needed (teeth/tongue)
4. Ensure VRM has blend shapes: `aa`, `ih`, `ou`, `ee`, `oh`, `blink_l`, `blink_r`, `joy` (smile), `browUp`
5. Keep splat count moderate (~50-200k) for storytelling use
6. For cartoon heads: model in Blender, add blend shapes, export VRM, scan or procedurally place splats

## Additional References

### Lightweight GS Viewers (for static scene/background splats)
- `Scthe/gaussian-splatting-webgpu` — WebGPU, clean JS demo
- `antimatter15/splat` — WebGL, pure JS, tiny footprint
- `GaussianSplats3D` (`mkkellogg`) — Three.js integration, easy drop-in

### Facial Tracking Tools
- **Kalidokit** — MediaPipe/FaceMesh → VRM bones + blend shapes automatically
- **MediaPipe Face Landmarker** — 52 ARKit blend shape coefficients from webcam

### Audio-Driven GS Research (not yet browser-runnable)
- **THGS** (`sora158/THGS`) — speech to lipsync + gestures on GS avatars; web visualizer reference
- **GaussianSpeech** (ICCV 2025, `shivangi-aneja`) — audio-driven Gaussian heads; code pending
- **GaussianBlendshapes** (`zjumsj`) — 3DGS facial blend shapes at 370fps, CUDA/desktop only
- **TaoAvatar** (CVPR 2025) — full-body talking avatar, targets native AR/VR, no browser build

## Integration with Fink Characters

Each story in `/stories/*/metadata.json` defines characters with voice profiles. Extend with avatar data:

```json
{
  "characters": {
    "narrator": {
      "voice": "carney_narrator",
      "avatar": {
        "type": "gaussian-vrm",
        "ply": "avatars/narrator.ply",
        "vrm": "avatars/narrator.vrm",
        "splatCount": 100000,
        "expressions": ["aa", "ih", "ou", "ee", "oh", "joy", "blink_l", "blink_r", "browUp"]
      }
    }
  }
}
```

## Next Steps

- [x] Spike: integrate Wawa-Lipsync with TTS WebSocket stream (done)
- [x] Render VRM avatar in Fink client with real-time lipsync (done)
- [ ] Spike: render a static `.ply` splat in the Fink client (antimatter15/splat or GaussianSplats3D)
- [ ] Create/source a cartoon head VRM with blend shapes (aa, oh, blink, smile)
- [ ] Integrate gaussian-vrm: replace three-vrm renderer with gvrm, confirm blend shapes drive splats
- [ ] Wire existing wawa-lipsync viseme output to gvrm expressionManager
- [ ] Add `avatar` field to `StoryCharacterMetadata` type in `ink/story-manager.ts`
- [ ] Design fallback UX for devices without WebGL2 support
