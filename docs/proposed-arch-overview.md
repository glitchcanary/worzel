# Worzel Planning Draft Manual Overview

## Status

**Proposed** — for review against current codebase.

Next best move is to turn this into a typed internal schema + interface spec.

---

## Core Architectural Thesis

- Fused vs decomposed provider models
- Audio edge and self-interference
- Ink/FINK and bounded generation
- TTS caching and privacy
- Tools, IoT, media, and actuation
- Scene modelling and routing
- Multi-speaker / multi-AI participation
- Observability, policy, and internal object model

---

## Fused vs Decomposed Provider Models

Worzel must support both **fused** providers (where a single model handles STT + reasoning + TTS in one pass) and **decomposed** pipelines (where each stage is a separate service). The architecture should allow hot-swapping between these modes without changing the upstream caller contract.

---

## Audio Edge and Self-Interference

The audio subsystem must handle:

- Echo cancellation and barge-in detection
- Self-interference (preventing the AI's own TTS output from feeding back into STT)
- Low-latency audio routing at the edge

---

## Ink/FINK and Bounded Generation

Generation must be **bounded** — the system needs hard limits on output length, cost, and latency. Ink/FINK provides the framework for constraining generation within safe operational envelopes.

---

## TTS Caching and Privacy

- TTS outputs should be cached where possible for latency and cost reduction
- Caching must respect privacy boundaries — no cross-user cache leakage
- Cache invalidation strategy for updated voice models or content policies

---

## Tools, IoT, Media, and Actuation

Worzel supports tool use spanning:

- **IoT devices** — smart home control, sensor reading
- **Media** — playback, volume, content selection
- **Actuation** — physical-world actions via connected devices
- **General tools** — web search, calendar, reminders, etc.

---

## Scene Modelling and Routing

A **scene** represents the current conversational context including:

- Active participants (human and AI)
- Environmental state (room, devices, ambient conditions)
- Routing rules for which AI or service handles which intents

---

## Multi-Speaker / Multi-AI Participation

The system must handle:

- Multiple human speakers (speaker diarization)
- Multiple AI participants (routing, turn-taking, delegation)
- Mixed scenarios where several humans and AIs interact simultaneously

---

## Observability, Policy, and Internal Object Model

- **Observability** — structured logging, tracing, and metrics for all pipeline stages
- **Policy** — content filtering, rate limiting, access control, and compliance
- **Internal object model** — canonical representations for messages, turns, sessions, scenes, and participants
