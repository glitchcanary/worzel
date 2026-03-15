# Worzel Architecture Overview

## Origin

This document grew from a design conversation and subsequent codebase review. The original design notes are preserved here for context.

### Designer's Brief (to ChatGPT, which did not have codebase access)

> Worzel is a draft software system whose backend middleware assembles voice-AI interactions from mixed local and cloud components. Current and planned components include ASR, LLM, and TTS from sources such as OpenAI TTS, ElevenLabs, OpenAI ChatGPT API, Anthropic, local models, ESP Whisper, and eventually browser APIs. There are in-progress clients for both the web platform and ESP32.
>
> A central concern is how this architecture copes with contemporary voice/AI realities. Large providers increasingly offer unified multimodal services where ASR, reasoning, and TTS inform each other directly instead of being forced through discrete text bottlenecks. Worzel must be able to integrate such compelling fused offerings rather than assuming a fully decomposed pipeline.
>
> TTS caching is important. In contexts such as VoiceXML-like flows, games, toys, weather/news reading, and repeated action phrases, the same text may be spoken many times in the same chosen voice or voice family. Worzel therefore needs a careful, GDPR-ready design for caching and reusing speech output.
>
> For authored interaction, the project is not centered on VoiceXML itself, but on Inkle's Ink scripting language and a FINK variant that adds hypertext and extra annotations for voice, widgets, and media. The middleware server can already enable a plugin that uses Ink to structure conversation and keep creativity within bounds.
>
> Worzel also needs to integrate actions and external capabilities such as IoT and web APIs. Examples include an AI toy allowing users or story scripts to control its LEDs, searching for a song and playing it, or looking up a city and returning its weather.
>
> Audio output may come not only from directly controlled speakers but also from independent external systems such as Sonos, Google, Apple equipment, or more generally via MCP and Home Assistant. A game or narrative might want to lower lights as mood changes, play foley or soundtrack, and take advantage of stereo or spatial/3D positioning when available, for example in WebXR.
>
> The system may also need awareness of, and recognition of, multiple human speakers. More broadly, there may be multiple participants in the scene, including AI participants. One concrete example is using a modern AI on a smartphone to help generate and speak aloud the trigger word and phrase needed for Google or Apple systems to play a song. In practice this led to brittle hacks such as telling the system to ignore words from music until a nonsense phrase like "yellow-potato-thursday" is heard, to avoid interference from loosely joined parts.

### Design Priorities (from ChatGPT review, endorsed)

1. **Fused multimodal providers are a strategic integration requirement.** The architecture must gracefully host offerings where ASR, TTS, reasoning, and turn-taking are tightly coupled.
2. **The self-interference problem is not theoretical.** Treat the yellow-potato-thursday scenario as a concrete multi-agent coordination and mode-boundary problem.
3. **Media/actuation targets are specific.** Sonos, Google, Apple playback; Home Assistant / MCP routing; toy LEDs; soundtrack; foley; light changes; stereo; spatial/WebXR. Not a generic abstraction.
4. **Ink/FINK bounded generation is central.** Authored structure constraining LLM improvisation: scripted anchors, controlled branching, rejoin points, media/widget annotations, limited improvisation inside those boundaries.

---

## Architecture

Worzel is backend middleware that assembles voice-AI interactions from mixed local and cloud components. It doesn't own the models, the hardware, or the ears — it sits between them and makes them work together.

The current implementation is a streaming voice pipeline (ASR → LLM → TTS) served over WebSocket, with clients for ESP32 and the browser. But the architecture must not assume this decomposed pipeline is the only shape voice-AI will take.

---

## What Exists Today

### The Voice Pipeline

A three-stage streaming pipeline with pluggable providers at each stage.

| Stage | Providers | Status |
|-------|-----------|--------|
| ASR | OpenAI Whisper, Groq Whisper | Working |
| LLM | Ollama (local), OpenAI, Anthropic Claude | Working |
| TTS | OpenAI tts-1, Edge TTS, ElevenLabs | Working |
| TTS (planned) | Piper, Kokoro (local) | Stubs |

Providers implement simple interfaces (`transcribe`, `chat`, `synthesize`) registered through `src/providers/registry.ts`. Configuration is per-stage via environment variables, with an endpoint allowlist for security.

**Dual-LLM composition.** The pipeline already isn't rigidly linear. A fast model (e.g. Ollama local) streams response segments immediately. A smarter model (e.g. Claude) runs in parallel. The `SegmentTracker` knows which segments have been sent to TTS and which haven't — the smart model can replace unsent segments or append spoken corrections for ones already delivered. This is the existing proof that the pipeline can accommodate non-trivial provider composition.

**Latency masking.** A filler cache pre-generates 25 short phrases ("Hmm.", "Yeah.", "Let me think.") as Opus audio at startup. These play during the ASR→LLM gap so the user hears acknowledgment, not silence.

**Text segmentation.** LLM output is split at sentence boundaries into TTS-sized chunks for progressive audio delivery. First segment splits aggressively (at commas) to minimise time-to-first-audio.

### The Protocol

WebSocket-based, inspired by the xiaozhi protocol (message shapes, not the full spec — no MQTT, no device binding).

**Inbound:** `hello` (handshake + audio param negotiation), `listen` (recording state), `abort` (barge-in), `iot` (device descriptors), `mcp` (tool protocol), `ping`, `goodbye`.

**Outbound:** `hello` (server handshake), `stt` (transcript), `tts` (audio state: start/sentence_start/sentence_end/stop), `pipeline_telemetry` (timing and segment data), `pong`.

**Audio:** Binary Opus frames over the same WebSocket. 16kHz mono, 60ms frames, 24kbps. Negotiated during hello.

All message types are Zod-validated (`src/protocol/`).

### Session Model

One session per device. State machine: `connecting → ready → listening → processing → closed`, with listening substates (`idle`, `detecting`, `recording`).

Sessions carry dialogue history (`{role, content, timestamp}[]`), audio parameters, and an `AbortController` for pipeline interruption. SessionManager enforces idle timeouts (default 120s), max concurrent sessions (100), and one-session-per-device.

### Fink: Voice-Navigable Interactive Fiction

One of the most developed subsystems. Fink combines Inkle's Ink scripting language with voice UI and LLM-powered discussion.

**InkSession** wraps inkjs with tag parsing (speaker, voice, mood, voice hints), state serialization, and choice management.

**InkRouter** classifies every utterance into one of six categories:
- `choice_match` — user selected a story choice (advance the narrative)
- `discussion` — in-character question (LLM responds within narrative context)
- `meta_query` — "what are my options?" (LLM describes choices naturally)
- `skip_ahead` — "skip this" (brief summary, move on)
- `freeform_input` — story waiting for raw text input
- `no_match` — unrecognized (LLM gently redirects)

**Voice profiles** map semantic IDs ("narrator", "detective") to provider-specific voices. Ink stories stay provider-neutral; resolution happens at runtime via metadata and tags.

**finkLinks** enable cross-story navigation with a backstack — jump to another story, then return.

Served on `/ws/fink` via the unified server.

### Tools and IoT

**ToolRegistry** (`src/providers/tools/`) with builtin tools (weather, Home Assistant) and an MCP bridge for device-discovered tools.

**IoT device descriptors** arrive via the `iot` message type. Clients declare their capabilities (e.g. a light with a toggle method and brightness parameter). These become callable tools for the LLM.

### TTS Caching

`CachedTTSProvider` wraps all TTS providers with disk-based caching.

- **Key:** `provider:model:voice:speed:text`
- **Scope:** `persistent` (survives restarts), `volatile`, `none`
- **TTL:** Configurable per call
- **Location:** `tmp/tts-cache/`

### Clients

**ESP32** — `esp32-client/` firmware for Waveshare boards. Hardware I2S audio, Opus codec, WiFi transport.

**Browser** — Web Components client (`src/web-client/`). WebCodecs Opus encoding, AudioWorklet for real-time PCM capture.

### Transport and Telephony

**WebSocketTransport** — primary transport for ESP32 and browser clients.

**TwilioTransport** — PSTN phone call bridge (`src/telephony/twilio-bridge.ts`). Served on `/ws/twilio` with TwiML webhook at `/api/telephony/twiml`.

**WebRTC** — WHIP signaling endpoint exists as a stub. Not implemented.

### Auth and Security

OTA token flow: device POSTs to `/api/ota`, receives HMAC-SHA256 token, connects WebSocket with token. Timing-safe verification. Rate limiting per IP and per device. Endpoint allowlist prevents arbitrary provider URLs. Secret redaction in logs.

### Observability

Pino structured logging with per-session child loggers. Pipeline telemetry events: `asr_complete`, `llm_segment`, `filler_played`, `pipeline_complete`, `smart_correction`. Debug audio dump mode (`WORZEL_DEBUG_AUDIO=1`).

---

## Design Concerns

These are problems we've encountered that the architecture must address. They aren't speculative — they come from real use and real frustration.

### Hosting Fused Providers

Large providers increasingly offer unified multimodal services where ASR, reasoning, and TTS inform each other directly — GPT-4o voice mode, Gemini Live, and whatever comes next. These may be too compelling to ignore.

Worzel must be able to **gracefully host** such offerings. This doesn't mean worzel becomes a fused provider. It means the pipeline abstraction can't assume three discrete stages with text as the only interface between them. A fused provider might handle the full turn as a single call, or handle ASR+LLM while worzel does TTS, or any other split.

The dual-LLM pattern shows the pipeline is already flexible. The next step is defining what a provider interface looks like when it spans stages — a `VoiceProvider` that accepts audio and emits audio, with text as an observable side-effect rather than the mandatory bottleneck.

### Multi-Device Audio Coordination

When worzel coexists with Sonos, Google Home, Apple speakers — all producing audio in the same physical space — loosely joined parts interfere with each other.

A concrete scenario: using worzel on a phone to speak a wake phrase and request to trigger Google Home music playback. The music then feeds back into ASR. The workaround was telling worzel to ignore all audio until a nonsense phrase ("yellow-potato-thursday") was heard. This is a mode-boundary problem — the system needs to know when it's in a "someone else is playing audio" state.

Current barge-in handling (`abort` message, `AbortController`) manages worzel's own output. The open problem is awareness of *other* audio sources in the space. The server knows what it's outputting but not what other devices are doing. Possible approaches: client-side energy detection, explicit mode signals from Home Assistant, or treating it as a scene-level concern.

### GDPR-Ready TTS Caching

TTS caching is implemented but not GDPR-ready. In contexts like interactive fiction, games, toys, weather reading, and repeated action phrases, the same text gets spoken many times in the same voice. Caching is essential for latency and cost.

GDPR compliance needs:
- **Per-user cache isolation** — cache keys currently don't include user identity; user A's cache can serve user B
- **Right to deletion** — no mechanism to purge a user's cached audio
- **Retention policies** — no automatic expiry aligned with data protection requirements
- **Consent tracking** — no record of whether caching was consented to

The "voice family" concept (caching across similar voices) is also unimplemented.

### Bounded Generation: Ink as Governance

"Bounded generation" doesn't mean token limits. It means **authored structure constraining LLM improvisation.** Ink provides scripted anchors, controlled branching, rejoin points, and character boundaries. The LLM fills in natural-language discussion and in-character responses, but within the narrative rails the author laid down.

This is runtime governance: the Ink story is the authority on what can happen next, and the LLM is a performer working within that authority. Without it, the LLM could take conversations anywhere. With it, creativity stays within bounds.

Current implementation handles this well for voice interaction. The gap is in the fuller FINK vision: media annotations (play this sound effect here), widget annotations (show this image), and richer runtime directives beyond voice and text.

---

## Future Capabilities

These are valid goals that need design work before implementation.

### Scene Modelling

A **scene** would represent the physical and conversational context above the session level: who's in the room, what devices are available, what ambient state applies, what audio sources are active.

Sessions are device-scoped (one ESP32 = one session). Scenes would be space-scoped (one room = one scene, potentially spanning multiple devices and sessions).

Use cases driving this:
- A Fink narrative that dims lights as mood darkens (scene knows about the lights)
- Routing a music request to the right speaker (scene knows what's available)
- Suppressing ASR during external audio playback (scene tracks audio state)

The session model is the foundation this would build on.

### Multi-Participant

**Multiple humans:** Speaker diarization to distinguish who's talking. Not implemented; would require ASR providers that support it or client-side pre-processing.

**Multiple AI participants:** Routing and delegation between AI agents with different capabilities or personalities. Fink already performs multiple character voices through one pipeline — real multi-AI would mean separate reasoning contexts cooperating.

**Cross-system coexistence:** The "yellow-potato-thursday" problem. Worzel can't control Google Home or Apple — it can only try to coexist. This is fundamentally different from multi-participant within worzel's own domain and may need to be treated as a scene-level coordination problem rather than a participant-management problem.

### Media, Foley, and Spatial Audio

Concrete targets, not a generic abstraction:
- **Playback routing** — play a song on Sonos, or on the ESP32 speaker, or in the browser, depending on what's available. Via Home Assistant / MCP.
- **Soundtrack and foley** — Fink narratives that play sound effects, background music, ambient audio. Needs Ink tags for media cues and a media player concept in the pipeline.
- **Spatial/3D audio** — stereo positioning, WebXR integration when available. Browser client could support this; ESP32 likely can't.
- **LED and physical actuation** — toy LEDs controlled by story scripts or user commands. Works in principle through IoT device methods but needs authoring tools (Ink tags for LED cues, like voice tags for TTS).

### Local-First and Hybrid

The provider registry already supports local models (Ollama) alongside cloud providers. Future work:
- **Local ASR** — faster-whisper, browser Web Speech API
- **Local TTS** — Piper, Kokoro
- **Hybrid routing** — use local when fast/cheap matters, cloud when quality matters. The dual-LLM pattern is a model for this.

---

## Operational Expectations

Components and capabilities are documented above. This section defines what a working session must **survive** — the contract that tests, contributors, and AI agents should build against.

### Mic and Audio Session

- Mic permission is requested **once** per session. The MediaStream and AudioContext persist across recording cycles.
- Hot-mic mode may cycle 100+ times in a session without resource leaks, permission re-prompts, or AudioContext exhaustion.
- AudioContext suspension (browser policy) is handled by resuming, not recreating.

### Choice Matching (InkRouter)

- ASR output is messy. The router must tolerate: filler words ("uh", "like"), trailing politeness ("please"), leading intent phrases ("I want to", "let me"), stuttered/repeated words, and minor word order variation.
- A user who says the gist of a choice — not the exact words — should match. Exact wording is not expected from speech.
- Genuinely ambiguous input (matching two choices equally) should fall through to LLM classification or no_match, not pick one arbitrarily.
- Genuinely unrelated input should not false-positive match a choice.

### Session Durability

- A Fink session should remain coherent across 20+ turns with a mix of exact matches, near-misses, and unrecognizable input.
- Pipeline state (`_isSpeaking`, recording state, abort state) must stay consistent even if TTS drops mid-stream, WebSocket reconnects, or the user barge-ins during narration.
- No single bad ASR result should break the session — no_match is a valid outcome, not a crash.

### Client Code

- Audio, WebSocket, and codec logic shared between clients (`src/web-client/` and `fink/client/`) must not diverge. Bug fixes apply to both. Duplication is tracked as debt.

---

## Next Steps

1. Turn the "what exists" section into a typed internal schema and interface spec. The current TypeScript types (Session, DialogueEntry, AudioParams, NarrationSegment, InkChoice) are adequate for today but won't support scenes, multi-participant, or media without extension.
2. Extract shared audio module from duplicated web client code.
3. Add session-level integration tests that simulate multi-turn Fink sessions with ASR-realistic input.
