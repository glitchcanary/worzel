# TODO

## Fink Voice and ASR

- Fix Fink hot-mic turn-taking. Current rough edges are mostly post-TTS interruption timing, not transport.
- Add a post-TTS re-arm delay and minimum speech-duration gate in [`fink/client/fink.js`](/home/danbri/working/worzel/worzel/fink/client/fink.js).
- Add persistent visual display of recent user ASR transcript in the Fink UI. The current transient inline rendering is easy to miss.
- Implement mixed-cost TTS policy for Fink:
  - utility/menu/choice speech on cheap provider
  - premium character narration on ElevenLabs only where it matters
- Add TTS caching keyed by provider, model, voice, speed, and text.
- Add graceful TTS fallback. If ElevenLabs fails because of quota or key scope, fall back to OpenAI or Edge instead of going silent.
- Current ElevenLabs findings:
  - voice-name mapping works best with raw voice IDs
  - the current key can synthesize, but `voices_read` is missing
  - key-level quota behavior can diverge from account-level remaining credits
  - Barney / `wG54O0fjDbPBYb9MFXCb` returned `ID3` MP3 bytes even when `output_format=pcm_16000` or `pcm_24000` was requested
  - this caused the Fink browser path to interpret MP3 as PCM/Opus-adjacent binary, producing full-scale "snow" / untuned-radio static rather than a mild quality regression
  - treat ElevenLabs response format as authoritative from the returned bytes, not from the requested `output_format`
  - if Fink uses ElevenLabs in-browser, prefer explicit MP3 handling or verified transcoding rather than assuming PCM transport

## Browser ASR Exploration

- Prototype optional browser-side ASR for Chrome-family browsers when available.
- Candidate direction:
  - client-side `SpeechRecognition` / `webkitSpeechRecognition` for low-latency choice selection
  - keep server ASR as fallback and as the canonical cross-browser path
- Design goal:
  - use browser ASR for responsiveness when it is present and stable
  - do not make Fink depend on it

## New Fink UX Story Experiments

- Added five new experimental stories to exercise different interaction patterns:
  - `ux-barge-in-lab`
  - `ux-brief-prompts`
  - `ux-confirmation-loop`
  - `ux-freeform-intake`
  - `ux-numbered-menu`
- Evaluate which patterns reduce ASR confusion and make hot-mic interaction feel less fragile.
