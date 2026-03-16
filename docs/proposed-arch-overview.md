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

## Event Bus Architecture: MQTT-ifying the Ink Engine

### The Minimal API Insight

> "The external API for a simple web ink player is basically pulling a chunk of content versus presenting a choice to the user and relaying. While Ink has much more to it, something like this seems the essence of Ink's minimal engine's interaction with its immediate implementation environment, right? Plus other engines and variable sync events. Can we MQTT-ify it into being event bus based?"
> — danbri

This observation cuts to the heart of it. The entire inkjs API surface used across both worzel and finkapp reduces to six calls:

```
canContinue        → bool
Continue()         → string (+ side-effect: currentTags)
currentChoices     → Choice[]
ChooseChoiceIndex  → void
variablesState[]   → get/set
state.ToJson/LoadJson → serialize/restore
```

Everything else — tags, voices, routing, prompts — is built on top of those six calls. The core loop is:

```
while canContinue → emit content chunks
when !canContinue && choices → present choices, wait
when choice received → ChooseChoiceIndex, loop
when !canContinue && !choices → story ended
```

MQTT-ified, this becomes topic-based messages on the bus:

```
# Engine → Bus (outbound)
module/{id}/content     { text, speaker, tags, environment, spatial }
module/{id}/choices     { choices: [{index, text, tags}], awaiting: true }
module/{id}/state       { variables: {delta}, turnCount, ended }
module/{id}/lifecycle   { status: "ready|suspended|ended" }

# Bus → Engine (inbound)
module/{id}/choose      { index: 2 }
module/{id}/set_var     { name: "diamonds", value: 15, source: "minigame/gem-cave" }
module/{id}/control     { action: "save|restore|suspend|resume" }

# Cross-module (supervisor-mediated)
sync/variables          { source: "ink/manor", deltas: {diamonds: +3} }
sync/spatial            { source: "ink/manor", scene: {facing, sources, environment} }
sync/focus              { active: "ink/manor", previous: "game/gem-cave" }
```

Every module — ink, minigame, inventory, ambient audio — speaks the same topic structure. The ink-specific internals (`Continue()`, `ChooseChoiceIndex`) are *inside* the module, invisible to the bus. From outside, ink is just a thing that emits content, presents choices, and accepts selections. Same as a dialogue tree. Same as a quiz widget. Same as a vibe-coded choose-your-own-adventure that doesn't use Ink at all.

### The Ink Module Adapter

The bus-facing surface of the ink module is tiny:

```typescript
class InkModule implements ModuleBusAdapter {
  private story: Story          // inkjs internals, hidden
  private session: InkSession   // tags, voices, hidden

  handleChoose(msg) {
    this.session.choose(msg.index)     // ChooseChoiceIndex inside
    this.drainContent()                 // while canContinue, publish chunks
  }

  drainContent() {
    while (this.story.canContinue) {
      const text = this.story.Continue()
      const tags = parseTags(this.story.currentTags)
      this.publish(`module/${this.id}/content`, { text, ...tags })
    }
    if (this.story.currentChoices.length > 0) {
      this.publish(`module/${this.id}/choices`, { choices: ... })
    } else {
      this.publish(`module/${this.id}/lifecycle`, { status: "ended" })
    }
  }
}
```

A minigame module has the same shape — it just publishes `content` (frame updates, score) and `choices` (player actions) differently inside. The bus doesn't care.

### Variable Sync on the Bus

The delta-tracking approach generalises cleanly to cross-module variable synchronisation:

```
1. Ink module sets diamonds = 18
2. Publishes: sync/variables { source: "ink/manor", deltas: {diamonds: +3} }
3. Supervisor receives, checks trust tier (can ink/manor write diamonds? yes)
4. Supervisor publishes: sync/variables { source: "supervisor", diamonds: 18 }
5. Minigame module receives, updates its local view
6. Minigame awards 2 gems
7. Publishes: sync/variables { source: "game/gems", deltas: {diamonds: +2} }
8. Supervisor receives, checks trust tier, applies delta (18+2=20)
9. Publishes updated canonical value to all subscribers
```

The supervisor is the **only** authority on the merged variable state. Modules propose deltas. The supervisor applies or rejects based on trust tier, then broadcasts the canonical value.

### What This Buys

- **Ink engine becomes replaceable.** Swap inkjs for a Twine runtime, a Yarn Spinner runtime, or a pure LLM conversation — same bus interface.
- **Minigames don't need special iframe `postMessage` protocols** — they are bus modules with the same topic structure.
- **The voice pipeline** (ASR → classify → TTS) subscribes to `module/*/content` and `module/*/choices` — it doesn't need to know it's Ink underneath.
- **Spatial audio mixer** subscribes to `sync/spatial` — doesn't care who emitted the scene descriptor.
- **ESP32 clients** subscribe to the same topics but ignore spatial. WebXR subscribes and renders fully. Device capability just determines which subscriptions matter.

### What It Costs

Indirection. Right now `ink-pipeline.ts` calls `inkSession.choose()` directly and reads the result. With the bus, it publishes a `choose` message and waits for `content` messages to arrive. That's an async boundary where there wasn't one before. For a single-process server this is overhead with no benefit — you're just routing messages to yourself. It only pays off when modules actually run in different contexts (client vs server, iframe vs main thread).

**The pragmatic approach:** don't build a real MQTT broker for this. Build the topic/message contract as a TypeScript interface. Implement it as direct function calls in-process for now. Swap in actual pub/sub transport later if and when modules genuinely run across boundaries. The abstraction is the value, not the infrastructure.

---

## Temporal Tiers: Story Time, Session Time, Wall Time

### The Problem

> "We have to watch that we don't crappily try to mutate Ink into a real-time game. It is about story. And yet we are allowing the story to intersperse with potentially intensely real-time episodes and media items — gaussian splats, videos, minigames, music, moody audio, songs and foley and 3D audio and so on."
> — danbri

> "These immersives must stay somehow optional and icing on the cake, since many environments won't allow them all, including accessibility concerns too. So if a Quest WebXR headset has direction of view, it only ought to be exploited when, for example, a 3D splat scene showing the valley, or a panorama, is shown."
> — danbri

> "So there is also something subtle going on with respect to time. Firstly, games loop and reset and play is paused and so on routinely. Core game, this is fine — like putting down a book. The more immersive widgets are used, the more time gets more complex, for example some might be multiplayer."
> — danbri

There are two different time regimes colliding here, and the architecture must acknowledge that explicitly rather than papering over it.

**Ink time is discrete.** It advances by turns. You `Continue()`, you get text, you choose, you `Continue()` again. Between turns, time doesn't exist. The story is frozen. Put down the book, pick it up a week later — nothing changed. This is the bedrock and it must stay this way.

**Immersive time is continuous.** A gaussian splat scene has a render loop. A minigame has a game clock. Multiplayer has wall-clock coordination. Audio has playback position. These things tick whether you're paying attention or not (or they *could*).

The obvious mistake would be tightly coupling them — making Ink's turn progression depend on real-time events, or making real-time modules block on Ink choices. But the relationship between these time regimes is subtler than a clean separation, as the variable sync discussion below shows. This is still being figured out.

### Ink as Conductor (Tentative Model)

One way to think about the relationship: Ink cues immersives but doesn't synchronise with them. Whether this holds up cleanly in practice is an open question — the live variable sync from widgets (see below) blurs the line.

```ink
The valley opens before you. # scene:valley_splat # mode:spatial

+ [Look closer at the ruins]
  ~ viewed_ruins = true
  The stones are ancient...

+ [Continue along the path]
  You press on.
```

The `# scene:valley_splat` tag **cues** the splat viewer module. But Ink doesn't wait for it to load, doesn't track the user's gaze direction, doesn't care how long they look around. Ink issued the cue and is now sitting at a choice point, frozen, timeless, as it should be.

The splat viewer runs in its own time regime. It might notice the user looked at the ruins and *highlight* that choice in the UI. But it doesn't *make* the choice. Ink remains the authority on narrative progression. (At least, that's the current thinking — the interaction between live widget state and Ink's turn structure may need more nuance.)

### The Three Tiers (Working Model)

A provisional framing — useful for thinking about the problem, but the boundaries may shift as real content tests them:

```
Tier 0: Story time (discrete, turn-based)
  - Ink advances by explicit action only
  - Saves/restores perfectly (it's just state)
  - "Put down the book" always works
  - ALL narrative progression lives here

Tier 1: Session time (bounded continuous)
  - Minigames, splat viewers, audio playback
  - Has a start, runs, has an end
  - Cued by Tier 0, variables sync back to Tier 0 incrementally
  - Can be interrupted/abandoned — Ink handles gracefully
  - "I skipped the minigame" is always a valid outcome
  - But live sync means Tier 0 state changes during Tier 1 — the tiers leak

Tier 2: Wall time (unbounded continuous)
  - Multiplayer sessions, live events
  - Exists independently of any single player
  - Ink can acknowledge it but never depend on it
  - "The festival was happening when you passed through"
```

The working hypothesis: **information flows upward (Tier 2 → 1 → 0) as discrete variable-sync events.** A minigame runs continuously (Tier 1) and syncs variables back to Ink (Tier 0) as they change — gem by gem, not just a summary at the end. The bus carries each `gems_collected += 1` as it happens, so the story's variable state stays live even while the widget runs. There may also be a summary when the widget closes, but the incremental sync is the preferred model — it means the story can react at any point, and if the widget is interrupted or abandoned, whatever was collected so far is already in Ink's state. A multiplayer lobby exists in wall time (Tier 2) but Ink only sees variables like `other_players_present = true`. The exact boundaries between tiers, and how much live sync is appropriate, are still being worked out.

### On the Bus

```
# Ink cues an immersive (Tier 0 → Tier 1)
module/ink/cue          { target: "splat/valley", mode: "spatial" }

# Splat runs in its own time, publishes hints
module/splat/hint       { gaze_target: "ruins", confidence: 0.8 }

# UI can use hints to style choices — but Ink doesn't see these
# Eventually the player chooses (Tier 0 event)
module/ink/choose       { index: 0 }

# Minigame cued, runs, syncs variables live as they change
module/minigame/sync    { deltas: { gems_collected: +1 } }
module/minigame/sync    { deltas: { gems_collected: +1 } }
module/minigame/sync    { deltas: { gems_collected: +1 } }
# Each gem syncs individually — story state stays current
# Optional summary on close, but incremental sync is primary
module/minigame/close   { final: { gems_collected: 3, completed: true } }
```

### Capability Fallback

A Tier 1 module that can't run (no WebXR, no GPU, screen reader active) just doesn't. Ink cued it, nobody answered, that's fine. The choice UI still works. The story still works. The valley scene becomes a text description instead of a splat. The minigame becomes "you found 3 gems" as a default outcome or a simpler fallback.

```
# Module capability negotiation on the bus
module/splat/status     { available: false, reason: "no-webxr" }

# Supervisor falls back
module/ink/set_var      { name: "scene_mode", value: "text" }
# Ink can branch on this if it wants, or just continue
```

The working principle is that immersives are **decorators on the story**, not structural dependencies — the story should be complete without them. When present, they enrich: a splat scene gives spatial presence, a minigame gives agency, spatial audio gives mood. When absent, Ink carries on. How well this holds when widgets are syncing variables live (not just delivering a final result) is something the diamond mine stories are currently testing in practice.

### Multiplayer: The Genuinely Hard Case

Tier 2 is where the "put down the book" contract breaks, because multiplayer introduces the one thing Ink can't have: time pressure. "Another player is waiting for you" creates urgency that violates the discrete-time guarantee.

The answer: multiplayer moments are explicitly opt-in, bounded in duration, and Ink always has a timeout path. If you walk away, the story continues with a default. The festival happened without you. That's fine. That's a story too.

---

## Accessible Alt Paths: Widgets as Variable Suppliers

### What We Actually Have

The current finkosphere content tells this story concretely. Two diamond mine Ink files are linked to each other, and both are cutely tied to a Hampstead story — revisiting locations with new themes revealed through shared variables. Hampstead has no immersives currently except one easter egg video clip. The diamond mines have two trivial immersives — essentially the same widget with different configurations — whose impact on the finkosphere is basically supplying you with variables.

> "We therefore need a way for authors and storytelling users of these widgets to easily rely on accessible alt paths that render through the game's core UX — choices and text. So a starter kit of logic puzzles, dice rolls, quizzes — toki pona, morse, knowledge of topics — should be available alongside the delivery engine and fink format. Would do the job here. Storytelling in this world involves a lot of letting go."
> — danbri

This is the decorator principle from the temporal tiers made practical. A widget's effect on the story flows through variables — but not as a single lump at the end. In the diamond mines, variables sync live, gem by gem. The accessible fallback needs to satisfy the same variable contract through choices and text, and similarly updates incrementally (each choice sets a variable). The widget is a *flavour* of the interaction, not the interaction itself — or at least, that's the aspiration. How much of the experience is "flavour" versus "the point" probably varies by widget and by story.

### The Letting Go Principle

> "Storytelling in this world involves a lot of letting go."
> — danbri

The implication: authors write stories that work without their immersives. A radio play works without the listener seeing the actors. A novel works without illustrations. A fink story works without its gaussian splats, minigames, and spatial audio. These enrich; they do not carry.

In practice this suggests every widget should declare its **variable contract**: what it writes back to the story. A gem-matching minigame writes `gems_collected: int` and `puzzle_solved: bool`. In the diamond mine stories, those variables sync gem by gem as the player collects them — the story's state is always current, not waiting for a final summary. Everything else — the animations, the scoring, the spatial audio — is presentation. The story only sees the variables. (Whether this clean separation always holds, or whether some immersives are more deeply entangled with the story experience than "just variables", is an open question.)

### Starter Kit: Core Fallback Interactions

A library of text-and-choice-based fallback interactions that any fink story can use in place of (or alongside) immersive widgets:

| Fallback type | How it works in choices and text | Variables it supplies |
|---------------|----------------------------------|---------------------|
| **Logic puzzle** | Present a riddle or sequence puzzle as narrated text. Choices are candidate answers. Wrong answers loop with hints. | `solved: bool`, `attempts: int` |
| **Dice roll** | "You reach into the dark. Let's see what luck brings." Choice: "Roll the dice." System generates outcome, narrates result. | `roll: int`, `outcome: string` |
| **Quiz (knowledge)** | Narrator asks a question about a topic. Choices are multiple-choice answers. Can draw from tagged question banks. | `correct: bool`, `score: int` |
| **Quiz (toki pona)** | "The inscription reads: *telo li pona*. What does it mean?" Choices translate. Teaches through play. | `understood: bool`, `words_learned: int` |
| **Quiz (morse)** | "The signal flashes: ·· ·—· ·—·· ·—·· ··· You tap out a reply." Choice selects the decoded word. | `decoded: bool`, `message: string` |
| **Timed choice** | A standard Ink choice point with `# timer:Ns:default`. No widget needed — the timer is in the protocol. | `chose_in_time: bool`, `choice_index: int` |
| **Accumulator** | "You search the cave." Multiple sticky choices let you pick up items one by one, then "Done." | `items: string[]`, `count: int` |

These are not lesser experiences. A well-written quiz about the history of Hampstead Heath, delivered through voice with characterful narration, can be more engaging than a flashy but shallow drag-and-drop widget. The text-and-choice path is the *primary* path. The widget is the optional upgrade.

### Authoring Contract

For a fink story to use this pattern:

```ink
// The widget path (when available)
{ widget_available("gem-cave") }:
  # WIDGET:gem-cave config:easy
  // Widget runs, syncs gems_collected incrementally as player collects
  // Sets puzzle_solved on completion or abandonment

// The fallback path (always available)
{ not widget_available("gem-cave") }:
  -> gem_cave_text_version

=== gem_cave_text_version ===
The cave glitters with embedded crystals.
You'll need to work out which ones are real diamonds.

+ [Test the clear crystal] # voice_hint:clear, transparent
  It scratches glass. That's a diamond.
  ~ gems_collected = gems_collected + 1
  -> gem_cave_text_version

+ [Test the cloudy stone] # voice_hint:cloudy, dull
  ite crumbles. Just quartz.
  -> gem_cave_text_version

+ [You've collected enough] # voice_hint:done, enough, finished
  ~ puzzle_solved = (gems_collected >= 3)
  -> gem_cave_done
```

Both paths write the same variables. Both paths are complete experiences. The widget path is richer for clients that support it. The text path works everywhere — ESP32, phone, screen reader, Twilio, plain terminal.

### Delivery

The starter kit fallbacks ship as part of the fink format tooling, not as individual story assets. An author tags a widget point in their story; the tooling generates the fallback scaffolding (or the author writes their own). The delivery engine checks client capability at runtime and routes to the appropriate path. The story's variable contract is satisfied either way.

This is one reading of what "storytelling in this world involves a lot of letting go" means in practice: let go of assuming your audience has a screen, a GPU, spatial audio, or even sight. Write for the variables. Let the surfaces handle the rest. Whether this is the whole picture, or whether there's more to "letting go" than capability fallback, is worth sitting with.

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

## Finkapp and the Client-Middleware Lesson

### What Finkapp Is Today

Finkapp is a pure client-side interactive fiction player hosted as static files. It runs entirely in the browser with no server or middleware layer. Its modules — all attached to `window` — include:

- **FinkInkEngine** — compiles raw Ink source in-browser via inkjs, processes tags (`IMAGE:`, `BG:`, `FINK:`, `MINIGAME:`, `FOLEY:`, `AUDIO:`, `speaker:`, `voice:`), manages story state and knot tracking
- **FinkPlayer** — coordination layer: initialises modules, loads stories via HTTP fetch, handles bookmarks and restart
- **FinkUI** — DOM rendering: narrative paragraphs, tappable choice cards, image/video display, stats bar
- **FinkSandbox** — fetches external `.fink` files with duplicate-load detection
- **FinkNavigation** — URL hash-based deep linking and knot-level navigation
- **FinkBreadcrumb** — visual trail of visited knots and FINK file transitions
- **FinkFoley** — synthesised sound effects via Web Audio API
- **FinkAudio** — audio file playback for soundtrack and ambient audio
- **FinkMinigames** — embedded games (chess, gems, gridluck) with a slider window for sizing/pausing
- **FinkDevPanel** — developer tools with swimlane event logging, state inspection, log filtering

Interaction is visual and tap-based. There is no voice input, no LLM classification, and no TTS. Stories are fetched as raw `.fink` (Ink source) files and compiled client-side. Tag processing — including `speaker:` and `voice:` tags that would drive TTS in a voice context — is handled entirely inside `FinkInkEngine.continueStory()`.

### The Architectural Problem

Finkapp is a monolith. The Ink engine, tag interpretation, navigation logic, media handling, and visual rendering are all fused into one browser application. This means:

1. **No voice client can share the story engine.** Worzel's Fink reimplements Ink session management, tag parsing, and choice handling server-side because there's nothing to import from finkapp.
2. **No accessible client can be built on top.** A screen-reader-friendly or voice-only interface would need to reimplement all of finkapp's story logic — or become another monolith.
3. **ESP32 boards with displays can't participate.** A small colour TFT on an ESP32 is a legitimate rendering surface for interactive fiction, but it can't run a browser-based monolith. Without a middleware layer, it gets nothing.
4. **Tag semantics are locked to one rendering mode.** `speaker:` and `voice:` tags are parsed but only used for visual display. `FOLEY:` tags trigger Web Audio synthesis. On a different surface these same tags should drive TTS voice selection, hardware audio playback, or character portraits on a small screen — but the interpretation is hardcoded.

### The Worzel Lesson: Client-Middleware Separation

Worzel already demonstrates the right pattern. Its architecture cleanly separates:

- **Middleware** — InkSession, InkRouter (three-tier utterance classification), voice profile resolution, tag parsing, story state management, TTS pipeline, LLM-powered discussion and meta-query modes
- **Clients** — browser web client, ESP32 hardware client, Twilio phone bridge — all connecting to the same middleware over the same WebSocket protocol

The same story, the same `speaker:`/`voice:`/`mood:` tags, the same discussion mode, the same choice matching logic serves every client. A bug fix to InkRouter improves voice matching on the phone, the browser, and the ESP32 simultaneously.

### What Finkapp Should Become

Finkapp should adopt the same client-middleware split:

**Story middleware** (shared, runs server-side or as a portable engine):
- Ink compilation and session management
- Tag parsing and semantic interpretation (`speaker:`, `voice:`, `mood:`, `IMAGE:`, `FOLEY:`, `MINIGAME:`, `AUDIO:`, `BG:`)
- Navigation logic (FINK cross-story links, backstack, deep linking)
- State management (bookmarks, inventory, story variables)
- Choice presentation (what the choices are, not how they look)
- InkRouter-style classification (for voice clients) and discussion/meta-query modes

**Visual client** (the current finkapp, refactored):
- DOM rendering of narrative text with animation
- Image and video display
- Tappable choice cards
- Minigame embedding and slider window
- Theme and CSS
- Dev panel

**Voice client** (worzel's Fink, connecting to shared middleware):
- Voice input via ASR
- InkRouter classification of utterances against choices
- Multi-character TTS driven by `speaker:`/`voice:`/`mood:` tags
- Discussion and meta-query modes for non-visual story exploration
- Foley and audio playback via server-side or hardware audio

**Hardware clients** (ESP32 variants):
- Headless ESP32 with speaker — voice-only, same as voice client
- ESP32 with colour TFT — renders narrative text, character portraits, choice list on small screen; voice or button input
- ESP32 with e-ink — static story text and choices; button input

### Accessibility Falls Out of the Architecture

The point isn't to build a separate "accessible version." It's that once the story engine is middleware, accessibility is just another client surface:

- **Blind users** get the voice client: multi-character TTS distinguishes speakers, discussion mode explains context, meta-query mode describes choices naturally. The `speaker:`/`voice:`/`mood:` tags aren't decorative — they're accessibility infrastructure.
- **Low-vision users** get the visual client with standard screen reader support, because the client only handles rendering (which can be made ARIA-compliant) rather than also being the story engine.
- **Users on constrained devices** get the ESP32 client that matches their hardware — colour display, e-ink, or audio-only.
- **Phone users** get the same stories via the Twilio bridge.

The tags in the Ink stories serve every surface: `speaker:` drives TTS voice selection on voice clients, character name display on visual clients, and portrait selection on ESP32 TFTs. `FOLEY:` drives Web Audio synthesis in the browser, hardware audio on ESP32, and server-side audio mixing on voice clients. One authored story, many rendering surfaces, no rewrites.

The architecture makes "any human, any device, same stories" possible. A monolith makes it impossible.

### The Counter-Argument: Edge-First and the Web Platform

The previous section overstates the case for server-side middleware. Worzel has its own problems: it requires a costly central server running Node.js, WebSocket infrastructure, LLM API keys, and TTS services. Every concurrent session burns compute. Finkapp, by contrast, runs on a CDN for pennies — the entire story engine executes in the user's browser with zero server cost.

**The web platform is catching up.** Browser-native capabilities increasingly cover what worzel does server-side:

- **Web Speech API** provides ASR and TTS directly in the browser — no server roundtrip, no API keys, no per-minute billing. Voice quality is improving rapidly.
- **WebLLM / on-device models** can run small language models client-side for utterance classification, discussion mode, and meta-queries. The InkRouter's three-tier classification doesn't inherently require a server.
- **Web Audio API** already powers finkapp's foley system with zero latency. Server-side audio mixing adds latency for no gain on capable devices.

**The `ooOO` format is designed for the edge.** FINK's `ooOO\`...\`` tagged template literal is a modernised JSONP: it wraps raw Ink source in executable JavaScript that can be served from any static host, loaded cross-origin, and executed in a sandboxed V8 context (32MB memory, 5-second timeout). No server compilation step, no API endpoint — just a `.fink.js` file on a CDN. This is a deliberate architectural choice that favours distribution over centralisation.

The honest position: **the middleware doesn't have to be a server.** It could be a shared JavaScript module — an importable story engine that runs in the browser for visual clients, on Node.js for voice clients that need server-side TTS, and compiled to WASM for ESP32. The separation is between "story logic" and "rendering surface," not between "server" and "client."

### The Real Unsolved Problem: Temporal Coordination

The deeper architectural gap — felt in both worzel and finkapp — is the absence of a shared temporal model. Interactive fiction with embedded media is fundamentally a timing problem, and neither system has a principled answer.

**Where timing matters today:**

In finkapp, timing is managed through scattered `setTimeout` calls with hardcoded delays:
- Text paragraphs stagger at 150ms intervals (`fink-ink-engine.js`)
- Minigame launch waits 800ms after tag processing
- Window state transitions animate over 350ms CSS durations
- Narrative resumption after minigame completion delays 100ms for DOM settlement

In worzel, timing is equally ad hoc:
- Audio packets pace at 60ms intervals after an initial 5-packet burst (`audio-rate-controller.ts`)
- Story loading delays 100ms before fetch
- Interrupt handling (user speaks while TTS is playing) aborts via `AbortController` but has no model of "what was the user interrupting" or "how far through the current segment were we"

**Where timing will break:**

The hallmark-parody story in `hampstead.fink.js` already demonstrates the problem: a `# VIDEO:` tag embeds an MP4 clip mid-narrative. The video has its own duration. The narrative has text that should appear after the video. But there's no coordination — the story engine doesn't know when the video ends, doesn't pause narrative flow during playback, and can't synchronise foley or audio cues to video timestamps.

As stories get richer, this gets worse:
- A character speaks while a background video plays — the `speaker:` TTS and the video audio need mixing, or the video needs to pause during speech
- A minigame runs in "mini-live" mode (the slider's embedded state) while narrative continues — two temporal streams running simultaneously, each potentially generating audio and visual events
- A foley cue (`# FOLEY: thunder`) should coincide with a specific moment in a video or animation, not just fire-and-forget at tag-processing time
- An interrupt (user taps a choice, or speaks over TTS) needs to know what's currently playing to decide what to cancel, what to fade, and what to keep

**What a temporal model needs:**

The system needs a lightweight scheduler that tracks concurrent media streams and their relationships:

1. **Streams** — each active medium (narrative text animation, TTS playback, video, minigame, foley, background audio) is a named stream with a known or estimated duration
2. **Sequencing** — `after(stream)`, `with(stream)`, `at(stream, timestamp)` — declarative relationships between streams, not hardcoded `setTimeout` values
3. **Interrupts** — when the user acts (taps choice, speaks, presses button), the model knows which streams are active, can cancel/fade/pause them by policy, and can record the interrupt point for resumption or logging
4. **Surface-independence** — the temporal model describes *what happens when*, not *how it renders*. A visual client animates text over 150ms; a voice client speaks it over 2 seconds; an e-ink client displays it instantly. The model accommodates all three without surface-specific timing constants

This isn't a rendering framework or a media player. It's a coordination layer that sits between the story engine (which produces events with temporal semantics) and the client surface (which renders them with surface-specific timing). It's the piece that both worzel and finkapp are missing.

### Minigames Are Not Black Boxes

The finkapp minigame integration reveals a related architectural tension. Minigames communicate with the story engine via a well-defined postMessage protocol:

- **Story → Minigame:** launch with parameters (`# MINIGAME: mudslider mode=cave controls=dpad`), pause/resume signals
- **Minigame → Story:** completion events with result payloads (`{ success, score, variables }`), which update Ink story variables (diamonds, chess_won) and trigger narrative continuation

This protocol is good — it's the right pattern for decoupling. But it treats minigames as opaque: the story engine doesn't know what's happening *inside* the minigame. It can't:

- Synchronise narrative events with minigame state (e.g., a character comments when the player reaches a certain score)
- Coordinate audio between the minigame's own sound and the story's foley/audio layers
- Present minigame progress to non-visual clients (a voice client can't describe a gems board it can't see)

The slider window design (full / embed / mini-live / mini-paused) acknowledges this tension — it gives the user control over how much screen space the minigame occupies relative to the narrative. But it's a visual solution to what is partly a temporal and informational problem.

For multi-surface support, minigames need to expose a richer event stream: state summaries that a voice client can narrate, audio channel declarations that a mixer can balance, and timing signals that the temporal model can coordinate with narrative flow. The postMessage protocol is the right transport — it just needs a richer vocabulary.

---

## Xiaozhi Protocol Compatibility

### Background

[Xiaozhi](https://github.com/78/xiaozhi-esp32) (小智) is an open-source ESP32 voice assistant platform with a large Chinese developer community (44k+ GitHub stars). It defines a WebSocket protocol for ESP32 ↔ server communication that has become a de facto standard for ESP32 voice hardware. The official console is at [xiaozhi.me](https://xiaozhi.me); developer docs at [xiaozhi.dev](https://xiaozhi.dev/en/docs/).

Worzel's WebSocket protocol is already substantially compatible with Xiaozhi's. This is architecturally significant: it means Xiaozhi-compatible ESP32 hardware — dozens of board designs, cases, and accessories from the Chinese maker ecosystem — can potentially connect to a worzel server with minimal adaptation.

### Protocol Comparison

**Identical or directly compatible:**

| Message | Xiaozhi | Worzel | Notes |
|---------|---------|--------|-------|
| Handshake | `{type: "hello", version: 1, transport: "websocket", audio_params: {format: "opus", sample_rate: 16000, channels: 1, frame_duration: 60}}` | Same structure, same fields | Feature negotiation differs slightly (`features: {mcp: true}` vs `features: ["tts", "stt"]`) |
| Binary audio | Raw Opus frames, 16kHz mono, 60ms | Raw Opus frames, 16kHz mono, 60ms | **Identical wire format** (Xiaozhi v1) |
| Listen control | `{type: "listen", state: "start"/"stop"/"detect", mode: "auto"/"manual"/"realtime"}` | Same structure, same states | **Identical** |
| ASR result | `{type: "stt", text: "..."}` | `{type: "stt", text: "..."}` | **Identical** |
| TTS lifecycle | `{type: "tts", state: "start"/"stop"/"sentence_start"}` | Same, plus `"sentence_end"` | Worzel superset; Xiaozhi clients ignore unknown states |
| Abort | `{type: "abort", reason: "..."}` | `{type: "abort", reason: "..."}` | **Identical** |
| MCP/IoT | `{type: "mcp", payload: {jsonrpc: "2.0", method, params, id}}` | `{type: "mcp", method, id, params}` — also `{type: "iot", descriptors}` | Same intent, envelope differs |

**Xiaozhi-only messages:**

| Message | Purpose | Worzel equivalent |
|---------|---------|-------------------|
| `{type: "llm", emotion: "happy"}` | Drive facial expression on device display | None — worzel uses `mood:` Ink tags, but doesn't send emotion to device |
| `{type: "system", command: "reboot"}` | Remote device management | None |
| Protocol v2/v3 binary framing | Structured binary wrapper with timestamps | Worzel uses raw Opus (equivalent to Xiaozhi v1) |

**Worzel-only messages:**

| Message | Purpose | Xiaozhi equivalent |
|---------|---------|-------------------|
| `{type: "goodbye", reason}` | Graceful disconnect | Not documented; connection just closes |
| `{type: "error", code, message}` | Structured error reporting | Not documented |
| `{type: "input_ignored", reason}` | Explain why input was skipped (empty ASR, low audio) | Not documented |
| `{type: "tts", state: "sentence_end"}` | Mark end of sentence audio segment | Not present; only `sentence_start` and `stop` |
| `ping`/`pong` | Application-level keepalive | Uses WebSocket-level ping/pong or server timeout |

**Authentication differs but is bridgeable:**

| | Xiaozhi | Worzel |
|--|---------|--------|
| **Step 1** | Device calls OTA endpoint with MAC address | Client calls `POST /api/ota` with `device_id` |
| **Step 2** | Bearer token in `Authorization` header; `Device-Id` and `Client-Id` in headers | JWT in URL query parameter `?token=...` |
| **Binding** | 6-digit activation code flow via xiaozhi.me console | Direct token issuance |

### Server Architecture Comparison

Both systems follow the same pipeline pattern but diverge in orchestration:

```
Xiaozhi:  Device → WebSocket → VAD → ASR → Intent → LLM → TTS → Device
Worzel:   Device → WebSocket →       ASR → InkRouter/LLM → TTS → Device
```

Key differences:

| Aspect | Xiaozhi | Worzel |
|--------|---------|--------|
| **VAD** | Server-side SileroVAD before ASR | Client-side (listen start/stop signals) |
| **Intent** | Dedicated intent classifier between ASR and LLM | InkRouter's three-tier classification (exact/fuzzy/LLM) integrated with Ink story state |
| **Story engine** | None — general-purpose chatbot | InkSession manages narrative state, knots, choices, cross-story navigation |
| **Speaker ID** | 3D-Speaker voiceprint recognition | None |
| **Memory** | Short-term + mem0ai cloud | Ink story variables + session state |
| **TTS providers** | 10+ Chinese providers (Volcano, iFlytek, CosyVoice, etc.) | Google Cloud TTS, with voice profile system |
| **ASR providers** | FunASR, SherpaASR, Alibaba/Tencent/Baidu cloud | Google Cloud Speech-to-Text |
| **LLM** | Qwen, DeepSeek, ChatGLM, Gemini, Ollama | Claude, with discussion and meta-query modes |
| **Deployment** | Python server + Java management API + Vue UI | Node.js/TypeScript monolith |

### What Compatibility Means in Practice

**A Xiaozhi ESP32 board connecting to worzel would need:**

1. **Auth adaptation** — either worzel accepts Xiaozhi-style `Authorization` headers, or the ESP32 firmware is configured to pass the token as a URL parameter. This is a thin translation layer.

2. **Feature negotiation** — worzel's hello response should advertise capabilities the Xiaozhi firmware understands. The `features` field format differs (`{mcp: true}` vs `["mcp"]`) but the semantics overlap.

3. **Emotion/expression mapping** — Xiaozhi devices with displays expect `{type: "llm", emotion: "happy"}` messages to show facial expressions. Worzel could map its `mood:` Ink tags to these emotion messages, giving ESP32 displays character-appropriate expressions driven by the story.

4. **No VAD change needed** — Xiaozhi firmware already sends `listen` start/stop, which is what worzel expects. Server-side VAD is optional in both systems.

**What worzel gains:**

- Access to 70+ ESP32 board configurations from the Xiaozhi ecosystem
- Hardware designs with displays (round LCDs, TFTs), speakers, microphones, and cases already manufactured and available
- A large community of firmware developers familiar with the protocol
- The `{type: "llm", emotion}` message as a channel for driving device displays from Ink `mood:` tags — character expressions on hardware screens

**What the Xiaozhi ecosystem gains:**

- Interactive fiction as a use case beyond general-purpose chatbot
- Multi-character voice with `speaker:`/`voice:` tag-driven TTS profiles
- Narrative state management (save/restore, bookmarks, cross-story navigation)
- InkRouter's structured choice matching instead of free-form LLM chat

### Compatibility Roadmap

1. **Immediate (no protocol changes):** A Xiaozhi ESP32 board can connect to worzel today if auth is adapted. The hello/listen/stt/tts/abort lifecycle and Opus audio framing already match. The board won't show emotions or use MCP, but voice interaction works.

2. **Short-term:** Add `{type: "llm", emotion}` output to worzel, mapped from Ink `mood:` tags. This lights up Xiaozhi displays with story-driven expressions. Accept Xiaozhi-style auth headers alongside URL-param tokens.

3. **Medium-term:** Align MCP message envelopes. Xiaozhi wraps JSON-RPC in `{type: "mcp", payload: {...}}` while worzel flattens it to `{type: "mcp", method, params, id}`. Either adopt Xiaozhi's envelope (it's cleaner) or support both.

4. **Longer-term:** Explore Xiaozhi's MQTT+UDP transport as an alternative for constrained networks. MQTT for control plane, UDP for audio — this matters for cellular-connected ESP32 boards (ML307 4G) where WebSocket overhead is significant.

---

## Next Steps

1. Turn the "what exists" section into a typed internal schema and interface spec. The current TypeScript types (Session, DialogueEntry, AudioParams, NarrationSegment, InkChoice) are adequate for today but won't support scenes, multi-participant, or media without extension.
2. Extract shared audio module from duplicated web client code.
3. Add session-level integration tests that simulate multi-turn Fink sessions with ASR-realistic input.
4. Prototype Xiaozhi ESP32 board connecting to worzel — validate auth bridging and confirm the hello/listen/tts lifecycle works end-to-end with real hardware.
5. Map Ink `mood:` tags to Xiaozhi `{type: "llm", emotion}` messages for display-equipped ESP32 boards.
