# Buddha Bot

A small local draft: language above, presence below. Next.js/React + FastAPI + a swappable MLX-LM backend. The five original GIFs from the project conversation are included, unchanged. No accounts, database, analytics, persistent transcript, or RAG implementation.

## Host with Cloudflare and GitHub

See [CLOUDFLARE.md](CLOUDFLARE.md) for deployment at **buddha.koanzone.net**, with the existing API tunnel and private runtime credentials. The root website at koanzone.net remains separate.

## Start locally on macOS

Prerequisites: Node.js 20.9+ (22 LTS recommended), npm, and Python 3.11+. MLX additionally requires Apple silicon and a compatible macOS version. Two terminals are needed; run commands from this repository.

**Terminal 1 — backend, lightweight demo first**

```sh
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

**Terminal 2 — frontend**

```sh
cd frontend
npm install
npm run dev
```

A `pnpm-lock.yaml` is included for reproducible dependency resolution; pnpm users can use `pnpm install --frozen-lockfile` and `pnpm dev` instead.

Open http://localhost:3000. The header says **DEMO · SCRIPTED REPLIES**. Echo appears and randomly asks one of the 60 questions in `frontend/lib/openings.ts`. Your first reply goes straight to the selected backend. Demo answers are deliberately fixed fixtures, including one amused reaction, to exercise the complete interface. They are not an intelligence demonstration.

## Connect Qwen

Stop the backend, activate its virtual environment, then:

```sh
python -m pip install -r requirements-mlx.txt
```

Edit `backend/.env`:

```dotenv
BUDDHA_BACKEND=mlx
BUDDHA_MODEL=mlx-community/Qwen3-8B-4bit
BUDDHA_ADAPTER=
BUDDHA_MAX_TOKENS=2048
BUDDHA_CONTEXT_TOKENS=8192
```

Restart the same backend command and reload the page. The model loads lazily on the first response to the opening question. Its first load may download several GB from Hugging Face; a local model directory works too. Nothing in the demo downloads a model. For QLoRA, set `BUDDHA_ADAPTER` to the **absolute path** of your existing adapter directory and restart. Training is outside this repository. Base and adapted modes use the same generation settings (temperature .6, top-p .95, top-k 20).

The 2,048 output-token budget includes hidden thinking. If the model spends it all reasoning, the UI reports that no visible answer was produced; increase the budget if needed. Old message pairs are dropped from the model prompt to fit the configured context budget; the full session remains on screen. An oversized latest message is rejected, not silently clipped. Use one backend worker; MLX operations are serialized on one dedicated thread.

## Interface and assets

Chat occupies 58% of the viewport; the character occupies 42%, including on desktop. The mobile visual viewport tracks the keyboard, allowing a temporary 78/22 split. Enter sends; Shift+Enter adds a line. Stop cancels an in-flight stream; Retry replaces its partial answer without duplicating your message. Edit reply lets you recover from an error. Reloading starts a new session. Nothing is saved to localStorage or a database.

Assets live at `frontend/public/guide/{idle,attention,thinking,talking,amused}.gif`. Replace those five files to change the guide. Their common 4:5 frame uses `object-fit: contain` and pixelated rendering; original animation glitches and slight framing differences are preserved. `still.png` is the idle first frame for reduced-motion users. A missing asset produces a simple visible placeholder. Listening means text input focus, not microphone recording. Talking means visible text streaming, not synthesized audio.

## PWA

For installation and the offline fallback:

```sh
cd frontend
npm run build
npm start
```

The manifest includes standalone display and 192/512 PNG icons. A tiny production-only service worker caches an offline page, never chat traffic. Inference requires the running backend; this is not an offline model in the browser. Installation varies by browser. localhost is a secure context; testing installation from a phone requires an HTTPS development address. Set `BACKEND_URL` in `frontend/.env.local` if the backend moves (default `http://127.0.0.1:8000`). This server-only address is used by the Next.js same-origin proxy. Restart/rebuild the frontend after changing it. No public hosting or authentication is provided in this local draft.

## Checks

```sh
cd backend
source .venv/bin/activate
python -m pip install httpx
python -m unittest discover -s tests -v
```

```sh
cd frontend
npm test
npm run typecheck
npm run build
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the protocol, extension seams, and current limits. See [VALIDATION.md](VALIDATION.md) for checks actually run on this draft.
