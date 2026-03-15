# Critical Review: proposed-arch-overview.md vs Actual Codebase

The ChatGPT-generated summary reads like a reasonable brainstorming outline, but it's vague where the codebase is specific, wrong where it could have been right, and silent on the things that actually make worzel interesting. Here's a section-by-section critique.

---

## 1. "Core Architectural Thesis" — Missing

The doc lists topics but never states the thesis. The actual codebase *has* a clear thesis: **a streaming voice pipeline (ASR→LLM→TTS) over WebSocket using the xiaozhi protocol, designed for ESP32 hardware clients, with Ink-based interactive fiction as a first-class use case.** The doc should say this.

**Action:** Replace the bullet-point list with a concrete architectural statement grounded in what exists.

---

## 2. "Fused vs Decomposed Provider Models" — Partially Relevant, Badly Framed

The doc talks about "fused providers" (single model doing STT+reasoning+TTS) vs "decomposed pipelines." This isn't how worzel works. Worzel has a **decomposed pipeline** with pluggable providers per stage (ASR: OpenAI/Groq Whisper, LLM: Ollama/OpenAI/Anthropic, TTS: OpenAI/Edge/ElevenLabs/Piper/Kokoro). There is no fused mode.

What worzel *does* have that's architecturally interesting is the **dual-LLM (fast + smart) pattern** — a fast model streams first, a smart model runs in parallel and can replace unsent segments or append corrections. This is a genuine architectural innovation that the doc completely misses.

**Action:** Replace "fused vs decomposed" with documentation of the actual provider registry (`src/providers/registry.ts`), the provider interfaces (ASR/LLM/TTS), and the smart-LLM correction mechanism.

---

## 3. "Audio Edge and Self-Interference" — Aspirational, Not Real

The doc mentions echo cancellation, barge-in detection, and self-interference prevention. The codebase has:
- **Barge-in/abort:** Yes — the `abort` message type interrupts the pipeline via `AbortController`
- **Echo cancellation:** No — not implemented server-side; this is a client concern (ESP32 hardware or browser)
- **Self-interference prevention:** Not a server concern — the ESP32 handles I2S audio routing

The doc frames this as a server architecture concern when it's really a client/hardware concern. The server's role is limited to responding to `abort` messages.

**Action:** Reframe as "client-side audio concerns" and document what the server *actually* does (abort handling, audio rate control via `AudioRateController`).

---

## 4. "Ink/FINK and Bounded Generation" — Conflates Two Unrelated Things

Fink is real and substantial — it's a voice-navigable interactive fiction engine built on inkjs with a sophisticated tag system, voice profiles, choice matching, cross-story linking, and an LLM-powered router for classifying utterances. This is one of the most developed subsystems.

"Bounded generation" is vaguely mentioned but not connected to anything concrete. The codebase *does* have generation bounds: `maxTokens` in LLM options, text segmentation for TTS chunks, and the filler-cache latency masking system. But these aren't related to Ink.

**Action:** Split into two sections. Give Fink its own proper documentation covering InkSession, InkRouter, InkPipeline, voice profiles, choice matching, and finkLinks. Document generation constraints separately.

---

## 5. "TTS Caching and Privacy" — Half Right

TTS caching exists and is well-implemented (`CachedTTSProvider`, disk-based, keyed by provider:model:voice:speed:text, with configurable scope and TTL). The filler cache is also real and clever (25 pre-cached acknowledgment phrases for latency masking).

"Privacy" and "cross-user cache leakage" — the codebase uses a simple scope model (`persistent`/`volatile`/`none`) but there's no multi-user isolation. The cache key doesn't include user/device identity. This is a genuine gap but the doc doesn't identify it precisely.

**Action:** Document the actual caching implementation. Flag the lack of per-user cache isolation as a real concern if multi-tenancy is planned.

---

## 6. "Tools, IoT, Media, and Actuation" — Partially Exists

- **IoT:** Yes — the `iot` message type lets clients send device descriptors with methods. Home Assistant integration exists as a builtin tool.
- **Tools:** Yes — `ToolRegistry` with builtin tools (weather, Home Assistant) and MCP bridge for device-discovered tools.
- **Media:** Not really — no media playback/control system exists. TTS output is the only audio the server produces.
- **Actuation:** Only through IoT device methods — there's no dedicated actuation framework.

The doc lumps these together when they're at very different maturity levels.

**Action:** Document what exists (IoT descriptors, tool registry, MCP bridge, Home Assistant). Be honest about what doesn't exist (media control, general actuation framework).

---

## 7. "Scene Modelling and Routing" — Does Not Exist

There is no scene model in the codebase. There are:
- **Sessions** (one per device, with state machine: connecting→ready→listening→processing→closed)
- **Dialogue history** (array of `{role, content, timestamp}` entries)
- **Fink's InkRouter** (classifies utterances into choice_match/discussion/meta_query/etc.)

But no concept of "scenes," "environmental state," or "routing rules for which AI handles which intents" outside of Fink. This section is pure aspiration.

**Action:** Document the actual session model. If scene modelling is desired, spec it as a future feature with concrete requirements.

---

## 8. "Multi-Speaker / Multi-AI Participation" — Does Not Exist

The codebase is strictly **single-speaker, single-AI per session**. There is:
- No speaker diarization
- No multi-AI routing or delegation
- No turn-taking protocol beyond barge-in/abort

Fink has multi-*character* voice (different TTS voices for narrator vs characters via voice profiles), but that's one AI using different voices, not multiple AIs.

**Action:** Remove or move to a "future considerations" section. If this is a real requirement, it needs substantial design work.

---

## 9. "Observability, Policy, and Internal Object Model" — Partially Exists

- **Observability:** Real — pino structured logging with secret redaction, pipeline telemetry events (asr_complete, llm_segment, filler_played, pipeline_complete, smart_correction), per-session child loggers, debug audio dump mode.
- **Policy:** Partial — rate limiting (per-IP, per-device), CORS allowlist, CSP headers, endpoint URL allowlist. No content filtering or compliance framework.
- **Internal object model:** Exists but simpler than implied — Session, DialogueEntry, AudioParams, plus Fink's NarrationSegment/InkChoice/ParsedTags. No canonical "turn" or "participant" types beyond the dialogue array.

**Action:** Document what exists accurately. The observability story is actually decent. Policy and object model need honest assessment.

---

## What the Doc Completely Misses

The biggest problem with the ChatGPT summary is what it *doesn't* mention:

1. **The xiaozhi protocol** — the actual wire protocol (binary audio + JSON control messages over WebSocket) is the foundation of everything and isn't mentioned at all
2. **ESP32 hardware client** — worzel is designed for embedded hardware, not just browsers. The `esp32-client/` firmware is a core deliverable
3. **The dual-LLM (fast+smart) pattern** — genuinely novel architecture for latency vs quality tradeoff
4. **Filler cache latency masking** — playing "Hmm" and "Yeah" while waiting for the LLM is a key UX feature
5. **Text segmentation for streaming TTS** — splitting LLM output into sentence-sized chunks for progressive audio delivery
6. **Twilio telephony integration** — PSTN phone call support via TwiML webhooks
7. **The web client** — a full Web Components-based client with WebCodecs Opus encoding
8. **The unified server architecture** — single port serving main app, Fink, and Twilio on different WebSocket paths

---

## Proposed Changes to `docs/proposed-arch-overview.md`

1. **Rewrite** the document to reflect the actual codebase, not ChatGPT's guesses
2. **Structure** around what exists (with maturity level) vs what's aspirational
3. **Add** the missing architectural elements listed above
4. **Remove or demote** sections that don't correspond to real code (scenes, multi-speaker)
5. **Keep** it as a living document that can guide the "typed internal schema + interface spec" the summary suggests as a next step

The rewrite should be grounded in the actual source files, referencing real modules and types rather than abstract concepts.
