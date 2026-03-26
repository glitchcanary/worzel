# Gaussian Splat Avatars for Fink Characters

> **Status**: Prototype / research phase
> **Goal**: Low-lag, browser-native puppeteering of splat-based AI avatars driven by TTS audio, for use as visual representations of `/fink/characters`.

## Overview

We want real-time Gaussian Splatting (3DGS/4DGS) avatars that lip-sync to our existing TTS pipeline output, entirely in the browser. The priority is **minimizing latency** over max FPS or photorealism. Our middleware already outputs speech audio from LLM text, so the key addition is a lightweight audio-to-viseme/expression pipeline that deforms a pre-trained splat avatar in real time.

### Design Principles

- **Browser-native runtimes** — WebGPU preferred (fallback to WebGL) for compute/deformation.
- **WASM/ONNX/WebAudio for audio processing** — sub-50ms end-to-end on decent hardware.
- **Pre-baked lightweight splat avatars** — lower splat count is fine for storytelling; drive them via mesh skinning or per-Gaussian deformation. No heavy per-frame retraining.

## Recommended Open-Source Stack (2026)

### 1. Core Renderer: Visionary (WebGPU + ONNX Web)

- **Repo**: `Visionary-Laboratory/visionary` (Apache-2.0)
- Full web-native platform for real-time 3DGS / 4DGS / neural avatars.
- TypeScript/WebGPU backend with Three.js plugin API.
- Supports **dynamic per-frame inference** via ONNX Runtime Web — plug in a small ONNX model that maps audio features to Gaussian offsets/rotations/scales/colors for lips and expressions.
- GPU-driven sorting keeps latency low even during animation.
- **Integration**: Node middleware streams audio (WebSocket or MediaStream) to the browser; Visionary handles rendering + ONNX-driven deformation.

### 2. Skinned/Rigged Avatar: Instant Skinned Gaussian Avatars

- **Project**: `gaussian-vrm` (naruya/gaussian-vrm)
- Fully browser-based (WebGL/GLSL, runs on-device).
- Create a splat avatar in ~30 seconds from a smartphone scan (PLY to `.vrm` mesh + Gaussians).
- Gaussians attach to mesh vertices — any skeletal animation or blendshapes (mouth, eyes, eyebrows) deform them instantly.
- Real-time performance with sub-scenes for efficient sorting.
- No built-in lipsync — pair with Wawa-Lipsync below.

### 3. Real-Time Lipsync: Wawa-Lipsync

- **Repo**: `wass08/wawa-lipsync` (MIT, pure TypeScript)
- Lightweight WebAudio library for web AI chatbots and 3D avatars.
- Takes live audio (our TTS output) and outputs visemes/blendshape weights in real time (MFCC-style analysis, no heavy ML).
- Works natively with Three.js / React Three Fiber / any WebGL canvas.
- Sub-frame latency; production-proven in avatar UIs.
- **Alternative**: `wLipSync` (mrxz/wLipSync) — WASM version for even lower CPU use.

## Runtime Pipeline (Minimal Lag)

```
LLM -> text -> TTS -> audio buffer (stream via WebSocket)
                          |
                    [Browser receives audio]
                          |
                    Wawa-Lipsync / wLipSync
                          |
                    viseme weights (AA, EE, silence, expression scalars)
                          |
              +-----------+-----------+
              |                       |
     Visionary ONNX contract     gaussian-vrm skinned mesh
     (tiny model: visemes ->     (drive VRM blendshapes
      Gaussian deformation)       directly)
              |                       |
              +-----------+-----------+
                          |
                 WebGPU/WebGL canvas @ 60+ FPS
```

Everything after the audio stream is fully in-browser. No cloud round-trips for rendering or animation.

## Offline Avatar Creation (One-Time)

1. Use `gaussian-vrm` (browser) or standard 3DGS tools + SplattingAvatar-style training for mesh-embedded Gaussians.
2. Export as `.ply` + `.vrm` (or compatible Visionary format).
3. Add blendshape support for mouth shapes (standard VRM format).
4. Keep splat count moderate (~50-200k) for storytelling use.

## Additional Open-Source References

### Lightweight GS Viewers
- `Scthe/gaussian-splatting-webgpu` — WebGPU, clean JS demo
- `antimatter15/splat` — WebGL, pure JS, tiny footprint
- `GaussianSplats3D` — Three.js integration, easy drop-in

### Audio-Driven GS Research
- **THGS** (`sora158/THGS`) — speech audio to lipsync + gestures + expressions on GS avatars; web visualizer 150-285 FPS. Inference is Python but the web renderer is a useful reference.
- **GaussianSpeech** — audio-driven heads, code pending release.

## Practical Tips

- **Latency target**: Test on mid-range hardware (Chrome/Edge with WebGPU). WebAudio + ONNX Web typically adds <30ms.
- **UI integration**: Embed canvas in web app (Next.js/React + Three.js). Node middleware serves the page or streams TTS via WebSockets.
- **Expressiveness**: Add head/eye tracking (WebRTC face API) or gesture triggers from LLM intent.
- **Quick start**: Clone Visionary + Wawa-Lipsync, load a pre-made splat, pipe TTS audio. Talking avatar prototype in a day.

## Integration with Fink Characters

Each story in `/stories/*/metadata.json` already defines characters with voice profiles. We extend this with avatar data:

```json
{
  "characters": {
    "narrator": {
      "voice": "carney_narrator",
      "avatar": {
        "type": "gaussian-splat",
        "src": "avatars/narrator.ply",
        "vrm": "avatars/narrator.vrm",
        "splatCount": 100000,
        "blendshapes": ["mouthOpen", "mouthSmile", "eyeBlink", "browUp"]
      }
    }
  }
}
```

The Fink client would load the avatar asset alongside the story, initialize the renderer, and connect it to the TTS audio stream for real-time puppeteering.

## Next Steps

- [ ] Spike: integrate Wawa-Lipsync with our existing TTS WebSocket stream
- [ ] Spike: render a static `.ply` splat in the Fink client using a lightweight viewer
- [ ] Create a test avatar from a smartphone scan via gaussian-vrm
- [ ] Wire viseme output to splat deformation (Visionary ONNX or VRM blendshapes)
- [ ] Add `avatar` field to `StoryCharacterMetadata` type in `ink/story-manager.ts`
- [ ] Design fallback UX for devices without WebGPU support
