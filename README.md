# OBS AI Broadcast Graphics

Professional OBS Studio plugin scaffold for AI-powered static broadcast graphics generation, management, and scene integration.

## Netlify Deployment

This repository can be deployed to Netlify as a browser test app.

- Publish directory: `ui`
- Config file: `netlify.toml`
- Current deployment mode: static frontend

Important:

- The app is now wired for direct provider integrations.
- Real provider API keys should not be exposed in a public static frontend.
- For production-safe AI usage on Netlify, the next recommended step is a server-side proxy using Netlify Functions.
- Until that proxy exists, any direct browser-side provider key would be visible to the client.

### Environment variables you will need for AI providers

If we move provider calls behind Netlify Functions, these are the environment variables to set in Netlify:

- `OPENROUTER_API_KEY`
- `OPENROUTER_TEXT_MODEL`
- `OPENROUTER_IMAGE_MODEL`
- `GROQ_API_KEY`
- `GROQ_TEXT_MODEL`
- `MISTRAL_API_KEY`
- `MISTRAL_TEXT_MODEL`
- `HUGGINGFACE_API_KEY`
- `HUGGINGFACE_TEXT_MODEL`
- `HUGGINGFACE_IMAGE_MODEL`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_TEXT_MODEL`

Suggested starting values:

- `OPENROUTER_TEXT_MODEL=openai/gpt-4.1-mini`
- `OPENROUTER_IMAGE_MODEL=google/gemini-2.5-flash-image-preview`
- `GROQ_TEXT_MODEL=openai/gpt-oss-20b`
- `MISTRAL_TEXT_MODEL=mistral-small-latest`
- `HUGGINGFACE_TEXT_MODEL=Qwen/Qwen2.5-7B-Instruct`
- `HUGGINGFACE_IMAGE_MODEL=black-forest-labs/FLUX.1-schnell`
- `DEEPSEEK_TEXT_MODEL=deepseek-chat`

### What I need from you to make the AIs work

- your API key for each provider you want enabled
- confirmation on whether you want:
  - browser-only testing with exposed client-side keys, or
  - proper Netlify Functions proxy setup so the keys stay private

## Systems implemented

### AI Provider Control System (APCS)

- Central provider config at `config/ai-provider.json`
- Supported manual provider order:
  - `openrouter`
  - `groq`
  - `mistral`
  - `huggingface`
  - `deepseek`
- Only one provider is active at a time
- No automatic fallback or switching
- Manual switch button in the UI cycles to the next provider in order
- Provider request logging is written to:
  - `logs/ai-provider.log`
  - and mirrored to the chosen browser output folder when available
- Debug panel shows:
  - current provider
  - last function called
  - last status
  - request time
  - last API response excerpt

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

- Uses Puter.js LLM calls to generate high-detail broadcast prompts
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

- Uses Puter.js chat completions rather than external season APIs
- Returns one of:
  - `Avurudu`
  - `Vesak`
  - `Kite Season`
  - `Default`
- Supports:
  - manual refresh from the dock
  - periodic automatic refresh on a timer
- Stores season reasoning and last-check metadata

### 4. OBS Integration System

- Native OBS frontend plugin in C++
- Registers a custom dock inside OBS
- Applies generated files as OBS `image_source` entries
- Positions assets automatically:
  - lower thirds at bottom left
  - badge at top right
  - banner across bottom width
- Allows visibility toggling for each generated source

### 5. AI Provider Router Layer

All AI communication now goes through a strict single-provider router.

- Router:
  - `ui/services/ai-provider-router.js`
- Provider modules:
  - `ui/ai-providers/openrouter.js`
  - `ui/ai-providers/groq.js`
  - `ui/ai-providers/mistral.js`
  - `ui/ai-providers/huggingface.js`
  - `ui/ai-providers/deepseek.js`

Each provider module implements the same functions:

- `generateText(prompt)`
- `generateImage(prompt)`
- `removeBackground(image)`
- `detectSeason()`

The active provider is read before every AI request so all subsystems stay locked to a single provider at a time:

- SDS
- PGS
- GCS
- BRS

### 6. Testing Mode

- Static generation only
- No animation engine
- Testing mode toggle in the dock
- Version overwrite behavior preserved in the manifest
- Generation attempt count and review score stored per asset

## Architecture

### Native layer

- [src/plugin-main.cpp](C:/Users/thenu/Downloads/Livestream%20app%20V2/src/plugin-main.cpp)
  - OBS module entry point and dock registration
- [src/ai-graphics-dock.cpp](C:/Users/thenu/Downloads/Livestream%20app%20V2/src/ai-graphics-dock.cpp)
  - Embedded `QWebEngineView` host
- [src/ai-graphics-bridge.cpp](C:/Users/thenu/Downloads/Livestream%20app%20V2/src/ai-graphics-bridge.cpp)
  - `QWebChannel` bridge for persistence and OBS operations
- [src/obs-graphics-manager.cpp](C:/Users/thenu/Downloads/Livestream%20app%20V2/src/obs-graphics-manager.cpp)
  - OBS source creation, update, placement, and visibility control

### Web layer

- [ui/app.js](C:/Users/thenu/Downloads/Livestream%20app%20V2/ui/app.js)
  - Dock controller and UI orchestration
- [ui/config.js](C:/Users/thenu/Downloads/Livestream%20app%20V2/ui/config.js)
  - Graphics registry, model preferences, quality thresholds
- [ui/services/puter-service.js](C:/Users/thenu/Downloads/Livestream%20app%20V2/ui/services/puter-service.js)
  - Puter.js-backed SDS, PGS, GCS, and AI review functions
- [ui/services/graphics-pipeline.js](C:/Users/thenu/Downloads/Livestream%20app%20V2/ui/services/graphics-pipeline.js)
  - Generation and review pipeline orchestration
- [ui/index.html](C:/Users/thenu/Downloads/Livestream%20app%20V2/ui/index.html)
  - Dock markup
- [ui/styles.css](C:/Users/thenu/Downloads/Livestream%20app%20V2/ui/styles.css)
  - Dark dock design

## Quality enforcement

The plugin now uses a review loop before saving a generated asset:

1. Generate image via Puter.js
2. Send result back through Puter.js for quality review
3. Reject low-scoring outputs
4. Retry generation up to the configured attempt limit
5. Save only approved results

Checks target:

- premium broadcast quality
- non-cartoon styling
- clean typography-safe area
- no distorted pseudo-text
- no visible weird artifacts

## Build requirements

This repository still needs a real OBS plugin build environment:

- OBS Studio SDK / frontend API
- `libobs`
- Qt 6:
  - Core
  - Gui
  - Widgets
  - WebEngineWidgets
  - WebChannel
- CMake

Example:

```powershell
cmake -S . -B build
cmake --build build --config Release
```

## Current limitation

Animations are intentionally not implemented yet. The project is structured so a future animation engine can be added without replacing the current dock, manifest model, or OBS integration layer.

## Browser local test mode

The dock app can now run outside OBS for faster iteration.

From the project root:

```powershell
python -m http.server 8080
```

Then open:

```text
http://127.0.0.1:8080/ui/
```

In browser mode:

- upload inspiration references with the `Inspiration Graphics` file picker
- optionally choose an output folder in Chrome or Edge
- generated state is stored in browser local storage
- `Apply to Scene` is mocked until the OBS plugin build is used
