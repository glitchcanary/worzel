# Review: proposed-arch-overview.md vs Actual Codebase

## Context

The proposed overview is a ChatGPT summary of a conversation about use cases encountered with worzel and nearby projects. ChatGPT did not have access to the codebase — it was responding to the problems and scenarios raised. This review maps those use cases against what worzel currently implements, to identify alignment, gaps, and areas worth developing.

Also worth noting: recent Fink work was done by Codex (OpenAI), and the protocol is xiaozhi-*inspired* (WebSocket message shapes) rather than a full xiaozhi implementation (no MQTT, no device binding).

---

## Section-by-Section Mapping

### 1. "Core Architectural Thesis"

The doc lists topic areas but doesn't state a thesis. The codebase embodies one: **a streaming voice pipeline (ASR→LLM→TTS) over WebSocket, targeting ESP32 hardware and browser clients, with interactive fiction (Fink) as a first-class application.**

**Action:** Add a concrete thesis statement to the doc. The topic list is fine as a table of contents, but needs an anchor.

---

### 2. "Fused vs Decomposed Provider Models"

This is a real architectural question worth preserving. Worzel currently implements **decomposed only** — pluggable providers per stage (ASR: OpenAI/Groq Whisper; LLM: Ollama/OpenAI/Anthropic; TTS: OpenAI/Edge/ElevenLabs). There's no fused mode where a single model handles the whole pipeline.

However, the use case is valid. Services like GPT-4o's voice mode and Gemini Live *are* fused. If worzel ever integrates those, it needs an abstraction that can wrap a fused provider behind the same pipeline interface.

What the codebase *does* have in this space that's worth documenting: the **dual-LLM (fast + smart) pattern** — a fast model streams immediately while a smarter model runs in parallel and can replace unsent segments or append corrections. This is a form of provider composition the doc doesn't mention.

**Action:** Keep the fused/decomposed distinction as a design consideration. Add the dual-LLM pattern as the existing example of provider composition. Note that fused provider support would be a future abstraction.

---

### 3. "Audio Edge and Self-Interference"

These are real problems you've encountered. In the current codebase:
- **Barge-in/abort:** Implemented — `abort` message interrupts the pipeline via `AbortController`
- **Audio rate control:** `AudioRateController` paces Opus frame delivery to prevent buffer overflow
- **Echo cancellation / self-interference:** Not handled server-side. On ESP32, the hardware I2S path separates mic from speaker. In the browser, this falls to WebAudio/OS-level AEC.

The doc is right to flag these. The question is where they belong architecturally — some are client concerns, some could benefit from server-side coordination (e.g. suppressing ASR during TTS playback).

**Action:** Keep in the doc but clarify the client/server boundary. Note what exists (abort, rate control) and what remains open (server-assisted echo management, VAD tuning).

---

### 4. "Ink/FINK and Bounded Generation"

Fink is one of the most developed subsystems (built out substantially by Codex). It includes: InkSession (inkjs wrapper with tag parsing, voice hints, state serialization), InkRouter (3-tier utterance classification), InkPipeline (Ink-aware voice pipeline), voice profiles (semantic voice IDs mapped to provider-specific voices), choice matching (tokenized fuzzy match + affirmatives), and cross-story linking via finkLinks.

"Bounded generation" as a separate concern also maps to real code: `maxTokens` limits, text segmentation for TTS-sized chunks, and the filler cache that masks LLM latency. These just aren't Fink-specific.

**Action:** Split into two doc sections. Fink deserves its own detailed treatment. Generation constraints (segmentation, token limits, latency masking) are a pipeline concern.

---

### 5. "TTS Caching and Privacy"

TTS caching is well-implemented: `CachedTTSProvider` wraps all TTS providers with disk-based caching (keyed by provider:model:voice:speed:text, configurable scope: persistent/volatile/none, TTL per call). The filler cache pre-generates 25 short acknowledgment phrases at startup for instant latency masking.

The privacy concern raised in the doc is legitimate. Cache keys don't include user or device identity — in a multi-tenant scenario, user A's cached TTS could serve user B if the text and voice match. Whether this matters depends on deployment model (single-household device vs shared service).

**Action:** Document the caching implementation. Note the multi-tenancy isolation question as a design decision to make, not necessarily a bug.

---

### 6. "Tools, IoT, Media, and Actuation"

Coverage varies by maturity:
- **IoT:** Implemented — `iot` message type for client device descriptors with callable methods. Home Assistant builtin tool exists.
- **Tools:** Implemented — `ToolRegistry`, builtin tools (weather, Home Assistant), MCP bridge for device-discovered tools.
- **Media:** Not implemented — no media playback, volume control, or content selection. TTS is the only audio output.
- **Actuation:** Only via IoT device methods — no standalone actuation framework.

These are at different maturity levels and the doc is right to group them as a use-case cluster even if not all are built yet.

**Action:** Document with honest maturity indicators. Media and actuation are valid future work, not current capability.

---

### 7. "Scene Modelling and Routing"

No scene model exists in the codebase. What exists:
- **Sessions** — one per device, state machine (connecting→ready→listening→processing→closed)
- **Dialogue history** — `{role, content, timestamp}[]`
- **Fink's InkRouter** — classifies utterances for narrative routing

The use case is real though — "who's in the room, what devices are available, what context applies" is a genuine need for a household voice assistant. It just hasn't been built.

**Action:** Keep as a future design area. Document the existing session model as the foundation it would build on.

---

### 8. "Multi-Speaker / Multi-AI Participation"

Not implemented. The codebase is single-speaker, single-AI per session. Fink uses multiple TTS voices for different characters, but that's one AI with multiple voice outputs, not multiple AI participants.

Again, the use case is real — households have multiple people, and scenarios like "hand off to a specialist AI" or "two AIs collaborating" are interesting. But this needs substantial design work: speaker diarization, participant models, turn-taking protocols, delegation/routing.

**Action:** Keep as a future design area with the use cases that motivated it. Flag the distance from current architecture.

---

### 9. "Observability, Policy, and Internal Object Model"

- **Observability:** In good shape — pino structured logging, secret redaction, pipeline telemetry (asr_complete, llm_segment, filler_played, pipeline_complete, smart_correction), per-session child loggers, debug audio dump.
- **Policy:** Partial — rate limiting, CORS, CSP, endpoint allowlist. No content filtering or compliance framework.
- **Internal object model:** Simpler than the doc implies — Session, DialogueEntry, AudioParams, NarrationSegment, InkChoice. No formal "turn," "participant," or "scene" types.

**Action:** Document what exists. The suggestion to move toward "a typed internal schema + interface spec" is a good next step and would formalize the object model.

---

## What the Codebase Has That the Doc Doesn't Cover

These are capabilities worth adding to the architecture overview:

1. **The WebSocket protocol** — xiaozhi-inspired binary audio + JSON control messages. Not a full xiaozhi implementation (no MQTT), but the wire format and message types are well-defined and Zod-validated.
2. **ESP32 hardware client** — `esp32-client/` firmware for Waveshare boards. A core deliverable, not just a "nice to have."
3. **Dual-LLM (fast + smart) pattern** — fast model streams first, smart model runs in parallel, can replace unsent segments or append corrections. A real architectural choice for the latency/quality tradeoff.
4. **Filler cache latency masking** — pre-cached "Hmm," "Yeah" phrases played during ASR→LLM wait. Simple but effective UX.
5. **Text segmentation for streaming TTS** — splits LLM output at sentence boundaries for progressive audio delivery.
6. **Twilio telephony** — PSTN phone call support via TwiML webhooks and TwilioTransport.
7. **Web client** — Web Components + WebCodecs Opus encoding, full browser-based voice UI.
8. **Unified server** — single port serving main pipeline (`/ws`), Fink (`/ws/fink`), and Twilio (`/ws/twilio`).

---

## Proposed Revision of `docs/proposed-arch-overview.md`

Restructure the document into three tiers:

1. **What exists** — with references to actual modules and types, maturity level noted
2. **What's been identified as needed** — the use cases from the ChatGPT conversation that map to real gaps
3. **What needs design work** — areas like scene modelling and multi-participant that are valid but distant

This gives a single document that serves both as architecture documentation and as a roadmap, without confusing the two.
