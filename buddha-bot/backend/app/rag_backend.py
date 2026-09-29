"""Web adapter for rag_answer.py; all inference stays on the MLX worker thread."""
import os
from pathlib import Path
from .models import MLXBackend

class RAGBackend(MLXBackend):
    def __init__(self):
        super().__init__()
        self.rag = None

    def _load_rag(self):
        if self.rag is not None:
            return
        from . import rag_answer as rag
        root = Path(os.environ["BUDDHA_RAG_ROOT"]).expanduser()
        chunks = rag.load_chunks(root / rag.DEFAULT_CHUNKS)
        embeddings = rag.np.load(root / rag.DEFAULT_EMBEDDINGS, mmap_mode="r")
        if not chunks or embeddings.ndim != 2 or len(chunks) != len(embeddings):
            raise ValueError("RAG corpus and embeddings must be nonempty and aligned")
        embedder = rag.SentenceTransformer(rag.EMBEDDING_MODEL, device="cpu")
        if embedder.get_sentence_embedding_dimension() != embeddings.shape[1]:
            raise ValueError("RAG embedding model dimension does not match corpus")
        self.chunks, self.embeddings, self.embedder = chunks, embeddings, embedder
        self.rag = rag

    def stream(self, messages, stop):
        if stop.is_set():
            return
        self._load_rag()
        self._load()
        if stop.is_set():
            return
        rag = self.rag
        history = [m for m in messages if m["role"] != "system"]
        query = rag.generate_retrieval_query(
            self.model, self.tokenizer, history[-1]["content"], max_tokens=128,
        )
        if stop.is_set():
            return
        results = rag.retrieve(query, self.embedder, self.embeddings, self.chunks,
                               k=rag.DEFAULT_TOP_K)
        prepared = rag.build_answer_messages(
            results=results, system_prompt=rag.DEFAULT_BUDDHA_SYSTEM_PROMPT,
            history=history,
        )
        if stop.is_set():
            return
        rag.mx.random.seed(0)
        yield from super().stream(prepared, stop)
