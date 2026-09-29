# Adapted Qwen + RAG

The web backend includes `app/rag_answer.py`, copied from Jeff's original
`/Users/jeff/Desktop/buddha-bot/rag_answer.py`. Its retrieval query prompt,
BGE model/query prefix, top-five cosine search, reference formatting, Echo
system prompt, and evidence instructions are preserved. `build_answer_messages`
is shared by its CLI answer function and the web streaming adapter. Future
prompt changes for the website belong in this included copy.

The web adapter retains session history for the final answer; retrieval uses
the latest user message, matching the original script. It uses the existing
MLX stream, token budget, hidden-thinking filter, and single inference thread.
The character stays thinking through query selection, retrieval, and hidden
reasoning, then talks when visible text starts. Model, embedding model and
corpus are loaded lazily and reused. Embeddings run on CPU as in the script.
Cancellation is checked between retrieval stages and during answer streaming;
the bounded query generation and embedding call finish before cancellation.
The browser chooses one of 60 opening questions per session. The first user reply goes directly to RAG.

Install in the backend virtual environment:

```sh
python -m pip install -r requirements-rag.txt
```

Local `.env` settings:

```dotenv
BUDDHA_BACKEND=rag
BUDDHA_MODEL=mlx-community/Qwen3-8B-4bit
BUDDHA_ADAPTER=/Users/jeff/Desktop/buddha-bot/adapters/buddha_nikayas_1epoch
BUDDHA_RAG_ROOT=/Users/jeff/Desktop/buddha-bot
BUDDHA_MAX_TOKENS=2048
BUDDHA_CONTEXT_TOKENS=8192
```

RAG_ROOT must contain `data/nikayas_rag/chunks.jsonl` and `embeddings.npy`.
Weights, corpus, and adapter remain local; they are not copied into GitHub.
The original standalone script is unchanged. Its CLI remains available in
the included copy via `python -m app.rag_answer` with explicit corpus paths.

Restart the backend in a normal macOS Terminal with GPU access:

```sh
cd /Users/jeff/Desktop/koan/buddha-bot/backend
source .venv/bin/activate
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Health should report `backend: rag`. Health confirms mode, not successful model
loading. Reply to the opening question to exercise inference. No Cloudflare
changes or frontend rebuild are required. The existing app/system_prompt.txt
is used in base MLX mode; RAG mode uses the script's Echo prompt instead.

Validation: `python -m unittest discover -s tests`. Integration tests mock GPU
inference and verify prompt/history/retrieval handoff and cancellation; a real
answer must also be checked on the host Mac because the Codex sandbox cannot
access Metal.
