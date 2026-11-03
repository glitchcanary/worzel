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

Then open http://localhost:3001/, choose a story, and hold the talk button (or Space) to speak.

## Environment Variables

Fink uses the same `.env` as Worzel for provider config (ASR, LLM, TTS, auth).
Additional Fink-specific variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `FINK_PORT` | 3001 | HTTP/WS port |
| `FINK_STORIES_DIR` | `stories/` | Directory containing Ink story folders |
| `FINK_DEFAULT_STORY` | `menu` | Story used when the client names none |
| `FINK_EXTERNAL_HOSTS` | (unset) | Comma-separated hosts for external `.fink.js` (e.g. `danbri.github.io`). Unset = external stories off |
| `FINK_STORY_CATALOG` | `stories/external-catalog.json` | External story list shown in the picker |

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

Stories may also set `"group"` in `metadata.json`; the picker groups stories by it.

## Choosing a story

The client opens with a story picker (`GET /api/stories`). It lists:

- every local story in `stories/`;
- the external stories in `stories/external-catalog.json`: the playable Glitch Canary,
  Cozyverse, Drift City and Isle of Glitch stories published on danbri.github.io. They are
  fetched and compiled on first use, and only when `FINK_EXTERNAL_HOSTS` includes
  `danbri.github.io`. Without it they are listed but disabled.

Ways to pick a story:

| Where | How |
|---|---|
| Link | `/fink/?story=<id>` (local id, catalogue id, or `.fink.js` URL). The page shows one Start button, because browsers need a tap before they play audio |
| WebSocket URL | `?story=<id>` next to `token=`; used for the first story of the session |
| Message | `{"type":"fink_start","story_id":"<id>"}` restarts the session on that story at any time. An unknown or disabled story gives `{"type":"error","code":"STORY_UNAVAILABLE"}` |
| Voice | the `menu` story, and FINK: links inside stories, as before |

`ink_state` narration segments carry `image` when the story has an `# IMAGE:` tag. The server
resolves it: story file URL, then `# BASEHREF:` (which stays in force until the next one), then the
image path, the same order as the glitchcan-minigam story runner. The client shows the latest
picture above the text; tap it to enlarge.

`scripts/fink-story-smoke.mjs [base-url]` starts every listed story over the WebSocket and checks
the first picture of each.

## Talk control

| Mode | Behaviour |
|---|---|
| Hold to talk (default) | Hold the button or Space, talk, release to send. A short tap latches: talk, and it sends when you stop talking or tap again. Pressing while Fink speaks stops the voice |
| Hands-free | The mic opens when Fink stops speaking. Speech heard while Fink speaks is dropped |

Keys: Space hold to talk, 1-9 choose, Esc stop the voice, Tab move between choices.
Speech recognition uses the browser's Web Speech API when present, else Worzel's server ASR
(Whisper). The settings button holds the mode, the voice speed and the pilot tone.

## Pilot tone (experimental)

`?pilot=1` (or the settings checkbox) marks Fink's speech with a quiet 18.0-19.1 kHz pilot and
listens for it on a second, raw microphone stream. While the pilot is audible, hands-free
listening waits. Because the pilot comes from the speaker and not from the server, this also
covers playback delay (Bluetooth) and Fink audio from another tab or device. Whisper never sees
the pilot: the server path is 16 kHz, so everything above 8 kHz is removed. Details, limits and
test results: `docs/fink-voice-ui.md`.
