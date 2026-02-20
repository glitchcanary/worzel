# Worzel Setup Guide

## Quick Start (Local Ollama — no API keys needed)

```bash
# 1. Install Ollama and pull a model
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:7b        # 4.7GB, good balance of quality/speed
# or: ollama pull qwen2.5:3b   # 1.9GB, faster, lighter

# 2. Install dependencies and build
cd worzel
npm install
npm run build

# 3. Start the server
WORZEL_AUTH_SECRET="$(openssl rand -base64 32)" npm start

# 4. Open http://localhost:3000 in your browser
```

The LLM defaults to Ollama at localhost:11434 with qwen2.5:7b — no config needed.

## Provider Setup

Worzel needs three providers: **ASR** (speech-to-text), **LLM** (chat), and **TTS** (text-to-speech). Mix and match local and remote.

### LLM Options

| Provider | Cost | Setup |
|----------|------|-------|
| **Ollama** (local) | Free | Install ollama, pull a model. Zero data leaves your machine. |
| **OpenAI** | Pay-per-token | Get API key, set `WORZEL_LLM_PROVIDER=openai` |
| **Anthropic Claude** | Pay-per-token | Get API key, set `WORZEL_LLM_PROVIDER=anthropic` |

**Ollama** (default — already works if ollama is running):
```bash
# Nothing to configure! Defaults to http://localhost:11434 with qwen2.5:7b
# Good models for voice assistant use:
ollama pull qwen2.5:7b       # Best quality for 16GB VRAM
ollama pull llama3.2:3b       # Faster, lighter
ollama pull phi4-mini          # Microsoft, good for instructions
```

**OpenAI**:
```bash
WORZEL_LLM_PROVIDER=openai
WORZEL_LLM_API_KEY=sk-...
WORZEL_LLM_MODEL=gpt-4.1-mini  # fast + cheap (or gpt-4.1-nano for cheapest)
```
Get your key: https://platform.openai.com/api-keys

**Anthropic Claude**:
```bash
WORZEL_LLM_PROVIDER=anthropic
WORZEL_LLM_API_KEY=sk-ant-...
WORZEL_LLM_MODEL=claude-haiku-4-5-20251001   # fastest/cheapest for voice
# or: claude-sonnet-4-6                       # best balance (latest, Feb 2026)
# or: claude-opus-4-6                         # most capable
```
Get your key: https://console.anthropic.com/settings/keys

### ASR (Speech-to-Text) Options

| Provider | Cost | Latency | Setup |
|----------|------|---------|-------|
| **Groq Whisper** | Free tier | ~0.3s | Best for development — free, fast |
| **OpenAI Whisper** | $0.006/min | ~1-2s | Production quality |
| **faster-whisper** (local) | Free | ~1-3s | No data leaves your machine |

**Groq** (recommended for dev — free, fast):
```bash
WORZEL_ASR_PROVIDER=groq
WORZEL_ASR_URL=https://api.groq.com/openai/v1/audio/transcriptions
WORZEL_ASR_API_KEY=gsk_...
WORZEL_ASR_MODEL=whisper-large-v3-turbo
```
Get your key (free, no credit card): https://console.groq.com/keys

**OpenAI Whisper**:
```bash
WORZEL_ASR_PROVIDER=openai
WORZEL_ASR_URL=https://api.openai.com/v1/audio/transcriptions
WORZEL_ASR_API_KEY=sk-...
WORZEL_ASR_MODEL=whisper-1
```

**faster-whisper** (local, needs Python):
```bash
pip install faster-whisper
# Server wrapper needed — see Phase 5 roadmap
```
GitHub: https://github.com/SYSTRAN/faster-whisper

### TTS (Text-to-Speech) Options

| Provider | Cost | Quality | Setup |
|----------|------|---------|-------|
| **Edge TTS** | Free | Good | Default, no config needed |
| **OpenAI TTS** | $0.015/1K chars | Excellent | API key required |
| **Piper** (local) | Free | Good | Install piper, download voice |

**Edge TTS** (default — free, no key):
```bash
# Nothing to configure! Uses Microsoft Edge's Read Aloud API.
# Note: currently returns silence placeholder — full implementation pending.
WORZEL_TTS_VOICE=en-US-AriaNeural
```

**OpenAI TTS**:
```bash
WORZEL_TTS_PROVIDER=openai
WORZEL_TTS_URL=https://api.openai.com/v1/audio/speech
WORZEL_TTS_API_KEY=sk-...
WORZEL_TTS_VOICE=alloy       # or: echo, fable, onyx, nova, shimmer
```

**Piper** (local, CPU-only, instant):
```bash
pip install piper-tts
# Server wrapper needed — see Phase 5 roadmap
```
GitHub: https://github.com/rhasspy/piper (archived) → https://github.com/OHF-Voice/piper1-gpl

## Recommended Configurations

### Fully Local (zero network calls)
```bash
WORZEL_AUTH_SECRET="$(openssl rand -base64 32)"
WORZEL_LLM_PROVIDER=ollama
WORZEL_LLM_MODEL=qwen2.5:7b
# ASR + TTS: local providers pending Phase 5
```

### Dev/Testing (free remote APIs)
```bash
WORZEL_AUTH_SECRET="$(openssl rand -base64 32)"
WORZEL_LLM_PROVIDER=ollama
WORZEL_LLM_MODEL=qwen2.5:7b
WORZEL_ASR_PROVIDER=groq
WORZEL_ASR_API_KEY=gsk_...
WORZEL_TTS_PROVIDER=edge
```

### Production (paid, best quality)
```bash
WORZEL_AUTH_SECRET="$(openssl rand -base64 32)"
WORZEL_LLM_PROVIDER=openai
WORZEL_LLM_API_KEY=sk-...
WORZEL_LLM_MODEL=gpt-4.1-mini
WORZEL_ASR_PROVIDER=openai
WORZEL_ASR_API_KEY=sk-...
WORZEL_TTS_PROVIDER=openai
WORZEL_TTS_API_KEY=sk-...
WORZEL_HOST=0.0.0.0
```

## Using a .env File

Copy the example and edit:
```bash
cp .env.example .env
# Edit .env with your values
```

Then source it before starting:
```bash
set -a; source .env; set +a
npm start
```

Or use a single line:
```bash
env $(grep -v '^#' .env | xargs) npm start
```

## Testing

```bash
npm test                    # Run all 107 tests
npm run test:watch          # Watch mode during development
npm run lint                # TypeScript type-check
```

## Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| RAM | 4GB (3b model) | 8GB+ (7b model) |
| GPU VRAM | Not required | 6GB+ (GPU inference) |
| Disk | 2GB (3b model) | 5GB+ (7b model) |
| CPU | 4 cores | 8+ cores (for local ASR) |
