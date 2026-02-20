/**
 * AudioWorklet processor for microphone capture.
 *
 * In WebSocket mode, we capture raw PCM from the mic and send it
 * as binary frames. Opus encoding happens either:
 * - In the worklet via a WASM Opus encoder
 * - On the server (receive PCM, encode to Opus for ASR)
 *
 * In WebRTC mode, this worklet is not needed — the browser's
 * RTCPeerConnection handles Opus encoding natively.
 *
 * This file is designed to be loaded as a worklet module.
 */

export const OPUS_WORKLET_CODE = `
class WorzelAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 960; // 60ms at 16kHz
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i];

      if (this.bufferIndex >= this.bufferSize) {
        // Convert float32 to int16 PCM
        const pcm = new Int16Array(this.bufferSize);
        for (let j = 0; j < this.bufferSize; j++) {
          const s = Math.max(-1, Math.min(1, this.buffer[j]));
          pcm[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        this.port.postMessage({ type: 'audio', pcm: pcm.buffer }, [pcm.buffer]);
        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('worzel-audio-processor', WorzelAudioProcessor);
`;
