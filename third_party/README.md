# third_party/

Vendored third-party dependencies that aren't available via npm or need
source-level inclusion (e.g. for ESP32/PlatformIO builds).

## Planned

### libopus (Opus codec reference implementation)

- **Source:** https://opus-codec.org/ / https://gitlab.xiph.org/xiph/opus
- **License:** 3-clause BSD (permissive, non-viral)
- **Patents:** Royalty-free grants from Xiph/Broadcom/Microsoft; defensive termination only
- **Standard:** IETF RFC 6716
- **Use case:** ESP32 client Opus encoding (16kHz mono, 960 samples/frame, 60ms, 16kbps)
- **Why vendored:** PlatformIO needs C source for Xtensa/RISC-V cross-compilation;
  no official Arduino/PlatformIO package exists.

The server uses `opusscript` (npm) for decoding. The browser uses native WebCodecs
`AudioEncoder`. Only the ESP32 client needs libopus C source.
