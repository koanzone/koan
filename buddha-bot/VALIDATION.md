# Validation

Checked on macOS, September 24, 2026.

- Next.js 16.3.6 / React 19.3.0 production build and TypeScript compilation: passed.
- Six Python backend tests: passed. Coverage includes all reasoning-tag split positions, single-character chunks, template-prefilled reasoning, incomplete reasoning, opening-to-model handoff, input validation, busy rejection, and model-error cleanup.
- Frontend protocol checks: passed. SSE split at every byte boundary including multibyte UTF-8, missing terminal event, busy error, and all five sprite-state transitions.
- In-app browser: original assets render; opening questions, streamed demo answer, Stop recovery, retry without duplicate messages, and session reset checked. Phone viewport 390×844: chat 489.52 px / stage 354.47 px (58/42), document width 390 px, no horizontal overflow.
- Model downloads and real MLX/adapter inference were not run. That path uses the documented MLX-LM Python API and needs a local smoke test with your model and adapter.
- Physical iOS/Android keyboard behavior, installation, and offline service-worker behavior were not exercised. Manifest, icons, and offline fallback are included; the service worker registers in production only.

Backend tests run with Python 3.12, FastAPI 0.141.1, Uvicorn 0.53.0, and Pydantic 2.13.5. The demo performs no model inference. The separate headless Chrome launcher was unavailable in this sandbox; visual checks used the Codex in-app browser instead.
