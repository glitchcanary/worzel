/**
 * Twilio Media Streams bridge — connects PSTN callers to the Worzel voice pipeline.
 *
 * Architecture:
 *   Caller → PSTN → Twilio → WebSocket (8kHz mulaw) → this bridge → voice pipeline
 *   voice pipeline → TTS audio → this bridge → Twilio WebSocket → PSTN → Caller
 *
 * Twilio sends JSON-wrapped audio chunks (base64 G.711 mulaw, 8kHz mono) over
 * a WebSocket connection. This bridge:
 *   1. Decodes mulaw → PCM int16
 *   2. Resamples 8kHz → 16kHz to match Worzel's pipeline input
 *   3. Runs VAD (voice activity detection) to determine speech boundaries
 *   4. Feeds detected speech segments into the voice pipeline
 *   5. Takes TTS output, resamples 16kHz → 8kHz, encodes to mulaw
 *   6. Sends back as base64-encoded media messages on the Twilio WebSocket
 *
 * VAD is critical because PSTN has no push-to-talk — the bridge must detect
 * when the caller starts and stops speaking.
 *
 * Twilio Media Streams protocol:
 *   https://www.twilio.com/docs/voice/media-streams/websocket-messages
 *
 * @module
 */

import { createHmac } from 'node:crypto';
import type { WebSocket } from 'ws';
import type pino from 'pino';
import type { Transport } from '../transport/interface.js';
import { decodeOpusFrames } from '../utils/opus-decode.js';

// ---- Twilio Media Streams message types ----

/** Twilio sends this once when the stream starts. */
interface TwilioStartMessage {
  event: 'start';
  sequenceNumber: string;
  start: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    mediaFormat: {
      encoding: 'audio/x-mulaw';
      sampleRate: 8000;
      channels: 1;
    };
  };
}

/** Twilio sends these continuously with audio data. */
interface TwilioMediaMessage {
  event: 'media';
  sequenceNumber: string;
  media: {
    track: 'inbound' | 'outbound';
    chunk: string;
    timestamp: string;
    payload: string; // base64-encoded mulaw audio
  };
}

/** Twilio sends this when the caller hangs up or stream ends. */
interface TwilioStopMessage {
  event: 'stop';
  sequenceNumber: string;
  stop: {
    accountSid: string;
    callSid: string;
  };
}

/** Mark message — tells Twilio we've consumed audio up to a label. */
interface TwilioMarkMessage {
  event: 'mark';
  sequenceNumber: string;
  mark: { name: string };
}

type TwilioInboundMessage = TwilioStartMessage | TwilioMediaMessage | TwilioStopMessage | TwilioMarkMessage;

// ---- Audio conversion utilities ----

/** G.711 mulaw decode table — maps 8-bit mulaw byte to 16-bit PCM sample. */
const MULAW_DECODE_TABLE = new Int16Array(256);
{
  for (let i = 0; i < 256; i++) {
    let mu = ~i & 0xFF;
    const sign = (mu & 0x80) ? -1 : 1;
    mu = mu & 0x7F;
    const exponent = (mu >> 4) & 0x07;
    const mantissa = mu & 0x0F;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    MULAW_DECODE_TABLE[i] = sign * sample;
  }
}

/** Decode G.711 mulaw bytes to PCM int16 samples. */
function decodeMulaw(mulaw: Uint8Array): Int16Array {
  const pcm = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i++) {
    pcm[i] = MULAW_DECODE_TABLE[mulaw[i]!]!;
  }
  return pcm;
}

/** Encode PCM int16 samples to G.711 mulaw bytes. */
function encodeMulaw(pcm: Int16Array): Uint8Array {
  const mulaw = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    let sample = pcm[i]!;
    const sign = (sample < 0) ? 0x80 : 0;
    if (sample < 0) sample = -sample;
    if (sample > 32635) sample = 32635;
    sample += 0x84;
    let exponent = 7;
    const mask = 0x4000;
    for (; exponent > 0; exponent--) {
      if (sample & (mask >> (7 - exponent))) break;
    }
    const mantissa = (sample >> (exponent + 3)) & 0x0F;
    mulaw[i] = ~(sign | (exponent << 4) | mantissa) & 0xFF;
  }
  return mulaw;
}

/**
 * Resample PCM int16 from one sample rate to another (linear interpolation).
 * Good enough for 8kHz ↔ 16kHz voice. Not audiophile quality.
 */
function resampleLinear(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIdx = i * ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(idx0 + 1, input.length - 1);
    const frac = srcIdx - idx0;
    output[i] = Math.round(input[idx0]! * (1 - frac) + input[idx1]! * frac);
  }
  return output;
}

// ---- Voice Activity Detection ----

/** VAD configuration. */
export interface VADConfig {
  /** RMS energy threshold for speech (0-32768). Default 500. */
  energyThreshold: number;

  /** How many consecutive silent frames before we consider speech ended. Default 30 (600ms at 50fps). */
  silenceFrames: number;

  /** Minimum speech duration in ms to avoid triggering on clicks/noise. Default 300. */
  minSpeechMs: number;

  /** Frame size in samples for energy calculation. Default 160 (20ms at 8kHz). */
  frameSamples: number;

  /**
   * Whisper no_speech_prob threshold. If Whisper's verbose_json response
   * includes no_speech_prob > this value, the segment is likely silence/noise
   * and should be discarded. Default 0.6.
   *
   * This is a post-ASR check — the energy-based VAD decides when to send
   * audio to ASR, and then no_speech_prob acts as a second gate on the ASR
   * result. This catches cases where constant background noise (HVAC, road
   * noise on a phone call) fools the energy detector into thinking speech
   * is present.
   */
  noSpeechProbThreshold: number;
}

const DEFAULT_VAD_CONFIG: VADConfig = {
  energyThreshold: 500,
  silenceFrames: 30,
  minSpeechMs: 300,
  frameSamples: 160,
  noSpeechProbThreshold: 0.6,
};

/** VAD state machine: idle → speaking → trailing_silence → (emit) → idle */
type VADState = 'idle' | 'speaking' | 'trailing_silence';

/**
 * Energy-based Voice Activity Detector.
 *
 * Two-stage approach:
 *   1. **Energy VAD (real-time):** Computes RMS energy per frame on incoming
 *      audio. Transitions: idle→speaking when energy exceeds threshold,
 *      speaking→trailing_silence when energy drops, trailing_silence→idle
 *      (emitting the buffered speech) after enough consecutive silent frames.
 *
 *   2. **Whisper no_speech_prob (post-ASR):** After speech is sent to Whisper,
 *      check the `no_speech_prob` field in the verbose_json response. If it's
 *      above the threshold, discard the result — it was background noise that
 *      fooled the energy detector.
 *
 * The energy VAD is intentionally simple. Phone audio (G.711 mulaw, 8kHz) is
 * narrowband with relatively consistent levels, so energy thresholding works
 * better here than on wideband mic audio where background noise varies more.
 *
 * Future improvements:
 *   - Adaptive threshold (track running average of background energy)
 *   - Spectral features (ZCR, spectral centroid) for better noise rejection
 *   - WebRTC VAD (libfvad) for production quality
 *   - Silero VAD (ONNX model, ~3ms per frame) for best accuracy
 */
export class EnergyVAD {
  private state: VADState = 'idle';
  private config: VADConfig;

  /** Accumulated PCM samples during current speech utterance */
  private speechBuffer: Int16Array[] = [];

  /** Timestamp when speech started (for minSpeechMs check) */
  private speechStartMs = 0;

  /** Count of consecutive silent frames (for trailing silence detection) */
  private silentFrameCount = 0;

  /** Callback when a complete speech segment is detected */
  onSpeech: ((pcm: Int16Array, durationMs: number) => void) | null = null;

  constructor(config?: Partial<VADConfig>) {
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
  }

  /** Compute RMS energy of a PCM int16 frame. */
  private rmsEnergy(frame: Int16Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum += frame[i]! * frame[i]!;
    }
    return Math.sqrt(sum / frame.length);
  }

  /**
   * Feed PCM samples (8kHz int16) into the VAD.
   * Processes in frameSamples-sized chunks.
   */
  process(pcm: Int16Array, sampleRate: number): void {
    const frameSamples = this.config.frameSamples;
    const frameDurationMs = (frameSamples / sampleRate) * 1000;

    for (let offset = 0; offset + frameSamples <= pcm.length; offset += frameSamples) {
      const frame = pcm.subarray(offset, offset + frameSamples);
      const energy = this.rmsEnergy(frame);
      const isSpeech = energy >= this.config.energyThreshold;

      switch (this.state) {
        case 'idle':
          if (isSpeech) {
            this.state = 'speaking';
            this.speechBuffer = [new Int16Array(frame)];
            this.speechStartMs = Date.now();
            this.silentFrameCount = 0;
          }
          break;

        case 'speaking':
          this.speechBuffer.push(new Int16Array(frame));
          if (!isSpeech) {
            this.state = 'trailing_silence';
            this.silentFrameCount = 1;
          }
          break;

        case 'trailing_silence':
          this.speechBuffer.push(new Int16Array(frame));
          if (isSpeech) {
            // Speech resumed — go back to speaking
            this.state = 'speaking';
            this.silentFrameCount = 0;
          } else {
            this.silentFrameCount++;
            if (this.silentFrameCount >= this.config.silenceFrames) {
              // Enough silence — emit the speech segment
              this.emitSpeech(frameDurationMs);
              this.state = 'idle';
            }
          }
          break;
      }
    }
  }

  /** Flush any buffered speech (e.g. on call hangup). */
  flush(): void {
    if (this.speechBuffer.length > 0 && this.state !== 'idle') {
      this.emitSpeech(0);
      this.state = 'idle';
    }
  }

  private emitSpeech(_frameDurationMs: number): void {
    const durationMs = Date.now() - this.speechStartMs;
    if (durationMs < this.config.minSpeechMs) {
      // Too short — likely a click, cough, or noise burst
      this.speechBuffer = [];
      return;
    }

    // Concatenate all buffered frames
    const totalSamples = this.speechBuffer.reduce((sum, f) => sum + f.length, 0);
    const pcm = new Int16Array(totalSamples);
    let offset = 0;
    for (const frame of this.speechBuffer) {
      pcm.set(frame, offset);
      offset += frame.length;
    }
    this.speechBuffer = [];

    if (this.onSpeech) {
      this.onSpeech(pcm, durationMs);
    }
  }
}

/**
 * Check Whisper's no_speech_prob against the VAD threshold.
 *
 * Usage: after ASR returns a result, call this to decide whether to
 * pass the text to the LLM or discard it as background noise.
 *
 * Requires the ASR provider to return verbose_json format with
 * segment-level no_speech_prob values. The OpenAI ASR provider
 * currently uses response_format=json which doesn't include this —
 * switching to verbose_json is a prerequisite.
 *
 * @param noSpeechProb - Whisper's no_speech_prob for the segment (0-1)
 * @param threshold - Discard if above this value (default from VADConfig)
 * @returns true if the segment is likely real speech
 */
export function isLikelySpeech(noSpeechProb: number, threshold = DEFAULT_VAD_CONFIG.noSpeechProbThreshold): boolean {
  return noSpeechProb < threshold;
}

// ---- Twilio Transport adapter ----

/**
 * Transport implementation for Twilio Media Streams.
 *
 * Adapts Twilio's JSON-wrapped mulaw audio protocol to Worzel's Transport
 * interface (text + binary messages). The voice pipeline sees this as just
 * another transport — it doesn't know the audio came from a phone call.
 *
 * Audio flow:
 *   Twilio mulaw → decode → resample 8k→16k → pipeline (PCM binary)
 *   Pipeline (Opus binary) → Opus decode → resample 16k→8k → mulaw encode → Twilio
 *
 * Future work:
 *   - Barge-in detection (caller interrupts TTS playback)
 *   - DTMF handling (keypad input)
 *   - Call recording consent / announcement
 */
export class TwilioTransport implements Transport {
  readonly id: string;
  readonly type = 'twilio' as const;

  private _connected = false;
  private _streamSid: string | null = null;
  private _callSid: string | null = null;
  private readonly vad: EnergyVAD;
  private readonly logger: pino.Logger;

  /**
   * Called when VAD detects a complete speech segment.
   * The WebSocket handler sets this to push audio into the pipeline
   * and trigger processing (replaces the listen.stop mechanism).
   * Receives 16kHz PCM int16 as a Buffer.
   */
  onSpeechSegment: ((pcm: Buffer, durationMs: number) => void) | null = null;

  private textHandlers: ((data: string) => void)[] = [];
  private binaryHandlers: ((data: Buffer) => void)[] = [];
  private closeHandlers: ((code: number, reason: string) => void)[] = [];
  private errorHandlers: ((error: Error) => void)[] = [];

  constructor(
    private readonly ws: WebSocket,
    logger: pino.Logger,
    vadConfig?: Partial<VADConfig>,
  ) {
    this.id = `twilio-${Date.now()}`;
    this.logger = logger.child({ component: 'twilio-bridge' });
    this.vad = new EnergyVAD(vadConfig);

    // When VAD detects speech, resample and forward to pipeline
    this.vad.onSpeech = (pcm, durationMs) => {
      this.logger.info({ durationMs, samples: pcm.length }, 'VAD speech segment detected');
      // Resample 8kHz → 16kHz to match Worzel pipeline expectation
      const pcm16k = resampleLinear(pcm, 8000, 16000);
      const pcmBuf = Buffer.from(pcm16k.buffer, pcm16k.byteOffset, pcm16k.byteLength);
      if (this.onSpeechSegment) {
        this.onSpeechSegment(pcmBuf, durationMs);
      }
    };

    // Wire up Twilio WebSocket messages
    ws.on('message', (data: string) => {
      try {
        const msg = JSON.parse(data) as TwilioInboundMessage;
        this.handleTwilioMessage(msg);
      } catch (err) {
        this.logger.warn({ err }, 'Failed to parse Twilio message');
      }
    });

    ws.on('close', (code: number) => {
      this._connected = false;
      this.vad.flush();
      for (const handler of this.closeHandlers) handler(code, 'twilio stream ended');
    });

    ws.on('error', (err: Error) => {
      for (const handler of this.errorHandlers) handler(err);
    });
  }

  get connected(): boolean {
    return this._connected;
  }

  get streamSid(): string | null {
    return this._streamSid;
  }

  get callSid(): string | null {
    return this._callSid;
  }

  private handleTwilioMessage(msg: TwilioInboundMessage): void {
    switch (msg.event) {
      case 'start':
        this._streamSid = msg.start.streamSid;
        this._callSid = msg.start.callSid;
        this._connected = true;
        this.logger.info({
          streamSid: this._streamSid,
          callSid: this._callSid,
        }, 'Twilio stream started');
        // Synthesize a hello message for the session manager
        const hello = JSON.stringify({
          type: 'hello',
          transport: 'websocket',
          version: 3,
          audio_params: {
            format: 'pcm',
            sample_rate: 16000,
            channels: 1,
          },
        });
        for (const handler of this.textHandlers) handler(hello);
        break;

      case 'media':
        if (msg.media.track === 'inbound') {
          // Decode base64 → mulaw → PCM int16 at 8kHz
          const mulaw = new Uint8Array(Buffer.from(msg.media.payload, 'base64'));
          const pcm8k = decodeMulaw(mulaw);
          // Feed into VAD — it will call onSpeech when it detects an utterance
          this.vad.process(pcm8k, 8000);
        }
        break;

      case 'stop':
        this.logger.info({ callSid: this._callSid }, 'Twilio stream stopped (caller hung up)');
        this._connected = false;
        this.vad.flush();
        for (const handler of this.closeHandlers) handler(1000, 'caller hung up');
        break;

      case 'mark':
        this.logger.debug({ mark: msg.mark.name }, 'Twilio mark received');
        break;
    }
  }

  /** Send JSON control message — forwarded to text handlers (not sent to Twilio). */
  async sendText(data: string): Promise<void> {
    // Control messages from the pipeline (tts:start, tts:stop, etc.)
    // Not forwarded to Twilio — used internally for pipeline state management.
    this.logger.debug({ data }, 'Pipeline text message (not forwarded to Twilio)');
  }

  /**
   * Send TTS audio back to the caller via Twilio.
   * Pipeline sends Opus frames; we decode → resample → mulaw → base64 → Twilio JSON.
   *
   * The voice pipeline's sendOpusAudio() encodes TTS PCM into Opus at 16kHz
   * and sends each frame via transport.sendBinary(). We decode each Opus frame
   * back to PCM, resample to 8kHz, and encode as mulaw for Twilio.
   */
  async sendBinary(data: Buffer | Uint8Array): Promise<void> {
    if (!this._connected || !this._streamSid) return;

    // Decode Opus frame → PCM int16 at 16kHz (pipeline encodes at 16kHz)
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    let pcm: Buffer;
    try {
      pcm = decodeOpusFrames([buf]);
    } catch {
      // If decode fails, skip this frame (corrupted packet)
      return;
    }
    if (pcm.length === 0) return;

    // Convert Buffer (int16 LE bytes) to Int16Array for resampling
    const pcm16k = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);

    // Resample 16kHz → 8kHz for PSTN
    const pcm8k = resampleLinear(pcm16k, 16000, 8000);

    // Encode to mulaw
    const mulaw = encodeMulaw(pcm8k);

    // Send as Twilio media message
    const msg = JSON.stringify({
      event: 'media',
      streamSid: this._streamSid,
      media: {
        payload: Buffer.from(mulaw).toString('base64'),
      },
    });

    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(msg);
    }
  }

  close(code = 1000, reason = 'normal'): void {
    this._connected = false;
    this.vad.flush();
    this.ws.close(code, reason);
  }

  onText(handler: (data: string) => void): void { this.textHandlers.push(handler); }
  onBinary(handler: (data: Buffer) => void): void { this.binaryHandlers.push(handler); }
  onClose(handler: (code: number, reason: string) => void): void { this.closeHandlers.push(handler); }
  onError(handler: (error: Error) => void): void { this.errorHandlers.push(handler); }
}

// ---- TwiML generation ----

/**
 * TwiML response that tells Twilio to open a Media Stream to our WebSocket.
 * Served at POST /api/telephony/twiml — Twilio calls this when someone dials.
 */
export function generateTwiml(websocketUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Welcome to Worzel. You can start speaking after the tone.</Say>
  <Connect>
    <Stream url="${websocketUrl}" />
  </Connect>
</Response>`;
}

// ---- Twilio request signature validation ----

/**
 * Validate a Twilio webhook request signature.
 *
 * Twilio signs every webhook request with HMAC-SHA1 of:
 *   URL + sorted POST parameters (key + value concatenated)
 * keyed by your auth token. The signature is in the X-Twilio-Signature header.
 *
 * See: https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  // Build the data string: URL + sorted params (key + value, no separators)
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const expected = createHmac('sha1', authToken)
    .update(data, 'utf-8')
    .digest('base64');

  // Constant-time comparison to prevent timing attacks
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}
