# MQTT+UDP Transport: Planning Doc

## Why MQTT

Three motivations, in order of importance:

1. **Xiaozhi hardware compatibility.** The Xiaozhi ecosystem supports two transports: WebSocket and MQTT+UDP. Most ESP32 boards use WebSocket over WiFi, but cellular boards (ML307 4G) and some NAT-constrained deployments use MQTT+UDP. Supporting both transports means worzel can accept connections from any Xiaozhi-compatible hardware without firmware modification.

2. **Decoupled event architecture.** Worzel currently has no event bus. Events flow point-to-point: transport → handler → pipeline → transport. This works for single-session voice, but breaks down when we need story state to propagate to multiple observers, background services to react to narrative events, or devices to reconnect to in-progress sessions. MQTT topics give us a publish-subscribe layer that the current architecture lacks.

3. **Session resilience.** WebSocket sessions die on disconnect — the session, dialogue history, and Ink story state are destroyed immediately. MQTT's persistent sessions and QoS levels let a device reconnect and resume where it left off, which matters for battery-powered or cellular devices with unreliable connectivity.

---

## Architecture: How MQTT+UDP Maps to the Existing Transport Interface

The current `Transport` interface is already split along the right boundary:

```typescript
interface Transport {
  sendText(data: string): Promise<void>;     // → MQTT publish (JSON control)
  sendBinary(data: Buffer): Promise<void>;   // → UDP send (Opus audio)
  onText(handler): void;                      // → MQTT subscribe
  onBinary(handler): void;                    // → UDP receive
  onClose(handler): void;
  onError(handler): void;
}
```

MQTT carries the control plane (JSON messages: hello, listen, stt, tts, abort, mcp, ink_state). UDP carries the data plane (binary Opus audio frames). This is exactly the `sendText`/`sendBinary` split.

### Topic Structure

```
worzel/{device_id}/client    — device → server messages (subscribe: server)
worzel/{device_id}/server    — server → device messages (subscribe: device)
worzel/{device_id}/audio/up  — device → server audio (or use UDP)
worzel/{device_id}/audio/down — server → device audio (or use UDP)
```

For the audio topics: MQTT can carry binary payloads (for simplicity / NAT-proof fallback), but the preferred path is UDP for latency. The device negotiates this in the hello handshake.

### New Transport Implementation

```
┌──────────────────────────────────┐
│       MqttUdpTransport           │
│   implements Transport           │
├──────────────────────────────────┤
│ MQTT client (aedes/mosquitto)    │──── JSON messages ───► MQTT broker
│ UDP socket (dgram)               │──── Opus frames ────► UDP port 8884
├──────────────────────────────────┤
│ Session binding:                 │
│   MQTT client-id ←→ UDP addr    │
│   correlate via device_id        │
└──────────────────────────────────┘
```

The rest of the system — protocol router, message handlers, InkPipeline, session manager — sees the same `Transport` interface. No changes needed above the transport layer.

---

## Implementation Plan

### Phase 1: MQTT Broker + Transport (~3 days)

**1.1 Embedded MQTT broker**

Add [Aedes](https://github.com/moscajs/aedes) as a dependency for development and small deployments. Production can use external Mosquitto/EMQX.

```typescript
// src/transport/mqtt-broker.ts
import Aedes from 'aedes';
import { createServer } from 'net';

export function startMqttBroker(port: number, logger: pino.Logger) {
  const aedes = new Aedes();
  const server = createServer(aedes.handle);
  server.listen(port);
  // Auth hook: validate device credentials against same token system
  aedes.authenticate = (client, username, password, callback) => { ... };
  return aedes;
}
```

Files: `src/transport/mqtt-broker.ts` (~80 lines)
Deps: `aedes` (npm)

**1.2 UDP socket server**

```typescript
// src/transport/udp-server.ts
import dgram from 'node:dgram';

export class UdpAudioServer {
  private socket: dgram.Socket;
  private sessions = new Map<string, { address: string; port: number }>();

  // Device sends first UDP packet to register its address (NAT punch)
  // Packet format: [4-byte device_id_hash][Opus frame data]
  // Server responds to same address for the session duration
}
```

Files: `src/transport/udp-server.ts` (~120 lines)

**1.3 MqttUdpTransport class**

Implements `Transport`. Wraps an MQTT client subscription + UDP socket pair for one device session. Correlates MQTT client-id with UDP source address via the device_id from the hello message.

Files: `src/transport/mqtt-udp-transport.ts` (~250 lines)

**1.4 Connection handler**

Accept MQTT connections alongside WebSocket. When a device connects via MQTT and sends `hello`, create a session + `MqttUdpTransport`, wire it to the same protocol router and pipeline.

Files: modify `src/fink/module.ts` (~50 lines), add `src/server/mqtt-server.ts` (~100 lines)

**1.5 Transport type update**

Add `'mqtt-udp'` to the `Transport.type` union in `src/transport/interface.ts`.

### Phase 2: Session Persistence (~2 days)

MQTT's value is wasted if sessions still die on disconnect. This phase makes sessions survive transport loss.

**2.1 Decouple session from transport**

Currently `transport.onClose` → `sessionManager.destroy()`. Change this to:
- `transport.onClose` → `session.state = 'suspended'`
- Start a reconnection timer (configurable, e.g. 5 minutes)
- If device reconnects with same `device_id`, rebind session to new transport
- If timer expires, then destroy

**2.2 Activate InkStateStore**

The `InkStateStore` class already exists (`src/ink/ink-state-store.ts`) with `save()`/`load()` methods and a `data/ink-saves/{deviceId}/{storyId}.json` file structure. It's tested but never instantiated in production. Wire it into the session lifecycle:
- Save Ink state on every choice (story advances)
- Save on transport disconnect (suspended session)
- Load on session resume

**2.3 Persist dialogue history**

Add dialogue serialization to `InkStateStore` or a parallel store. The LLM context window depends on dialogue history; losing it on reconnect breaks conversational continuity.

### Phase 3: Auth Bridging (~1 day)

Xiaozhi devices authenticate via `Authorization: Bearer {token}` header + `Device-Id` and `Client-Id` headers. Worzel uses JWT in URL query param.

**3.1 Accept both auth styles**

In the MQTT auth hook and WebSocket upgrade handler, accept:
- Xiaozhi style: Bearer token in MQTT username/password or CONNECT properties
- Worzel style: JWT in query param

Map both to the same device identity.

**3.2 OTA compatibility**

Xiaozhi devices call an OTA endpoint on startup. Add a compatibility shim that responds to Xiaozhi-format OTA requests with worzel tokens + MQTT broker address.

### Phase 4: Testing & NAT Traversal (~2 days)

**4.1 Integration tests**

- MQTT+UDP transport end-to-end: hello → listen → audio → stt → tts → audio playback
- Session suspend/resume: disconnect, reconnect, verify Ink state preserved
- Mixed transport: start on WebSocket, reconnect on MQTT (or vice versa)
- Auth bridging: Xiaozhi-style headers accepted

**4.2 NAT traversal validation**

UDP through NAT requires the device to send first (punching the hole). Test across:
- Home WiFi routers (usually works)
- Symmetric NAT / carrier-grade NAT (may fail — need MQTT-only fallback)
- Corporate firewalls (UDP often blocked — MQTT-only fallback)

Add fallback: if UDP fails, carry audio over MQTT binary payloads. Higher latency (~50-100ms added) but works through any TCP-capable network.

---

## How MQTT Event Abstractions Help (and Hinder) Fink

This is the harder question. MQTT gives us a pub/sub event bus. The Fink architecture currently has none — events are point-to-point function calls within a single session. What changes when we have a broker?

### What MQTT Topics Enable

**Story event observation.** Today the InkPipeline calls `transport.sendText()` directly with `ink_state`, `stt`, `tts` messages. If these also publish to MQTT topics:

```
worzel/{device_id}/events/ink_state    — narration, choices, story position
worzel/{device_id}/events/stt          — what the user said
worzel/{device_id}/events/tts          — what's being spoken
worzel/{device_id}/events/choice       — which choice was selected
worzel/{device_id}/events/mood         — character emotion changes
```

...then external systems can observe a Fink session without being the primary client:
- A **dashboard** subscribes to `events/#` to show live story progress
- A **logger** records full session transcripts for analytics
- A **companion device** (e.g. a display showing illustrations) subscribes to `events/ink_state` to show scene-appropriate images
- A **parent monitor** watches a child's session in real-time

This is the "temporal model" from the arch overview made concrete — story events published to a bus, with multiple consumers rendering them differently.

**Multi-device story sessions.** Two ESP32 boards in the same room, each playing a different character in a two-player Ink story. Today impossible — sessions are isolated. With MQTT topics:

```
worzel/story/{story_session_id}/narration   — shared narration
worzel/story/{story_session_id}/turn        — whose turn it is
worzel/device/{device_id}/audio             — per-device audio (private)
```

The Ink engine runs once on the server. Each device subscribes to the shared narration topic but has its own audio channel. Turn-taking is coordinated via the `turn` topic. This is a natural fit for Ink stories with multiple readers.

**Background services.** An MQTT subscriber that watches `events/choice` across all sessions and builds analytics (which choices are popular, where do players get stuck, which stories have high completion rates). Or a notification service that alerts when a user reaches a particular knot in a story.

### What MQTT Hinders (or Complicates)

**Ordering guarantees.** The Fink TTS lifecycle depends on strict ordering: `tts:start` → `tts:sentence_start` → [binary audio] → `tts:sentence_end` → `tts:stop`. MQTT QoS 1 guarantees delivery but not ordering under redelivery. QoS 2 preserves order but adds latency (4-packet handshake per message). For the audio stream, we need QoS 0 (fire-and-forget) anyway — latency matters more than guaranteed delivery for 60ms audio frames.

**The pipeline is synchronous.** The InkPipeline's `process()` method is a sequential chain: ASR → classify → act → narrate → read choices. It awaits each step. This is fundamentally a request-response pattern, not an event-driven one. Introducing MQTT between pipeline stages (e.g., publish ASR result, subscribe to classification result) adds latency and complexity with no benefit for the primary flow. The pub/sub layer should wrap the pipeline's outputs, not replace its internals.

**State ownership.** MQTT enables multiple subscribers but doesn't solve who owns the Ink story state. The InkSession is an in-memory object wrapping inkjs's `Story` instance. You can't have two processes both calling `story.Continue()` — Ink's state machine is single-threaded and stateful. The MQTT layer should publish events *from* the authoritative InkSession, not try to distribute the session itself.

**Latency for voice.** The current WebSocket path is: audio frame → server process → decode → ASR → respond. Adding an MQTT broker in the middle adds a hop. For the primary voice loop, we should keep the direct transport path and use MQTT as a *parallel* event fan-out, not as the primary transport for latency-sensitive audio.

### The Right Boundary

MQTT should be an **event observation and coordination layer**, not a replacement for the direct transport path.

```
                          ┌─────────────────────┐
                          │    MQTT Broker       │
                          │  (event fan-out)     │
                          └───────┬─────────────┘
                                  │ publish
                                  │
┌──────────┐   WebSocket/UDP   ┌──┴───────────┐    subscribe    ┌──────────┐
│  Device   │◄────────────────►│  Worzel Core │───────────────►│ Dashboard │
│ (ESP32)   │  (primary path)  │              │                │ Logger    │
└──────────┘                   │ InkPipeline  │                │ Monitor   │
                               │ InkSession   │                │ Analytics │
                               └──────────────┘                └──────────┘
```

The device talks to worzel via WebSocket or MQTT+UDP (its choice). The InkPipeline processes the turn. After each significant event (stt, choice, ink_state, tts, mood change), the pipeline *also* publishes to the MQTT broker. External consumers subscribe to topics they care about.

This means:
- **Primary voice loop:** unaffected by MQTT (same latency as today)
- **Event observation:** zero-cost to the primary path (async publish)
- **Session coordination:** MQTT retained messages for last-known-state
- **Multi-device:** future work, builds on the topic structure

### Ink Interpreter State and MQTT Events

The Ink interpreter (InkSession) has a clean state model:

```
                    ┌──────────┐
         ┌─────────│ Loading   │
         │         └─────┬────┘
         │               │ story.Continue()
         │               ▼
         │         ┌──────────┐
    restore()      │ Narrating │◄──────────────────┐
         │         └─────┬────┘                    │
         │               │ canContinue=false        │
         │               ▼                         │
         │         ┌──────────────┐                │
         └────────►│ Awaiting     │  choose(i)     │
                   │ Choice       │────────────────┘
                   └─────┬───────┘
                         │ no choices + !canContinue
                         ▼
                   ┌──────────┐
                   │ Ended     │
                   └──────────┘

    Special states (can occur during Awaiting Choice):
    ┌──────────────────┐
    │ Awaiting External │  — story called an external function
    │ Input             │    that needs user freeform text
    └──────────────────┘
    ┌──────────────────┐
    │ Story Link        │  — FINK: link tag triggers jump to
    │ (push/pop stack)  │    another story; parent state saved
    └──────────────────┘
```

Each state transition maps to an MQTT-publishable event:

| Ink State Transition | MQTT Event | Topic |
|---------------------|------------|-------|
| Loading → Narrating | `story_started` | `worzel/{did}/events/lifecycle` |
| Narrating (each segment) | `narration` | `worzel/{did}/events/narration` |
| → Awaiting Choice | `choices_presented` | `worzel/{did}/events/choices` |
| Choice selected | `choice_made` | `worzel/{did}/events/choice` |
| → Awaiting External Input | `input_requested` | `worzel/{did}/events/input` |
| External input received | `input_received` | `worzel/{did}/events/input` |
| Story link push | `story_push` | `worzel/{did}/events/lifecycle` |
| Story link pop | `story_pop` | `worzel/{did}/events/lifecycle` |
| → Ended | `story_ended` | `worzel/{did}/events/lifecycle` |
| Variable changed | `variable_changed` | `worzel/{did}/events/state` |
| Mood/emotion change | `mood_changed` | `worzel/{did}/events/mood` |

Retained messages on `events/choices` and `events/state` let a reconnecting client or new subscriber immediately know the current story position without replaying history.

### What This Means for Xiaozhi `{type: "llm", emotion}`

The mood event maps directly. When InkSession encounters a `# mood: happy` tag:
1. The `NarrationSegment.mood` field carries it through the pipeline
2. The pipeline publishes to `events/mood`
3. For Xiaozhi devices with displays: also send `{type: "llm", emotion: "happy"}` on the device's transport
4. For web clients: update the UI with the mood (already happens via `ink_state`)
5. For companion displays: subscribe to `events/mood` and show face animation

One Ink tag, multiple rendering surfaces, zero coupling between them. This is what the arch doc's "temporal model" was describing in the abstract — MQTT makes it concrete.

---

## Dependency Summary

| Package | Purpose | Size | License |
|---------|---------|------|---------|
| `aedes` | Embedded MQTT broker | ~200KB | MIT |
| `mqtt` | MQTT client (for testing, bridge) | ~150KB | MIT |
| `dgram` | UDP socket | Node.js built-in | — |

No new native dependencies. `aedes` is pure JS. `onnxruntime-node` (from the SileroVAD work) is the only native dep being added in this period.

---

## Risks & Open Questions

1. **Do we need MQTT for the primary device transport, or just as an event bus?** If only for event fan-out, we could use a lighter pub/sub (EventEmitter, Redis pub/sub, or even just WebSocket broadcast). MQTT's value is when devices themselves connect via MQTT — i.e., Xiaozhi cellular boards.

2. **Aedes vs external broker.** Aedes is fine for dev and small deployments (<100 connections). Production with hundreds of devices needs Mosquitto or EMQX. This is an operational complexity step-up.

3. **UDP port exposure.** Many hosting providers (Fly.io, Railway, Render) don't support UDP. The MQTT-only fallback (audio over MQTT binary) is essential for cloud hosting. This reduces the latency advantage but maintains compatibility.

4. **MQTT message size limits.** Default max is 256MB (effectively unlimited for our payloads). But some brokers and firewalls limit payload size. Opus frames are tiny (~100 bytes), JSON messages are small (~1KB). Not a practical concern.

5. **Topic ACL.** Devices should only publish/subscribe to their own `worzel/{device_id}/*` topics. Aedes supports this via auth hooks. Need to implement per-device topic authorization.

---

## Timeline

| Phase | Work | Estimate |
|-------|------|----------|
| 1. MQTT broker + transport | Core transport implementation | 3 days |
| 2. Session persistence | Suspend/resume, InkStateStore activation | 2 days |
| 3. Auth bridging | Xiaozhi-compatible auth | 1 day |
| 4. Testing + NAT | Integration tests, network edge cases | 2 days |
| **Total** | | **~8 days** |

Event fan-out (the "MQTT as observation layer" part) can be added incrementally after Phase 1, as it's additive — publish calls alongside existing `transport.sendText()` calls.
