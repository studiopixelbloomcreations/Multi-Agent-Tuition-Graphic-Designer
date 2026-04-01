# AI Broadcast Graphics

Professional web app for AI-powered static broadcast graphics generation, management, and export for manual use in OBS Studio.

## Web App Deployment

This repository is now intended to run as a full web app.

- Publish directory: `ui`
- Config file: `netlify.toml`
- Current deployment mode: static frontend web app

Important:

- The app is now wired for direct provider integrations.
- Real provider API keys should not be exposed in a public static frontend.
- A Netlify Functions proxy is now included for production-safe provider access.
- On deployed Netlify, the frontend will call `/.netlify/functions/ai-provider` automatically.
- In plain local browser testing without Netlify Functions, direct browser-side keys or injected config are still required.

### Environment variable for AI providers

If we move provider calls behind Netlify Functions, use one single environment variable:

- `AI_PROVIDER_KEYS_JSON`

The value should be a JSON object containing all provider API keys:

```json
{
  "openrouter": {
    "apiKey": "YOUR_OPENROUTER_KEY"
  },
  "groq": {
    "apiKey": "YOUR_GROQ_KEY"
  },
  "mistral": {
    "apiKey": "YOUR_MISTRAL_KEY"
  },
  "huggingface": {
    "apiKey": "YOUR_HUGGING_FACE_TOKEN"
  },
  "deepseek": {
    "apiKey": "YOUR_DEEPSEEK_KEY"
  }
}
```

Set that exact JSON string in Netlify as:

- `AI_PROVIDER_KEYS_JSON`

Model selection is automatic.

The system now chooses the provider models internally based on task type and provider capability:

- OpenRouter
  - text: `openai/gpt-4.1-mini`
  - image: `google/gemini-2.5-flash-image`
- Groq
  - text: `openai/gpt-oss-20b`
- Mistral
  - text: `mistral-small-latest`
- Hugging Face
  - text: `Qwen/Qwen2.5-7B-Instruct`
  - image: `black-forest-labs/FLUX.1-schnell`
- DeepSeek
  - text: `deepseek-chat`

### What I need from you to make the AIs work

- one `AI_PROVIDER_KEYS_JSON` value containing the provider keys you want enabled
- if you are testing locally without Netlify Functions, either:
  - inject the same JSON into the browser runtime, or
  - use browser-side local secrets for temporary testing

### Hugging Face token

Yes, for Hugging Face what I need is your Hugging Face access token.

Use a Hugging Face User Access Token with inference access. In most cases:

- `Read` access is needed for hosted model access
- if you use gated models, the token must also have permission to that model

For this project, the Hugging Face token goes inside:

```json
{
  "huggingface": {
    "apiKey": "hf_xxxxxxxxxxxxxxxxxxxx"
  }
}
```

## Systems implemented

### AI Harmony System (AHS)

- Multi-agent orchestrator automatically assigns tasks across:
  - `openrouter`
  - `groq`
  - `mistral`
  - `huggingface`
  - `deepseek`
- No manual provider switching in the main workflow
- Automatic failover to the next best provider when a task fails
- Performance preferences stored in `config/ai-performance.json`
- Team flow and debug details are shown inside the main monitor
- Provider request logging is written to:
  - `logs/ai-provider.log`
  - and mirrored to the chosen browser output folder when available

### 1. Graphics Creation System (GCS)

- Consumes inspiration references from `Inspiration Graphics/`
- Extracts visual style rather than copying images directly
- Generates four static output classes:
  - Intro Lower Third
  - Always-On Lower Third
  - Live Badge
  - Institution Banner
- Converts generated images into `3840x2160` transparent PNG canvases
- Overwrites versioned outputs in `generated-graphics/`

### 2. Prompt Generation System (PGS)

- Uses the AI Harmony System text agents to generate high-detail broadcast prompts
- Injects:
  - season
  - graphic type
  - inspiration style summary
  - explicit quality rules
- Forces these phrases into prompts:
  - `transparent background`
  - `4K`
  - `no background`
  - `professional broadcast design`

### 3. Season Detection System (SDS)

- Uses the AI Harmony System text agents rather than external season APIs
- Returns one of:
  - `Avurudu`
  - `Vesak`
  - `Kite Season`
  - `Default`
- Supports:
  - manual refresh from the dock
  - periodic automatic refresh on a timer
- Stores season reasoning and last-check metadata

### 4. Manual OBS Workflow

- Generate graphics in the web app
- Save them to the selected output folder
- Import them manually into OBS as image sources
- Use the built-in preview cards to verify the generated assets before loading them into OBS

### 5. AI Orchestrator Layer

All AI communication now goes through the harmony orchestrator.

- Orchestrator:
  - `ui/ai-orchestrator/orchestrator.js`
- Agent registry:
  - `ui/ai-orchestrator/agent-registry.js`
- Performance store:
  - `ui/ai-orchestrator/performance-store.js`
- Router/runtime:
  - `ui/services/ai-provider-router.js`
- Provider factory:
  - `ui/ai-providers/provider-factory.js`

Each provider module exposes the same task surface:

- `generateText(prompt)`
- `generateImage(prompt)`
- `removeBackground(image)`
- `detectSeason()`

The orchestrator chooses the best provider automatically for:

- SDS
- PGS
- GCS
- BRS
- quality review

### 6. Testing Mode

- Static generation only
- No animation engine
- Testing mode toggle in the dock
- Version overwrite behavior preserved in the manifest
- Generation attempt count and review score stored per asset

## Architecture

### Web layer

- [ui/app.js](C:/Users/thenu/Downloads/Livestream%20app%20V2/ui/app.js)
  - Web app controller and UI orchestration
- [ui/config.js](C:/Users/thenu/Downloads/Livestream%20app%20V2/ui/config.js)
  - Graphics registry and quality thresholds
- [ui/services/ai-service.js](C:/Users/thenu/Downloads/Livestream%20app%20V2/ui/services/ai-service.js)
  - Harmony-orchestrated SDS, PGS, GCS, BRS, and quality review functions
- [ui/services/graphics-pipeline.js](C:/Users/thenu/Downloads/Livestream%20app%20V2/ui/services/graphics-pipeline.js)
  - Generation and review pipeline orchestration
- [ui/services/browser-bridge.js](C:/Users/thenu/Downloads/Livestream%20app%20V2/ui/services/browser-bridge.js)
  - Browser persistence, output-folder integration, and exported asset handling
- [ui/index.html](C:/Users/thenu/Downloads/Livestream%20app%20V2/ui/index.html)
  - Web app markup
- [ui/styles.css](C:/Users/thenu/Downloads/Livestream%20app%20V2/ui/styles.css)
  - Dark app design

## Quality enforcement

The plugin now uses a review loop before saving a generated asset:

1. Generate image via the AI Harmony System
2. Send result back through the AI Harmony System for quality review
3. Reject low-scoring outputs
4. Retry generation up to the configured attempt limit
5. Save only approved results

Checks target:

- premium broadcast quality
- non-cartoon styling
- clean typography-safe area
- no distorted pseudo-text
- no visible weird artifacts

## Current limitation

Animations are intentionally not implemented yet. The project is structured so a future animation engine can be added without replacing the current web app workflow, manifest model, or output pipeline.

## Local run

The project now runs as a normal browser-based web app.

From the project root:

```powershell
python -m http.server 8080
```

Then open:

```text
http://127.0.0.1:8080/ui/
```

In the web app:

- upload reference images inside each graphic card
- optionally choose an output folder in Chrome or Edge
- generated state is stored in browser local storage
- generated assets stay available in preview cards and the output folder for manual import into OBS

Important for local testing:

- a plain `python -m http.server` session does not automatically read Netlify environment variables
- Netlify environment variables work when deployed on Netlify through the included function proxy
- for local non-Netlify browser testing, the app will fall back to browser-side secrets if you provide them
