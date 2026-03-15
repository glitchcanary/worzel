# third_party/

Vendored third-party dependencies that aren't available via npm or need
source-level inclusion (e.g. for ESP32/PlatformIO builds, ONNX models).

Binary artifacts (`.onnx`, compiled libs) are not checked into git.
Run `scripts/fetch-third-party.sh` to download them.

## Contents

### silero-vad/ — Voice Activity Detection model

- **Source:** https://github.com/snakers4/silero-vad
- **License:** MIT
- **Artifact:** `silero_vad_v5.onnx` (~2MB ONNX model)
- **Use case:** Server-side VAD via `onnxruntime-node`; replaces energy-based
  threshold detection in the voice pipeline and Twilio bridge.
- **Why vendored:** ONNX model file needed at runtime; npm wrappers
  (`@ricky0123/vad-node`) bundle their own copy but we want explicit
  version control of the model artifact.
- **ESP32 note:** Cannot run on ESP32. Use ESP-SR VADNet instead.

### libopus/ — Opus codec reference implementation

- **Source:** https://opus-codec.org/ / https://gitlab.xiph.org/xiph/opus
- **License:** 3-clause BSD (permissive, non-viral)
- **Patents:** Royalty-free grants from Xiph/Broadcom/Microsoft; defensive termination only
- **Standard:** IETF RFC 6716
- **Use case:** ESP32 client Opus encoding (16kHz mono, 960 samples/frame, 60ms, 16kbps)
- **Why vendored:** PlatformIO needs C source for Xtensa/RISC-V cross-compilation;
  no official Arduino/PlatformIO package exists.

The server uses `@discordjs/opus` (npm, native binding) for encoding/decoding.
The browser uses native WebCodecs `AudioEncoder`. Only the ESP32 client needs
libopus C source.
