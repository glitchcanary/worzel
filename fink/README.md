# Fink — Voice-Navigated Interactive Fiction

A standalone server that uses Worzel's voice pipeline (ASR/LLM/TTS) to navigate
Ink interactive fiction stories by voice. Speak naturally — the AI figures out whether
you're picking a choice, asking about the world, or just thinking aloud.

## Quick Start

```bash
# From the worzel/ directory:
npm run build                                        # Build everything
node --env-file=../.env dist/fink/server.js          # Start Fink on port 3001
```

Then open http://localhost:3001/ and hold the mic button to speak.

## Environment Variables

Fink uses the same `.env` as Worzel for provider config (ASR, LLM, TTS, auth).
Additional Fink-specific variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `FINK_PORT` | 3001 | HTTP/WS port |
| `FINK_STORIES_DIR` | `stories/` | Directory containing Ink story folders |
| `FINK_DEFAULT_STORY` | (first found) | Story ID to auto-start |

## How It Works

```
User speaks → Opus audio → ASR (Whisper) → text
                                             ↓
                                    InkRouter.classify()
                                             ↓
              ┌──────────┬──────────┬──────────┬──────────┐
              ▼          ▼          ▼          ▼          ▼
         choice      discuss      meta     freeform   no_match
              │          │          │          │          │
        story.Choose   LLM in    LLM as    raw text   LLM gently
        + Continue()   character  narrator  → Ink var  redirects
              │          │          │          │          │
              └──────────┴──────────┴──────────┴──────────┘
                                             ↓
                                     TTS → Opus → speaker
                                     (per-speaker voice)
```

**Three-tier classification** minimizes latency:
1. **Tier 1 (instant):** Exact text match, voice hints, meta keywords, affirmatives
2. **Tier 2 (instant):** Token overlap scoring with gap threshold
3. **Tier 3 (~200ms):** LLM classification for ambiguous paraphrases

## Architecture

Fink is a **standalone server** that imports Worzel's compiled modules:

- **`src/fink/server.ts`** — Entry point: Fastify HTTP, WebSocket, story loading
- **`src/fink/ink-pipeline.ts`** — Ink-aware voice pipeline (replaces normal LLM path)
- **`src/ink/`** — Reusable Ink engine modules (session, router, prompt builder, tags)
- **`fink/client/`** — Web client with story UI (adapted from Worzel's web client)
- **`stories/`** — Fink story folders (`.fink.js` + `metadata.json`)

No existing Worzel files are modified. The Fink server runs independently on its own port.

## Story Format

Each story lives in its own folder under `stories/`:

```
stories/my-story/
  story.fink.js       # On-disk runtime story format
  metadata.json       # Title, author, voices, FOAF character data
```

Stories can use Ink tags for voice control:

```ink
# speaker:narrator # voice:alloy
You approach the old garden gate.
# speaker:cat # voice:shimmer # foaf:name:Mr Whiskers
"Ah, a visitor! How delightful."
+ Push open the gate # voice_hint:open gate, push gate
+ Turn back # voice_hint:go back, leave
```
