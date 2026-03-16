# Silero VAD

Pre-trained voice activity detection model from [snakers4/silero-vad](https://github.com/snakers4/silero-vad).

## Model

- **File:** `silero_vad_v5.onnx` (~2MB, not checked in — download via script)
- **License:** MIT
- **Input:** 16kHz mono PCM, 30ms+ chunks (512 samples at 16kHz = 32ms)
- **Output:** Speech probability 0.0–1.0 per chunk, <1ms inference on CPU
- **Versions:** v5 (current), v4 (legacy). Use v5.

## Usage

### Server (Node.js)

Via `onnxruntime-node` — runs the ONNX model directly:

```typescript
import * as ort from 'onnxruntime-node';

const session = await ort.InferenceSession.create('third_party/silero-vad/silero_vad_v5.onnx');
// Feed 512-sample chunks (32ms at 16kHz), get speech probability
```

Or via `@ricky0123/vad-node` which wraps this with a higher-level API:

```typescript
import { NonRealTimeVAD } from '@ricky0123/vad-node';
const vad = await NonRealTimeVAD.new();
for await (const { audio, start, end } of vad.run(float32Audio, sampleRate)) {
  // speech segment detected
}
```

### Browser (Web client)

Via `@ricky0123/vad-web` which bundles the model and runs via `onnxruntime-web` (WASM):

```typescript
import { MicVAD } from '@ricky0123/vad-web';
const vad = await MicVAD.new({
  onSpeechStart: () => { /* start recording */ },
  onSpeechEnd: (audio) => { /* send to server */ },
});
vad.start();
```

The browser package bundles its own copy of the model — this directory's `.onnx` file is for the server.

### ESP32

**Silero VAD cannot run on ESP32.** It requires ONNX Runtime which needs AVX/AVX2 instructions not available on Xtensa or RISC-V cores. It also uses ~50% CPU on a Raspberry Pi Zero, which is far more powerful than an ESP32.

For ESP32, use Espressif's ESP-SR VADNet instead — purpose-built for the platform. See `esp32-client/` and [espressif/esp-sr](https://github.com/espressif/esp-sr).

## Download

```bash
# Download the v5 ONNX model
curl -L -o third_party/silero-vad/silero_vad_v5.onnx \
  https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx
```

Or run `scripts/fetch-third-party.sh` which downloads all vendored artifacts.

## References

- [snakers4/silero-vad](https://github.com/snakers4/silero-vad) — model source
- [@ricky0123/vad](https://github.com/ricky0123/vad) — JS/TS wrappers
- [ONNX Runtime](https://onnxruntime.ai/) — inference engine
