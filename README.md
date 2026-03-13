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
npm run start:unified
```

Create a `../.env` file (one directory up, outside git) with your API keys. Copy from `../.env.example`. At minimum you need `WORZEL_AUTH_SECRET` (32+ characters). The default LLM is Ollama with `qwen2.5:7b` (local, no API key).

The `.env` file lives **outside** the `worzel/` git directory to avoid committing secrets. The `--env-file=../.env` flag loads it at startup.

Open `http://localhost:3000` for the main web client and `http://localhost:3000/fink/` for Fink. Use `WORZEL_HOST=0.0.0.0` in `.env` to listen on all interfaces.

## Unified Server Management

The unified server now has npm-managed lifecycle commands:

```bash
npm run start:unified      # Detached/background server
npm run status:unified     # Show pid, port, log path
npm run logs:unified       # Follow the unified server log
npm run restart:unified    # Restart the detached server
npm run stop:unified       # Stop the detached server
```

Detached vs terminal-attached:

- `npm run start:unified` starts the server in the background and returns your shell prompt immediately. It does **not** require the terminal window to stay open after startup.
- `npm run start:unified:fg` runs the unified server in the foreground. It **does** keep the terminal occupied, and stopping that terminal session stops the server.

Management behavior:

- `npm run start:unified` waits for the health endpoint to come up before reporting success.
- `npm run restart:unified` stops any existing detached instance, then starts a fresh one. If none is running, it still starts one.
- `npm run status:unified` reports whether the server is healthy, not just whether a PID exists.
- If startup fails, the manager prints the tail of the log automatically.

Runtime files:

- PID file: [`tmp/unified-server.pid`](/home/danbri/working/worzel/worzel/tmp/unified-server.pid)
- Log file: [`tmp/unified-server.log`](/home/danbri/working/worzel/worzel/tmp/unified-server.log)

URLs on the unified one-port server:

- Main app: `http://localhost:3000/`
- Fink app: `http://localhost:3000/fink/`
- Main health: `http://localhost:3000/api/health`
- Fink health: `http://localhost:3000/fink/api/health`

## Clients

- **Web browser** -- built-in web client using Web Components and WebCodecs Opus encoding. Chrome/Edge 94+, Firefox 133+, Safari 26+.
- **ESP32 hardware** -- ESP-IDF firmware for Waveshare boards with ES8311 codec. See [`esp32-client/README.md`](esp32-client/README.md).

Both send Opus-encoded audio at 16kHz over WebSocket.

## Development

```bash
npm run dev          # Watch mode with auto-reload (tsx)
npm test             # Run tests (vitest, 139+ passing)
npm run lint         # Type check (tsc --noEmit)
```

## Architecture

See [`CLAUDE.md`](../CLAUDE.md) in the project root for detailed notes on architecture, security model, provider config, Opus codec pipeline, and implementation status.

## License

Apache 2.0
