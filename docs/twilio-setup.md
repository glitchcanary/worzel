# Twilio PSTN Setup Guide

Wire Worzel to a phone number so callers can talk to it via plain old telephone.

## Prerequisites

- Twilio account (https://www.twilio.com/)
- Worzel server running with a public URL (Tailscale Funnel works)
- `WORZEL_TWILIO_ACCOUNT_SID` and `WORZEL_TWILIO_AUTH_TOKEN` in `.env`

## Twilio Console Setup

1. **Buy a phone number** (if you don't have one):
   - Twilio Console → Phone Numbers → Buy a Number
   - Pick any local number with Voice capability (~$1/mo)

2. **Configure the voice webhook**:
   - Phone Numbers → Manage → Active Numbers → click your number
   - Under "Voice & Fax" → "A Call Comes In":
     - Webhook: `https://raz17.tailaf2e8d.ts.net/api/telephony/twiml`
     - Method: HTTP POST
   - Save

3. **Note your credentials** (Twilio Console → Account Info):
   - Account SID: `AC...`
   - Auth Token: (click to reveal)

## Server Configuration

Add to `/home/danbri/working/worzel/.env`:

```
WORZEL_TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WORZEL_TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## What Happens When Someone Calls

```
1. Caller dials your Twilio number
2. Twilio POST → /api/telephony/twiml
3. Server returns TwiML:
     <Say>Welcome to Worzel...</Say>
     <Connect><Stream url="wss://raz17.tailaf2e8d.ts.net/ws/twilio" /></Connect>
4. Twilio opens WebSocket to /ws/twilio
5. Twilio streams caller audio (8kHz G.711 mulaw, JSON-wrapped, base64)
6. TwilioTransport decodes mulaw → PCM, resamples 8k→16k
7. EnergyVAD detects speech boundaries (no push-to-talk on phones)
8. Complete utterance → voice pipeline (ASR → LLM → TTS)
9. TTS audio → resample 24k→8k → mulaw encode → Twilio WebSocket
10. Twilio plays audio to caller
```

## Implementation Status

### Done (in `src/telephony/twilio-bridge.ts`)

- [x] `TwilioTransport` — implements `Transport` interface for Twilio Media Streams
- [x] `EnergyVAD` — real-time energy-based voice activity detection
- [x] `isLikelySpeech()` — post-ASR gate using Whisper `no_speech_prob`
- [x] G.711 mulaw encode/decode
- [x] Linear resampler (8kHz ↔ 16kHz ↔ 24kHz)
- [x] `generateTwiml()` — TwiML XML response generator
- [x] Twilio Media Streams JSON protocol parsing (start/media/stop/mark)

### TODO (server wiring)

- [ ] **TwiML webhook route** — `POST /api/telephony/twiml` in `src/server/http.ts`
  - Returns TwiML XML pointing Twilio at the WebSocket endpoint
  - Must validate Twilio request signature (prevent spoofed webhooks)
  - Signature validation: `X-Twilio-Signature` header, HMAC-SHA1 of URL + sorted POST params with auth token as key
  - npm package: `twilio` (official SDK) has `validateRequest()`, or implement manually (~20 lines)

- [ ] **Twilio WebSocket endpoint** — `/ws/twilio` in `src/server/websocket.ts`
  - New WebSocket upgrade path alongside existing `/ws?token=` for device clients
  - On connection: create `TwilioTransport`, `Session`, wire to `VoicePipeline`
  - No token auth needed — Twilio connections are authenticated by the TwiML webhook signature
  - Pass same `providers` (ASR, LLM, TTS) as device sessions

- [ ] **VAD → pipeline trigger** — automatic `process()` on speech detection
  - Existing flow: client sends audio frames → `pushAudio()` → `listen.stop` → `process()`
  - Twilio flow: VAD detects complete utterance → push PCM → trigger `process()` automatically
  - The `TwilioTransport.onSpeech` callback needs to synthesize a `listen.stop` message or call pipeline directly
  - Pipeline already accepts `format: 'pcm'` in hello handshake — no Opus needed for telephony path

- [ ] **Barge-in detection** — caller talks over TTS
  - When caller speaks while TTS is playing, stop TTS immediately
  - Send Twilio `clear` message to flush queued audio
  - Restart VAD listening

- [ ] **DTMF handling** — keypad input
  - Twilio can send DTMF events in the Media Stream
  - Map to commands: e.g. `#` to end call, `*` for menu
  - Lower priority — voice is the primary interface

- [ ] **Call recording consent** — legal requirement in many jurisdictions
  - Two-party consent states (CA, FL, etc.) require announcement
  - Add to TwiML `<Say>` before `<Connect>`

## Audio Format Notes

| Stage | Format | Sample Rate | Notes |
|-------|--------|-------------|-------|
| PSTN (Twilio) | G.711 mulaw | 8kHz | Narrowband telephone audio |
| Worzel pipeline input | PCM int16 | 16kHz | After mulaw decode + resample |
| Whisper ASR | WAV (PCM) | 16kHz | Pipeline wraps PCM in WAV header |
| TTS output | PCM int16 | 24kHz | OpenAI TTS native rate |
| Back to Twilio | G.711 mulaw | 8kHz | After resample + mulaw encode |

The telephony path skips Opus entirely — no point encoding to Opus just to decode again. The pipeline's `format: 'pcm'` mode handles this.

## VAD Tuning

Phone audio (G.711, 8kHz) is narrowband with relatively consistent levels, so energy-based VAD works better here than on wideband mic audio. Default settings in `EnergyVAD`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `energyThreshold` | 500 | RMS energy for speech (0-32768). Lower = more sensitive. |
| `silenceFrames` | 30 | Silent frames before end-of-speech (30 × 20ms = 600ms). |
| `minSpeechMs` | 300 | Minimum utterance duration. Rejects clicks/coughs. |
| `noSpeechProbThreshold` | 0.6 | Whisper's no_speech_prob gate. Higher = more permissive. |

If callers report the bot cutting them off mid-sentence, increase `silenceFrames`. If it's too slow to respond, decrease it. The 600ms default is a starting point — real-world tuning needs phone testing.

## Cost Estimate

| Item | Cost |
|------|------|
| Twilio phone number | ~$1.15/mo |
| Inbound call minutes | ~$0.0085/min |
| Outbound (if we call back) | ~$0.014/min |
| ASR (Whisper) | ~$0.006/min |
| TTS (OpenAI) | ~$0.015/1K chars |
| LLM | Varies by provider |

A 2-minute call costs roughly $0.05-0.10 total.

## Testing Without a Phone Number

For development, use Twilio's test credentials (no real calls):
- Test Account SID and Auth Token from Twilio Console → Account Info
- Or use `ngrok` / Tailscale Funnel to expose localhost and call your real number

Alternatively, test the VAD and audio pipeline locally by feeding recorded phone audio through the `EnergyVAD` class directly.
