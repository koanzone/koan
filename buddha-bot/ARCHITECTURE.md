# Architecture

```text
Next.js client (session transcript + sprite reducer)
    POST /api/chat, fetch streaming SSE
Next.js same-origin rewrite
    FastAPI: validate → opening flow → retrieval hook → system prompt
    dedicated model worker → MLX-LM → think filter → public events
```

The browser owns current-session history in React memory and sends it with each request. FastAPI accepts only user/assistant roles, constructs its own system message, and stores no transcript. `app/system_prompt.txt` supplies dialogue behavior. Only the two opening questions are scripted; no topic-to-doctrine rules are implemented.

`app/models.py` defines `ModelBackend.stream(messages, stop)` yielding public `Piece` objects. `MLXBackend` loads the selected model and optional adapter once. A single dedicated executor thread owns all MLX calls; a busy lock rejects overlapping requests with 409. A bounded queue applies backpressure. Disconnect/Stop signals cancellation; generation stops at the next yielded token, and the lock remains held until the worker exits. Model loading and prompt prefill cannot be interrupted immediately. No inference runs on the async event loop.

`ThinkFilter` handles `<think>` / `</think>` split across arbitrary chunks, discards unfinished blocks, and is initialized from the rendered Qwen chat template in case `<think>` is already in the prompt. Only visible text crosses the HTTP boundary. This is a delimiter filter for Qwen's reasoning format, not a semantic guarantee about arbitrary untagged model output. Raw model text is not placed in frontend state or logs. Backend exceptions are logged for local diagnostics; API error messages are generic.

## Public stream

Each SSE record is `data: <JSON>`, followed by a blank line. POST/fetch supports the transcript body; EventSource is not needed.

| Event | Payload | Effect |
| --- | --- | --- |
| state | `state: thinking / talking / idle` | Generation lifecycle |
| delta | `text` | Append visible answer; talking sprite |
| expression | `expression: amused` | Queue a brief reaction after the reply |
| notice | `message` | Nonfatal output-limit note |
| error | `message` | Show retryable failure |
| done | none | Terminal marker; missing marker is a failure |

Input focus maps idle to attention; submit maps to thinking; first visible delta maps to talking; completion/error maps to idle. A validated amused event plays briefly after completion, then settles to idle. The demo emits this event as a fixture. Real MLX does **not** guess amusement from keywords or reward answers; a future structured expression selector can emit the same public event. `frontend/lib/machine.ts` holds sprite transitions. Reduced-motion preference uses a still image.

## Four model configurations

| Experiment | Backend | Adapter | Retrieval |
| --- | --- | --- | --- |
| Base Qwen | MLXBackend | empty | NoRetrieval |
| QLoRA Qwen | MLXBackend | adapter directory | NoRetrieval |
| Base + RAG, future | MLXBackend | empty | Retriever implementation |
| QLoRA + RAG, future | MLXBackend | adapter directory | Retriever implementation |

`Retriever.context(messages)` is the deliberately unimplemented retrieval seam. `NoRetrieval` returns an empty string. Replace the injected retriever in the lifespan factory when ready; return verified passages with stable Bilara source/segment IDs. No vector database, corpus dependency, fake citations, or RAG flag pretending to work is included. Retrieval results must be treated as reference data, with a provenance-aware prompt and citation contract designed when retrieval is implemented.

## Boundaries

Request history is limited to 200 messages / 120,000 characters, each message to 12,000 characters. MLX trims oldest pairs to a token budget before generation. This draft is local and single-user; it is not hardened as a public multi-user service. There is no durable session recovery. The client has a five-minute timeout with retry; slow first model downloads may require retry after loading finishes. No voice, notifications, accounts, profiles, gamification, or settings panel.

Implementation references: [MLX-LM](https://github.com/ml-explore/mlx-lm), [Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps).

## Cloudflare deployment

The local architecture above remains available. For hosting, a separate Next.js static export is served by Cloudflare Workers assets. A Worker handles only `/api/health` and `/api/chat`, validates the website visitor's Cloudflare Access JWT against the configured issuer/audience, and adds the API application's service-token credentials to the outbound request. It forwards SSE bodies without buffering and never sends those credentials to the browser. Only the two explicit API paths are allowed; request size, method, content type, origin, and upstream content type are checked. Redirects are not followed. Cookies and user-supplied credentials are not forwarded.

The frontend hostname uses a separate Access application from the API hostname. This deployment is intended for you and invited testers. Static export avoids a framework adapter for the current client-rendered page; adopting server-side Next.js features later would require revisiting this deployment choice. See CLOUDFLARE.md.
