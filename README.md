# Worzel

A voice assistant server written in TypeScript. Clients send audio over WebSocket; the server transcribes it, sends it to a language model, and speaks the response back.

## How it works

The pipeline is explicit: each stage produces text that can be inspected and filtered.

```
mic audio  -->  ASR (speech-to-text)
                     |
                  text (logged, validated)
                     |
               LLM (text-to-text)
                     |
                  text (logged, sanitized)
                     |
               TTS (text-to-speech)  -->  speaker audio
```

## Providers

Each stage is pluggable. Current implementations:

| Stage | Providers |
|-------|-----------|
| ASR | OpenAI Whisper, Groq Whisper |
| LLM | Ollama (local), OpenAI, Anthropic Claude |
| TTS | OpenAI, Microsoft Edge TTS, ElevenLabs |

## Quick Start

```bash
npm install
npm run build
npm start
```

Create a `../.env` file (one directory up, outside git) with your API keys. Copy from `../.env.example`. At minimum you need `WORZEL_AUTH_SECRET` (32+ characters). The default LLM is Ollama with `qwen2.5:7b` (local, no API key).

The `.env` file lives **outside** the `worzel/` git directory to avoid committing secrets. The `--env-file=../.env` flag loads it at startup.

Open `http://localhost:3000` for the main web client and `http://localhost:3000/fink/` for Fink. Use `WORZEL_HOST=0.0.0.0` in `.env` to listen on all interfaces.

## Server Management

```bash
npm start              # Start in background (daemon), returns prompt immediately
npm run start:bg       # Same as npm start
npm run start:fg       # Run in foreground (occupies terminal, useful for debugging)
npm run stop           # Stop the background server
npm run restart        # Restart the background server
npm run status         # Show server health, pid, log path
npm run logs           # Follow the server log
```

- Background mode (`npm start` / `start:bg`) waits for the health endpoint before reporting success. If startup fails, it prints the log tail automatically.
- Foreground mode (`start:fg`) keeps the terminal occupied — stopping the terminal stops the server.
- `restart` stops any running instance then starts a fresh one; safe to run even if nothing is running.

Runtime files:

- PID file: [`tmp/unified-server.pid`](/home/danbri/working/worzel/worzel/tmp/unified-server.pid)
- Log file: [`tmp/unified-server.log`](/home/danbri/working/worzel/worzel/tmp/unified-server.log)

URLs on the unified one-port server:

- Main app: `http://localhost:3000/`
- Fink app: `http://localhost:3000/fink/`
- Main health: `http://localhost:3000/api/health`
- Fink health: `http://localhost:3000/fink/api/health`

Fink can override the main server's TTS provider independently via env vars:

```bash
FINK_TTS_PROVIDER=elevenlabs
FINK_TTS_MODEL=eleven_turbo_v2_5
FINK_TTS_VOICE=Bill
```

When those are set, the unified server still shares one port, but `/fink/` uses its own TTS provider config. The startup log for `Fink module ready` will show the active `ttsProvider` and `ttsVoice`.

## Fink Voice Profiles

Fink stories can now use semantic voice IDs instead of provider product names.

In Ink:

```ink
# speaker:narrator # voice:narrator
# speaker:munrab # voice:munrab # voice.elevenlabs:Bill
```

In story metadata:

```json
{
  "characters": {
    "munrab": { "voice": "munrab" }
  },
  "voices": {
    "munrab": {
      "traits": ["old", "raspy", "deep"],
      "providers": {
        "openai": "ballad",
        "elevenlabs": "Bill"
      }
    }
  }
}
```

Resolution order is:
- `voice.<provider>` tag override, for example `voice.elevenlabs:Bill`
- matching entry in story `voices`
- fallback alias map from `FINK_TTS_VOICE_MAP`
- raw `voice:` value for legacy stories

This lets Ink stay provider-neutral while still choosing different concrete voices on OpenAI, ElevenLabs, or Edge.

## TODO

- Add hybrid auth: Supabase for normal online identity, plus a local salted-hash fallback for offline/dev/admin login.

## Clients

- **Web browser** -- built-in web client using Web Components and WebCodecs Opus encoding. Chrome/Edge 94+, Firefox 133+, Safari 26+.
- **ESP32 hardware** -- ESP-IDF firmware for Waveshare boards with ES8311 codec. See [`esp32-client/README.md`](esp32-client/README.md).

Both send Opus-encoded audio at 16kHz over WebSocket.

## Development

```bash
npm run dev          # Watch mode with auto-reload (tsx)
npm test             # Run tests (vitest)
npm run lint         # Type check (tsc --noEmit)
npm run debug:dev    # Run src/index.ts directly via tsx (no watch)
npm run debug:fink   # Run standalone Fink server only
```

## Architecture

See [`CLAUDE.md`](../CLAUDE.md) in the project root for detailed notes on architecture, security model, provider config, Opus codec pipeline, and implementation status.

## License

Apache 2.0
