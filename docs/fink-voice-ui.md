# Fink voice UI: story choice, pictures, talk control, own-voice rejection

November 2026. Client: `fink/client/fink.js`, `fink/client/fink-echo-pilot.js`.
Server: `src/fink/module.ts`, `src/ink/story-manager.ts`, `src/ink/ink-session.ts`,
`src/ink/media-resolver.ts`, `src/ink/fink-js-extractor.ts`.

## What was wrong (worzel.fly.dev/fink, 2026-11-01)

| Fault | Cause |
|---|---|
| Only one story could be played | The server started `FINK_DEFAULT_STORY` (live: `radio-foundation-quiz`) and the client had no way to ask for another. The voice `menu` story was not the default on the live server |
| Glitch stories did not load | `FINK_EXTERNAL_HOSTS` is not set in `fly.toml`, so the `menu` story's Glitch Corner links fail. Also, the `.fink.js` extractor captured *cooked* template text and only the last block. The glitchcan contract (`@foafos/backticks`) is raw text, all `oooOO` blocks, joined by a newline. Cooked capture turns `https:\/\/` into `https://`, which ink reads as a comment |
| Pictures missing or wrong | `# IMAGE:` was sent as the raw tag value, not resolved against `# BASEHREF:` or the story URL; a global BASEHREF was lost after the first line; the first `ink_state` of a story never carried images |
| Talk button | No press-to-talk in the browser path: an always-on recogniser with a mute toggle. The server-ASR path (Firefox) called `querySelector('button.mic')`, which does not exist, so it threw on the first turn. "Start Over" sent an event nobody handled |
| Hears itself | Gating used the TTS `stop` message plus the queued audio length. It does not know about output delay (Bluetooth), other tabs or devices, or audio still playing after a stop |
| Layout | The Fink window was a fixed 520x700 at a fixed offset (off-screen on phones) and `fink-app` was 28 px taller than its window, so the footer was clipped |

## Own-voice rejection

Three layers, from most to least reliable:

1. Hold to talk (the new default). The user says when they speak. Pressing stops Fink's
   voice (and the server pipeline, via `abort`), and audio that arrives while the button is held
   is dropped. This removes self-hearing in the common case without any signal processing.
2. State. In hands-free mode the client drops recognition results while it is speaking and
   reopens the mic only after the queued audio has drained (`AudioPlayer.msUntilIdle`) plus a margin.
3. Pilot tone (`?pilot=1`, experimental). While audio plays, `EchoPilotEmitter` adds an
   18.0-19.1 kHz tone at about -30 dBFS. `EchoPilotDetector` reads a separate microphone stream
   with echo cancellation, noise suppression and AGC off (with AEC on, the browser subtracts its
   own output, pilot included), runs an FFT, and reports `present` while any pilot tone is 15 dB
   above the 17-20 kHz band median, with a 400 ms hangover. Hands-free listening waits while
   `present` is true. Because the detector hears the actual speaker output, it covers Bluetooth
   delay and Fink audio from another tab or another device in the room.

   The pilot carries a small number: frames of three 100 ms symbols, `[SYNC, d1, d0]`, on four
   tones 375 Hz apart, so ids 0-8 (`?pilot_id=`). Frequency steps are phase-continuous (one
   oscillator), so they do not click. `?pilot_alt=1` alternates the tone between the left and
   right channels per symbol, as suggested; with one microphone this shows only as a level
   change, so the code does not depend on it.

### Effect on Whisper

None by construction. The server path (and Whisper) uses 16 kHz audio; resampling to 16 kHz
low-passes at 8 kHz and removes the pilot before the encoder. Whisper does not need a patch.
The browser's own recogniser uses its own capture, also band-limited for speech. Detection is
a separate stream and is never sent to the server.

### Test results

- Loopback in headless Chromium (emitter routed into the detector through a
  `MediaStreamDestination`): `present` went true within 1.5 s, id 5 decoded, `present` went
  false within 0.8 s after stop. This proves the code path only.
- Not tested: acoustic path (speaker to air to mic). This container has no audio hardware.
  Measure on real devices before turning it on by default: log `detector.snrDb` while Fink speaks.

### Known limits

- Many laptop and phone speakers and mics roll off above 16-18 kHz; the margin may be small.
- Bluetooth headsets in call mode (HFP, 8/16 kHz), phone lines (Twilio) and the ESP32 client
  (16 kHz) cannot carry the pilot. For those, use layers 1 and 2, or an in-band mark below
  8 kHz, which Whisper would then hear.
- Some children, young adults and animals hear 18 kHz.
- The detector opens a second microphone stream. Some mobile browsers allow only one.

## Pictures and choices with a display

`ink_state` carries resolved `image` URLs; the browser client shows the latest one above the
text and the choices as numbered buttons. A client with no display (ESP32) ignores both and
works by voice. The server never needs to know which kind of client it serves.

## Later: convergence with other audio protocols

The browser client still uses the Worzel WebSocket protocol (`hello`, `listen`, `stt_text`,
Opus binary frames, `ink_state`). For WebRTC (`src/server/webrtc-signaling.ts`), SIP/telephony
and MQTT (`docs/mqtt-transport-plan.md`):

- Keep story control (`fink_start`, `ink` choose, `ink_state`) as JSON messages that can ride
  any transport: a WebRTC data channel, MQTT topics, or the WebSocket.
- With WebRTC audio, the browser's AEC has the remote stream as its reference, which solves
  same-device echo better than gating. Hold to talk still helps on speakerphones and in rooms.
- Speaking state (`tts` start/stop, `fink-speaking` window event) is the signal other modules
  (avatar, stage, a second device) should subscribe to; the pilot is only the fallback for
  devices outside that control channel.
