# Content Composition: Choices, Media, and the UI Container Problem

Two systems, one story format, very different composition models. This doc works through the design for both.

---

## The Two Architectures

**Finkapp** is a monolithic web app. It fetches `.fink.js` files, compiles Ink in-browser, interprets tags, and renders everything into a scrolling feed UI with web components for rich content (video, audio, minigames). Everything is local. The "container infrastructure" is the DOM itself — a `<fink-story>` element that appends paragraphs, choice cards, and embedded widgets as the story advances.

**Worzel** is middleware. The Ink engine runs server-side. Clients connect over WebSocket (or eventually MQTT). The unit of composition is a protocol message — `ink_state`, `tts`, `stt`, binary audio. Rich content must be explicitly supported by each client surface. An ESP32 with a speaker can't show an image unless the protocol tells it to and it knows how.

Both need to handle the same authored content. The Ink source is the same. The tags are the same. What differs is how content gets from tag to rendering surface.

---

## Content Types and Their Tags

What a Fink story can annotate today (or soon):

| Tag | Content type | Finkapp handling | Worzel handling |
|-----|-------------|-----------------|-----------------|
| `# speaker:X` | Character identity | Display name label | TTS voice selection |
| `# voice:X` | Voice identity | Display (unused for audio) | TTS voice routing |
| `# mood:X` | Emotional state | Visual style/colour | TTS style hint; Xiaozhi `emotion` |
| `# image:url` | Static image | `<img>` element | `ink_state.narration[].image` field — client renders or ignores |
| `# AUDIO:url` | Audio file (music, ambient) | `<audio>` playback | **Not implemented** |
| `# FOLEY:name` | Sound effect | Web Audio synthesis | **Not implemented** |
| `# VIDEO:url` | Video clip | `<video>` element | **Not implemented** |
| `# MINIGAME:id` | Interactive widget | iframe/web component | **Not implemented** |
| `# BG:url` | Background image/scene | CSS background | **Not implemented** |
| `# pause:ms` | Timing directive | `setTimeout` | TTS silence gap |
| `# FINK:id` | Cross-story link | Navigate to new `.fink.js` | Fetch + switch InkSession |
| `# input:freeform` | Open text input | Text field | ASR passthrough to variable |
| `# voice_hint:...` | Choice matching cues | (unused) | InkRouter matching |

The gap is clear: worzel handles voice/text/choice tags well but has no story for media. Finkapp handles media but has no story for non-visual surfaces.

---

## Problem 1: Choice Presentation

Choices are the core interaction in Ink. Both systems need better design here.

### Current State

**Worzel** presents choices by:
1. Sending `ink_state` with `choices: [{index, text}]` — the client shows tappable cards
2. Reading choices aloud via TTS in a distinct voice: "You can: X, Y, or Z"
3. Waiting for voice input, classifying via InkRouter (3-tier: exact → token → LLM)
4. Also accepting `ink:choose` message for direct tap selection

**Finkapp** presents choices by:
1. Rendering tappable choice cards below the narration
2. User taps one; story advances

Both treat choices as a flat list of strings. This is limiting.

### What's Missing

**1. Choice metadata.** A choice can carry richer information than its text:

```ink
+ [Confront the guard] # mood:tense # risk:high # requires:sword
+ [Sneak past] # mood:tense # risk:medium # skill:stealth
+ [Talk your way in] # mood:confident # skill:charm
```

The `risk:`, `requires:`, `skill:` tags aren't defined yet. But the pattern is obvious — choices have attributes that affect how they should be presented. A visual client might colour high-risk choices red. A voice client might say "that seems risky" after reading it. An ESP32 with LEDs might pulse red.

**2. Progressive reveal / hidden choices.** Ink supports conditional choices (`+ { has_key } Unlock the door`). But there's no concept of *teasing* a hidden choice — showing that something exists without revealing what. A locked door icon. "There seems to be another option, but you're not ready." This is a presentation-layer concern, but the story needs a way to signal it.

Proposed tag: `# reveal:teaser:Something glints behind the ivy`

```ink
+ { has_key } Unlock the hidden door # reveal:teaser:Something glints behind the ivy
```

If `has_key` is false, the choice is hidden from Ink's perspective. But the `reveal:teaser` text gets passed to the client as a non-selectable hint. The client decides how to render it — greyed-out card, whispered TTS aside, faint LED pulse.

**3. Open-ended vs. constrained.** The `# input:freeform` tag already exists for fully open-ended input. But there's a middle ground: the story presents choices *and* the user can say something off-script. The InkRouter already handles this (its `discussion` and `no_match` modes), but the client has no signal about *how open* the current choice point is.

Proposed tag: `# choice_mode:open` / `# choice_mode:strict` / `# choice_mode:guided`

- **strict** — only the listed choices are valid. No LLM fallback. Used for IVR-style menus, game-critical decisions.
- **guided** (default) — choices are primary, but discussion and tangential input are allowed. Current behaviour.
- **open** — choices are suggestions, not gates. The user can say anything and the system should try to incorporate it. More LLM-heavy.

This affects the InkRouter: in `strict` mode, skip tier 3 (LLM) and go straight to no_match. In `open` mode, treat everything as potential story input, not just choice matching.

**4. Timed choices / urgency.** A story beat might have a time pressure: "The door is closing! Quick!" with a 10-second window to choose before a default fires.

```ink
+ Run through! # voice_hint:run, go, quick # timer:10s:default
+ Stay back # voice_hint:stay, wait, no
```

`# timer:10s:default` means: after 10 seconds with no input, automatically select the choice tagged `default` (or the first choice if none tagged). The client shows a countdown. The voice client says "hurry" at 5 seconds. The middleware handles the timer so it's consistent across surfaces.

**5. Multi-select / partial choices.** Sometimes the interaction isn't "pick one" but "pick several" or "pick in order":

```ink
// Not standard Ink — would need external function support
+ [Take the rope] # collect:inventory
+ [Take the lantern] # collect:inventory
+ [Take the map] # collect:inventory
+ [Done choosing] # collect:done
```

This is a stretch for Ink's single-choice model. But `# collect:inventory` could signal to the client that these are accumulative — show checkboxes not radio buttons. The middleware tracks selected items in a variable. When `collect:done` fires, all selections are committed.

### Choice Protocol Changes (Worzel)

The `ink_state` message currently sends:
```json
{ "choices": [{ "index": 0, "text": "Open the gate" }] }
```

Proposed expansion:
```json
{
  "choices": [
    {
      "index": 0,
      "text": "Open the gate",
      "tags": { "mood": "tense", "risk": "high" },
      "mode": "guided",
      "timer": null
    }
  ],
  "hidden_teasers": [
    { "teaser": "Something glints behind the ivy" }
  ],
  "choice_mode": "guided",
  "timer": { "seconds": 10, "default_index": 0 }
}
```

The `tags` field is new — it exposes choice-level metadata to the client without the client needing to parse Ink tags. The `hidden_teasers` array carries reveal hints for choices the player can't yet select. `choice_mode` and `timer` are scene-level, not per-choice.

### Choice Protocol Changes (Finkapp)

Finkapp doesn't have a wire protocol — the Ink engine runs in-browser. But the same design applies to the internal data structure that `FinkUI` receives from `FinkInkEngine`. The choice object should carry tags, teaser text for hidden alternatives, and mode signals. The UI renders accordingly: greyed cards, countdown bars, checkboxes.

---

## Problem 2: Media Content Composition

### The Container Model

Both systems need a concept of "containers" — slots in the UI where non-text content lives. In finkapp this is literally DOM elements. In worzel it's protocol messages that tell the client to create a rendering surface.

**Finkapp containers** (current, implicit):

```
┌──────────────────────────────────┐
│ Narrative feed (scrolling)       │
│  ├── <p> narration text          │
│  ├── <img> inline image          │
│  ├── <video> embedded clip       │
│  ├── <fink-minigame> widget      │
│  ├── <p> more narration          │
│  └── <div class="choices">       │
│       ├── [Choice A]             │
│       └── [Choice B]             │
└──────────────────────────────────┘
│ Background audio (hidden)        │  ← # AUDIO:
│ Foley layer (hidden)             │  ← # FOLEY:
│ Background image (CSS)           │  ← # BG:
└──────────────────────────────────┘
```

Content appears inline in the feed as the story advances. Media is interleaved with text. This works for a web app but is fundamentally visual.

**Worzel containers** (proposed):

Worzel can't assume the client has a DOM. It needs to describe content abstractly and let the client decide. Proposed approach: the `ink_state` message gains a `media` array alongside `narration` and `choices`:

```json
{
  "type": "ink_state",
  "narration": [...],
  "choices": [...],
  "media": [
    {
      "type": "image",
      "url": "https://cdn.example.com/garden-gate.jpg",
      "alt": "An iron gate half-hidden by ivy",
      "position": "inline",
      "after_segment": 0
    },
    {
      "type": "audio",
      "url": "https://cdn.example.com/ambient-garden.mp3",
      "role": "ambient",
      "loop": true
    },
    {
      "type": "video",
      "url": "https://cdn.example.com/gate-opens.mp4",
      "position": "inline",
      "after_segment": 1,
      "duration_ms": 4500,
      "blocking": true
    }
  ]
}
```

Each media item has a `type`, a `url`, and presentation hints. The `position` field says where it goes relative to narration (`inline`, `background`, `overlay`). The `after_segment` field ties it to a narration segment index. The `blocking` flag tells the client whether to pause narration until the media finishes (the temporal coordination problem).

Clients handle what they can:
- **Web browser**: renders all of them — `<img>`, `<video>`, `<audio>` elements
- **ESP32 with TFT**: renders `image` (downscaled), ignores `video`
- **ESP32 audio-only**: plays `audio` if format supported, ignores visual media
- **Twilio phone**: ignores everything (narrowband audio only)
- **Voice client (web)**: plays `audio`, describes `image` via TTS alt-text, ignores `video` or plays audio track only

The client doesn't need to understand Ink tags. It gets structured media descriptors and chooses what to render.

### Sound Composition

Audio content falls into layers that need mixing, not just sequential playback:

| Layer | Tag | Behaviour | Example |
|-------|-----|-----------|---------|
| **Narration** | (pipeline output) | Primary voice. Ducks other layers. | TTS of story text |
| **Foley** | `# FOLEY:name` | One-shot sound effect. Fires at tag position. | Thunder clap, door creak |
| **Music** | `# AUDIO:url` | Looping/fading background. Crossfades between scenes. | Ambient garden sounds |
| **Widget audio** | (from minigame) | Ducked during narration. Muted when paused. | Game sound effects |
| **Dialogue** | `# speaker:X` | Character voice (distinct from narrator). Mixed with narration. | Cat speaking |

In finkapp, these are separate Web Audio nodes that can be gain-controlled independently. The browser is a capable mixer.

In worzel, audio composition is harder. The server currently sends one stream of Opus frames. Multiple audio layers would need either:

1. **Server-side mixing** — mix narration TTS + foley + ambient into a single Opus stream before sending. Latency cost but client stays simple.
2. **Multi-stream protocol** — send separate audio streams tagged by layer. Client mixes locally. More capable but requires client support.
3. **Hybrid** — narration via the existing Opus stream, ambient/foley via media URLs that the client fetches and plays independently. Narration stays low-latency; background audio is fetch-and-play.

Option 3 is the pragmatic choice. It requires no server-side mixing, keeps the voice pipeline latency unchanged, and leverages the client's ability to play audio files. The `media` array in `ink_state` carries the ambient/foley URLs. The Opus stream carries narration. The client layers them.

For ESP32 audio-only devices, ambient audio would need to be either server-mixed (option 1) or skipped. Most ESP32 boards have a single I2S DAC — they physically can't mix multiple streams. Server-side mixing for ESP32 is a future optimisation, not a day-one requirement.

### Foley in Practice

The `# FOLEY:name` tag needs a registry that maps names to audio assets or synthesis parameters. In finkapp, `FinkFoley` synthesises effects via Web Audio oscillators — no audio files needed. In worzel, foley could be:

1. **Pre-recorded files** — `foley/thunder.mp3`, served via CDN, referenced in the `media` array
2. **Synthesis descriptors** — `{ "type": "foley", "name": "thunder", "params": { "duration": 1.2, "freq_start": 80, "freq_end": 20 } }` — the client synthesises if capable, fetches a fallback file if not
3. **Server-rendered** — the server synthesises foley into the Opus stream at the appropriate moment (server-side mixing)

Option 1 is simplest and works across all clients. Option 2 is more flexible but requires a synthesis engine on each client. For now, pre-recorded files with a naming convention (`foley/{name}.mp3`) and a manifest file is sufficient.

---

## Problem 3: The Temporal Model

Both docs/proposed-arch-overview.md and the MQTT plan acknowledge this gap. Here's a concrete proposal.

### Event Streams, Not Timelines

The temptation is to build a timeline — a linear sequence of timed events. But interactive fiction is non-linear. The user can interrupt, skip, or take longer than expected. A timeline breaks on first contact with the user.

Instead: **named concurrent streams with dependency relationships**.

```
Stream: narration
  [segment_0: "You stand before a gate..."]
  [segment_1: "The garden stretches into twilight."]

Stream: ambient_audio
  [ambient-garden.mp3, loop=true, fade_in=2s]
  depends: starts WITH narration

Stream: foley
  [gate-creak.mp3, duration=1.2s]
  depends: starts AFTER narration.segment_1

Stream: image
  [garden-gate.jpg]
  depends: starts WITH narration.segment_0

Stream: choices
  [choice_0: "Push open the gate"]
  [choice_1: "Call out"]
  depends: starts AFTER narration (all segments complete)
```

Each stream has a lifecycle: `pending → active → complete | cancelled`. Dependencies determine when a stream activates. The user acting (choosing, speaking) sends an `interrupt` event that cancels or fades active streams by policy.

### Interrupt Policy

When the user acts during active streams:

| Stream type | On interrupt | Rationale |
|-------------|-------------|-----------|
| Narration TTS | Cancel immediately | User has decided; stop talking |
| Ambient audio | Fade out over 1s | Don't cut abruptly |
| Foley | Let finish if <2s remaining | Short effects sound wrong truncated |
| Video | Cancel or let finish (per tag) | `# VIDEO:url blocking:cancelable` |
| Minigame | Pause (keep state) | Don't destroy progress |
| Choices (visual) | Collapse | New choices incoming |

This is a policy layer, not hardcoded behaviour. The tags can override: `# FOLEY:thunder interruptible:false` means the thunder plays to completion even on interrupt.

### Surface-Independent Timing

The stream model doesn't encode absolute durations for narration. TTS duration depends on the voice, speed setting, and provider. Text animation duration depends on character count and the CSS timing. The model says "segment_0 starts, then segment_1 starts AFTER segment_0 completes" — the surface determines when "complete" means.

For voice clients: segment complete = TTS audio finished playing.
For visual clients: segment complete = text animation finished (or instant if scrolled past).
For e-ink: segment complete = display refreshed.

The middleware emits events. The client interprets timing.

### How This Maps to MQTT

Each stream maps to an MQTT topic:
```
worzel/{device_id}/stream/narration
worzel/{device_id}/stream/ambient
worzel/{device_id}/stream/foley
worzel/{device_id}/stream/choices
```

Stream lifecycle events (`start`, `segment`, `complete`, `cancel`) publish to the stream's topic. External observers (dashboard, logger, companion display) subscribe to streams they care about. The primary client gets these same events via the WebSocket `ink_state` message — MQTT is the fan-out layer, not the primary transport.

---

## Problem 4: Widgets and Minigames

### The Container Slot Model

Finkapp's slider window (full / embed / mini-live / mini-paused) is the right UX pattern for visual clients. A minigame occupies a "slot" in the UI that can resize. The story continues in the narrative area while the game runs in its slot.

For worzel, a minigame is a media item with bidirectional communication:

```json
{
  "type": "widget",
  "widget_id": "gems-puzzle",
  "url": "https://cdn.example.com/games/gems/",
  "params": { "mode": "timed", "difficulty": 3 },
  "position": "embed",
  "comm_channel": "worzel/{device_id}/widget/gems-puzzle"
}
```

The client loads the widget URL (web component, iframe, or native implementation). The `comm_channel` is where the widget and story exchange messages — via `postMessage` locally in the browser, or via MQTT for remote observation.

Widget → Story messages:
```json
{ "event": "complete", "result": { "score": 42, "variables": { "gems_won": true } } }
{ "event": "progress", "state": { "level": 3, "health": 80 } }
{ "event": "audio", "action": "play", "clip": "gem-collect.mp3" }
```

Story → Widget messages:
```json
{ "event": "pause" }
{ "event": "resume" }
{ "event": "resize", "slot": "mini-live" }
{ "event": "terminate" }
```

The `progress` events are what make widgets non-opaque (addressing the arch doc's concern). A voice client can narrate progress: "You're on level 3 with 80 health remaining." A dashboard can display a live scoreboard. An ESP32 with LEDs can pulse with game events.

### Non-Visual Widget Alternatives

Not every client can run a web-based widget. The widget descriptor should include fallback strategies:

```json
{
  "type": "widget",
  "widget_id": "gems-puzzle",
  "url": "https://cdn.example.com/games/gems/",
  "fallbacks": {
    "voice": {
      "description": "A gem-matching puzzle. Say colours to swap gems.",
      "interaction_mode": "voice_commands",
      "commands": ["swap red blue", "rotate left", "hint"]
    },
    "text": {
      "description": "A gem-matching puzzle played by text commands.",
      "interaction_mode": "text_input"
    },
    "skip": {
      "description": "This is an optional mini-game. Skip it?",
      "default_result": { "score": 0, "variables": { "gems_won": false } }
    }
  }
}
```

The client picks the most capable fallback it supports. A phone client uses `voice`. A headless ESP32 uses `skip` with a default outcome. A web client uses the full widget. The story gets a result either way and continues.

---

## Implementation: Where This Lives in Each System

### Worzel Changes

**Tag parsing** (`src/ink/ink-tags.ts`): Add new tag types:

```typescript
export interface ParsedTags {
  // ... existing fields ...
  audio?: { url: string; role: 'ambient' | 'foley' | 'effect'; loop?: boolean };
  video?: { url: string; blocking?: boolean };
  foley?: string;                    // foley name → resolve via registry
  bg?: string;                       // background image URL
  widget?: { id: string; params: Record<string, string> };
  reveal?: { teaser: string };       // hidden choice hint
  choiceMode?: 'strict' | 'guided' | 'open';
  timer?: { seconds: number; defaultChoice?: string };
  risk?: string;
  skill?: string;
  collect?: string;                  // multi-select group
  interruptible?: boolean;
}
```

**InkSession** (`src/ink/ink-session.ts`): Extract media items from narration segments and return them separately in `continue()` and `choose()` results.

**InkPipeline** (`src/fink/ink-pipeline.ts`): Include `media` array in `ink_state` messages. Handle `blocking` media by pausing TTS until the client confirms media completion (new `media:complete` inbound message type).

**Protocol** (`src/protocol/types.ts`): Add `media:complete` inbound message. Expand `ink_state` outbound with `media`, `hidden_teasers`, `choice_mode`, `timer` fields.

**InkRouter** (`src/ink/ink-router.ts`): Respect `choice_mode` — skip LLM tier in `strict` mode, expand LLM latitude in `open` mode.

### Finkapp Changes

**FinkInkEngine**: Extract media tags into structured descriptors (same shape as worzel's `media` array) instead of directly creating DOM elements. Separate "what content exists" from "how to render it."

**FinkUI**: Consume structured media descriptors. Render containers as web components (`<fink-image>`, `<fink-video>`, `<fink-audio>`, `<fink-widget>`). Each component handles its own loading, error states, and temporal signalling.

**FinkTemporal** (new): Lightweight stream coordinator. Tracks active media, manages dependencies, handles interrupts. Replaces scattered `setTimeout` calls with declarative stream relationships.

**Choice cards**: Extend to show tags (risk badges, skill icons), greyed-out teasers for hidden choices, countdown timers, and multi-select checkboxes.

---

## What to Build First

Both systems benefit from the same foundational work. Priority order:

1. **Choice metadata in the protocol.** Expose choice tags, hidden teasers, and choice mode in `ink_state`. Low-risk, immediately useful for both visual and voice clients. Unblocks richer choice UX on every surface.

2. **Media descriptors in `ink_state`.** Parse `# image:`, `# AUDIO:`, `# VIDEO:`, `# FOLEY:` tags into structured media arrays. Clients render what they can, ignore what they can't. No temporal coordination yet — just "here's what exists at this story position."

3. **Ambient audio via media URLs.** The hybrid approach (option 3): narration stays on the Opus stream, background audio is a URL the client fetches independently. Finkapp already does this; worzel clients start doing it.

4. **Temporal stream model.** Implement the named-stream dependency system. Start with just narration + choices (which is already implicitly sequenced), then add media streams. This is the hard one and can be incremental.

5. **Widget protocol.** Define the bidirectional `postMessage`/MQTT vocabulary for widget ↔ story communication. Implement in finkapp first (where minigames already exist), then expose via worzel's protocol for remote clients.

---

## Open Questions

1. **Should media URLs be absolute or relative to a story base?** The `# basehref:` tag exists. Probably relative with basehref resolution, so stories are self-contained and CDN-portable.

2. **How does server-side mixing work for ESP32?** If an ESP32 can't mix ambient audio with TTS locally, the server needs to mix them into the Opus stream. This requires the server to fetch ambient audio, decode it, mix it with TTS PCM, and re-encode. Feasible but adds latency and complexity. Defer until ESP32 audio testing proves it's needed.

3. **Do we need a `# STYLE:` tag for visual presentation hints?** e.g. `# STYLE:dramatic` to trigger a CSS class. Or should visual styling be entirely client-side, driven by mood/speaker/story metadata? Leaning toward the latter — style is a client concern, mood is a story concern.

4. **How do timed choices interact with voice?** If TTS is still reading choices when the timer fires, what happens? Probably: timer pauses while TTS is active, starts when TTS completes. The timer counts *user thinking time*, not total elapsed time.

5. **Can Ink's external function mechanism support multi-select?** Ink choices are single-select by design. Multi-select needs either external functions (the story calls a function, the pipeline collects inputs, then returns) or a custom gather loop in Ink with sticky choices. The Ink-native approach (sticky `+` choices with a "done" choice) is more portable.
