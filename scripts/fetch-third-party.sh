#!/usr/bin/env bash
# Download third-party binary artifacts that aren't checked into git.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
THIRD_PARTY="$REPO_ROOT/third_party"

# ── Silero VAD v5 ONNX model ──────────────────────────────────────────────
SILERO_DIR="$THIRD_PARTY/silero-vad"
SILERO_MODEL="$SILERO_DIR/silero_vad_v5.onnx"
SILERO_URL="https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx"

if [ -f "$SILERO_MODEL" ]; then
  echo "silero-vad: already present ($SILERO_MODEL)"
else
  echo "silero-vad: downloading v5 ONNX model..."
  mkdir -p "$SILERO_DIR"
  curl -fSL -o "$SILERO_MODEL" "$SILERO_URL"
  echo "silero-vad: done ($(du -h "$SILERO_MODEL" | cut -f1))"
fi

# ── libopus (placeholder — not yet automated) ─────────────────────────────
echo "libopus: manual setup required for ESP32 builds. See third_party/README.md"

echo ""
echo "All third-party artifacts ready."
