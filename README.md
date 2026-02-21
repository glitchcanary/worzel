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

## Clients

- **Web browser** -- built-in web client using Web Components and WebCodecs Opus encoding
- **ESP32** -- proof-of-concept Arduino sketch for hardware devices

Both send Opus-encoded audio at 16kHz over WebSocket.

## Running

```
npm install
npm run build
node --env-file=.env dist/index.js
```

Create a `.env` file with your API keys. At minimum you need `WORZEL_AUTH_SECRET` (32+ characters). The default LLM is Ollama with `qwen2.5:7b` (local, no API key).

Open `http://localhost:3000` for the web client.

## Tests

```
npm test
```

## License

Apache 2.0
