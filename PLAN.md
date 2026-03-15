# Review: proposed-arch-overview.md vs Actual Codebase

## Context

The proposed overview is a ChatGPT summary of a conversation where the designer raised use cases encountered with worzel and nearby projects. ChatGPT did not have codebase access — it organized the problems and scenarios as presented. Recent Fink work was done by Codex (OpenAI). The protocol is xiaozhi-*inspired* (WebSocket message shapes) not a full xiaozhi implementation (no MQTT, no device binding).

The designer's original framing (quoted below for reference) is richer than what the summary captured:

> Worzel is a draft software system whose backend middleware assembles voice-AI interactions from mixed local and cloud components. [...] A central concern is how this architecture copes with contemporary voice/AI realities. Large providers increasingly offer unified multimodal services where ASR, reasoning, and TTS inform each other directly instead of being forced through discrete text bottlenecks.

This review maps the use cases against what worzel currently implements.

---

## Section-by-Section Mapping

### 1. "Core Architectural Thesis"

The doc lists topic areas but doesn't state the thesis the designer articulated: **worzel is backend middleware that assembles voice-AI interactions from mixed local and cloud components.** The codebase implements this as a streaming pipeline (ASR→LLM→TTS) over WebSocket, with pluggable providers per stage and clients for ESP32 and browser.

**Action:** Lead the doc with the designer's own framing. The middleware identity — assembling components rather than being one — is the key insight.

---

### 2. "Fused vs Decomposed Provider Models"

This is the designer's central strategic concern, not just an architecture pattern. The point is: GPT-4o voice mode, Gemini Live, and similar services are fused — ASR, reasoning, and TTS inform each other directly. A middleware that *only* supports decomposed pipelines risks becoming irrelevant if the best providers are fused.

Worzel currently implements **decomposed only** — pluggable providers per stage. There's no fused mode. The **dual-LLM (fast + smart) pattern** is an existing form of provider composition worth noting: a fast model streams immediately while a smarter model runs in parallel and can replace unsent segments or append corrections. This shows the pipeline already isn't rigidly linear.

**Action:** Preserve this as a first-class design concern. The question isn't "fused or decomposed" but "how does the pipeline abstraction accommodate both without forcing everything through a text bottleneck?" The dual-LLM pattern is evidence the architecture can be flexible here.

---

### 3. "Audio Edge and Self-Interference"

The designer's concrete scenario: using a smartphone AI to speak a wake word to a Google speaker, then needing a nonsense phrase ("yellow-potato-thursday") to resync because the music interfered with ASR. This is a **multi-device audio coordination** problem — loosely joined audio systems interfering with each other.

In the current codebase:
- **Barge-in/abort:** Implemented — `abort` message interrupts the pipeline via `AbortController`
- **Audio rate control:** `AudioRateController` paces Opus frame delivery
- **Echo/self-interference:** Not handled server-side. ESP32 hardware separates mic/speaker via I2S. Browser relies on OS-level AEC.

The real gap is: when worzel coexists with Sonos, Google Home, Apple devices — all producing audio in the same physical space — who coordinates? The server knows what it's outputting but not what other devices are doing. This is genuinely hard.

**Action:** Keep and expand. Frame around the multi-device coexistence problem, not just echo cancellation. Note what's implemented (abort, rate control) and the open problem of cross-device audio awareness.

---

### 4. "Ink/FINK and Bounded Generation"

The designer's framing of "bounded generation" is specific: **Ink keeps creativity within bounds.** This isn't about token limits — it's about authored narrative structure constraining LLM improvisation. Ink provides the skeleton (story flow, choices, character voices), and the LLM fills in discussion and natural language within that structure. Without Ink, the LLM could go anywhere; with it, conversations stay within the author's intent.

Fink is one of the most developed subsystems (built out substantially by Codex). It includes: InkSession, InkRouter (3-tier utterance classification: choice_match, discussion, meta_query, skip_ahead, freeform_input, no_match), InkPipeline, voice profiles, choice matching, and cross-story linking via finkLinks.

The doc also mentions "a FINK variant that adds hypertext and extra annotations for voice, widgets, and media." The codebase has the voice annotations (Ink tags for speaker, voice, mood, voice hints) and hypertext (finkLinks for cross-story navigation). Widgets and media annotations are not yet implemented.

**Action:** This is a strength. Document Fink's current capabilities, the "bounded generation" design philosophy (Ink as authorial guardrails for LLM), and the gap between current voice/hypertext annotations and the fuller vision of widgets and media in FINK.

---

### 5. "TTS Caching and Privacy"

The designer's use cases are specific: VoiceXML-like flows, games, toys, weather/news reading, repeated action phrases — contexts where the same text gets spoken many times in the same voice. "GDPR-ready" isn't vague privacy concern, it's a concrete compliance requirement for European deployment.

TTS caching is well-implemented: `CachedTTSProvider` wraps all TTS providers with disk-based caching (keyed by provider:model:voice:speed:text, scope: persistent/volatile/none, configurable TTL). The filler cache pre-generates 25 acknowledgment phrases at startup.

Gaps:
- Cache keys don't include user/device identity — no multi-tenant isolation
- No GDPR-specific provisions (right to deletion, data retention policies, consent tracking)
- No cache analytics (hit rates, storage growth, cost savings)
- The "voice family" concept (caching across similar but not identical voices) isn't implemented

**Action:** Document the caching implementation. Add GDPR compliance as a concrete requirement, not an abstract privacy note. The designer flagged this deliberately.

---

### 6. "Tools, IoT, Media, and Actuation"

The designer's examples are vivid and specific:
- An AI toy whose LEDs can be controlled by users or story scripts
- Searching for a song and playing it
- Looking up a city and returning its weather
- A narrative that lowers lights as mood changes, plays foley/soundtrack
- Stereo or spatial/3D audio positioning, potentially in WebXR

Current codebase:
- **IoT:** Implemented — `iot` message type for device descriptors, Home Assistant builtin tool
- **Tools:** Implemented — `ToolRegistry`, builtin tools (weather, Home Assistant), MCP bridge
- **Media/foley/spatial:** Not implemented. TTS is the only audio output. No concept of background audio, sound effects, spatial positioning, or external speaker control (Sonos, Google, Apple)
- **LED/actuator control:** Only through IoT device methods — works in principle but no toy-specific integration

The gap between "weather lookup" (works today) and "lower the lights and play foley in 3D" (needs major design) is enormous. The doc is right to group these as a use-case cluster, but the maturity spread needs to be visible.

**Action:** Document with concrete maturity levels. Separate "works now" (weather, basic IoT, Home Assistant) from "needs design" (media playback, foley, spatial audio, external speaker routing, WebXR integration).

---

### 7. "Scene Modelling and Routing"

The designer describes scenes implicitly: a room with people, devices, AI participants, environmental state. The Ink narrative examples (lowering lights as mood changes) assume a scene model even if the word isn't used.

No scene model exists in the codebase. What exists:
- **Sessions** — one per device, state machine (connecting→ready→listening→processing→closed)
- **Dialogue history** — `{role, content, timestamp}[]`
- **Fink's InkRouter** — classifies utterances for narrative routing

A scene model would sit above sessions: "this room has these devices, these people, these AI participants, and this environmental state." Sessions are device-scoped; scenes would be space-scoped.

**Action:** Keep as a design area. The designer's use cases (narrative mood affecting room lights, multiple devices in a space) define what a scene model would need to do. Document sessions as the existing foundation.

---

### 8. "Multi-Speaker / Multi-AI Participation"

The designer's examples are concrete:
- Multiple humans in a household speaking to the same system
- Using one AI (on phone) to trigger another AI's wake word (Google/Apple) — the "yellow-potato-thursday" problem
- AI participants alongside human participants in a shared scene

Not implemented. The codebase is single-speaker, single-AI per session. Fink uses multiple TTS voices for different characters, but that's one AI performing multiple roles.

The "yellow-potato-thursday" scenario reveals the real challenge: these aren't neatly coordinated systems. They're loosely joined, each with their own wake word, ASR, and audio output. Worzel can't control Google Home — it can only try to coexist with it. This is fundamentally different from "multi-AI routing" within worzel's own domain.

**Action:** Keep with the designer's concrete scenarios. Distinguish between multi-participant within worzel (needs design: diarization, routing, delegation) and multi-system coexistence (a coordination problem with external systems worzel doesn't control).

---

### 9. "Observability, Policy, and Internal Object Model"

- **Observability:** In good shape — pino structured logging, secret redaction, pipeline telemetry, per-session child loggers, debug audio dump
- **Policy:** Partial — rate limiting, CORS, CSP, endpoint allowlist. No content filtering or GDPR compliance framework
- **Internal object model:** Session, DialogueEntry, AudioParams, NarrationSegment, InkChoice. No formal "turn," "participant," or "scene" types

The designer's suggestion to move toward "a typed internal schema + interface spec" is the natural next step. The current types are adequate for what exists but won't support scenes, multi-participant, or media without extension.

**Action:** Document current types. The schema/interface spec work should formalize what exists and define types for the planned capabilities.

---

## What the Codebase Has That the Conversation Didn't Cover

The designer noted a weaker sense of worzel's protocols and state machines. These are worth documenting:

1. **The WebSocket protocol** — xiaozhi-inspired binary audio + JSON control messages. Message types: hello, listen, abort, ping, goodbye, iot, mcp (inbound); hello, stt, tts, pong, pipeline_telemetry (outbound). All Zod-validated.
2. **Session state machine** — connecting → ready → listening → processing → closed, with listening substates (idle, detecting, recording). One session per device, with idle timeout reaping.
3. **Pipeline data flow** — audio frames → Opus decode → ASR → filler playback → LLM stream → text segmentation → TTS prefetch → Opus encode → rate-controlled delivery. Each step has telemetry.
4. **Dual-LLM (fast + smart)** — fast model streams first, smart model runs in parallel. SegmentTracker tracks which segments came from which model. Smart can replace unsent segments or append corrections.
5. **ESP32 hardware client** — `esp32-client/` firmware for Waveshare boards. Core deliverable alongside web client.
6. **Twilio telephony** — PSTN phone call support via TwiML webhooks and TwilioTransport.
7. **Unified server** — single port serving main pipeline (`/ws`), Fink (`/ws/fink`), and Twilio (`/ws/twilio`).
8. **Auth flow** — OTA token-based (HMAC-SHA256), timing-safe verification, rate limiting per IP and device.

---

## Proposed Revision of `docs/proposed-arch-overview.md`

Restructure into three tiers:

1. **What exists** — protocols, state machines, pipeline, providers, Fink, caching, tools, auth, observability. With references to actual modules and types.
2. **Design concerns identified** — fused providers, GDPR caching, bounded generation philosophy, multi-device audio coordination. The problems the designer raised that need architectural answers.
3. **Future capabilities** — scene modelling, multi-participant, media/foley/spatial audio, WebXR, external speaker routing. Valid goals that need design work before implementation.

This gives a single document that's honest about where things stand while preserving the designer's vision of where they should go.
