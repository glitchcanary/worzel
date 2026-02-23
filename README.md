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
node --env-file=../.env dist/index.js
```

Create a `../.env` file (one directory up, outside git) with your API keys. Copy from `../.env.example`. At minimum you need `WORZEL_AUTH_SECRET` (32+ characters). The default LLM is Ollama with `qwen2.5:7b` (local, no API key).

The `.env` file lives **outside** the `worzel/` git directory to avoid committing secrets. The `--env-file=../.env` flag loads it at startup.

Open `http://localhost:3000` for the web client. Use `WORZEL_HOST=0.0.0.0` in `.env` to listen on all interfaces.

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
