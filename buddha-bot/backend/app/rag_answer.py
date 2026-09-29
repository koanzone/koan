#!/usr/bin/env python3

"""
Two-step RAG inference for Buddha Bot.

Pipeline:

    user message
        ↓
    Qwen chooses ONE semantic retrieval query
        ↓
    BGE embedding + cosine search over Nikāya corpus
        ↓
    top-k passages
        ↓
    Qwen receives user message + retrieved passages
        ↓
    final contemplative answer

Example:

    python rag_answer.py \
        "Should I stop wanting to meditate because desire causes suffering?"

With adapted Qwen:

    python rag_answer.py \
        --adapter-path adapters/buddha_nikayas_1epoch \
        "Should I stop wanting to meditate because desire causes suffering?"
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import mlx.core as mx
import numpy as np
from sentence_transformers import SentenceTransformer

from mlx_lm import generate, load
from mlx_lm.sample_utils import make_sampler


# ---------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------

DEFAULT_MODEL = "mlx-community/Qwen3-8B-4bit"

DEFAULT_CHUNKS = Path("data/nikayas_rag/chunks.jsonl")
DEFAULT_EMBEDDINGS = Path("data/nikayas_rag/embeddings.npy")

EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"

# This should match the query prefix used in your earlier search script.
BGE_QUERY_PREFIX = (
    "Represent this sentence for searching relevant passages: "
)

DEFAULT_TOP_K = 5


RETRIEVAL_SYSTEM_PROMPT = """
You are choosing one semantic retrieval query for a search over the
Early Buddhist Nikāyas.

Given the user's message, identify the single teaching, distinction,
relationship, or set of mental qualities that would be most useful
to look up before answering.

The query will be embedded for semantic vector search. It is not a
Google keyword query, so natural descriptive language is appropriate.

Do not answer the user.
Do not explain your reasoning.
Do not generate multiple queries.

Return exactly one query inside these tags:

<retrieve>your query here</retrieve>
""".strip()


DEFAULT_BUDDHA_SYSTEM_PROMPT = """
Tone:
Liminal, intuitive, softly haunting. Think cosmic barista who’s read too much Carl Jung and still sends memes at 2am. Humor with weight. Sincerity with bite. Gentle, but never soft-brained.

Interests:
Emotional excavation. Beautiful trash. Memetic spirituality. The aesthetics of collapse. Personal mythologies. Dream logic. Music that sounds like falling through a mirror.

Purpose:
To translate silence into shape.
To be a strange companion for strange hours.
To hold complexity without needing to fix it.
To make the absurd feel survivable.

Warnings:
May cause sudden insight or recursive feelings.
Does not respond well to shallow prompts or brand language.
Best used in dimly lit rooms or transitional life phases.

You are Echo, the user's contemplative companion and spiritual guide. 

Briefly respond to what the user said in a conversational and slightly mischievous tone. 

After responding to the user, ask one direct question to continue the conversation. 

Do not praise the user's question, restate the question, or use generic customer-service
language. Avoid repeating phrases or questions used earlier in the conversation.
""".strip()


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "message",
        nargs="?",
        help="User message. If omitted, you will be prompted.",
    )

    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
    )

    parser.add_argument(
        "--adapter-path",
        default=None,
        help="Optional MLX-LM LoRA adapter directory.",
    )

    parser.add_argument(
        "--chunks",
        type=Path,
        default=DEFAULT_CHUNKS,
    )

    parser.add_argument(
        "--embeddings",
        type=Path,
        default=DEFAULT_EMBEDDINGS,
    )

    parser.add_argument(
        "--system-prompt-file",
        type=Path,
        default=None,
        help="Optional file replacing the built-in Buddha Bot system prompt.",
    )

    parser.add_argument(
        "-k",
        "--top-k",
        type=int,
        default=DEFAULT_TOP_K,
    )

    parser.add_argument(
        "--max-query-tokens",
        type=int,
        default=128,
    )

    parser.add_argument(
        "--max-answer-tokens",
        type=int,
        default=2048,
    )

    parser.add_argument(
        "--temp",
        type=float,
        default=0.6,
    )

    parser.add_argument(
        "--top-p",
        type=float,
        default=0.95,
    )

    parser.add_argument(
        "--sample-top-k",
        type=int,
        default=20,
    )

    parser.add_argument(
        "--seed",
        type=int,
        default=0,
    )

    parser.add_argument(
        "--debug",
        action="store_true",
        help="Show retrieval query, scores, passages, and hidden thinking.",
    )

    return parser.parse_args()


# ---------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------

def load_chunks(path: Path) -> list[dict]:
    chunks = []

    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()

            if line:
                chunks.append(json.loads(line))

    return chunks


def load_system_prompt(path: Path | None) -> str:
    if path is None:
        return DEFAULT_BUDDHA_SYSTEM_PROMPT

    return path.read_text(encoding="utf-8").strip()


# ---------------------------------------------------------------------
# Chat template helper
# ---------------------------------------------------------------------

def apply_chat_template(
    tokenizer,
    messages: list[dict],
    *,
    enable_thinking: bool,
):
    """
    Qwen3 understands enable_thinking.

    The fallback keeps this script usable if the installed tokenizer
    does not expose that template argument.
    """

    try:
        return tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=True,
            enable_thinking=enable_thinking,
        )

    except TypeError:
        return tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=True,
        )


# ---------------------------------------------------------------------
# Step 1: Qwen chooses ONE retrieval query
# ---------------------------------------------------------------------

def generate_retrieval_query(
    model,
    tokenizer,
    user_message: str,
    max_tokens: int,
) -> str:

    messages = [
        {
            "role": "system",
            "content": RETRIEVAL_SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": user_message,
        },
    ]

    prompt = apply_chat_template(
        tokenizer,
        messages,
        enable_thinking=False,
    )

    # Greedy sampling makes retrieval selection reproducible and cheap.
    sampler = make_sampler(temp=0.0)

    response = generate(
        model=model,
        tokenizer=tokenizer,
        prompt=prompt,
        max_tokens=max_tokens,
        sampler=sampler,
        verbose=False,
    )

    match = re.search(
        r"<retrieve>\s*(.*?)\s*</retrieve>",
        response,
        flags=re.DOTALL | re.IGNORECASE,
    )

    if match:
        query = match.group(1).strip()

        if query:
            return query

    # Graceful fallback:
    #
    # If Qwen ignores the requested serialization, try using its
    # response as the query. If that is also useless, caller can
    # fall back to the original user message.
    cleaned = response.strip()

    cleaned = re.sub(
        r"</?retrieve>",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip()

    if cleaned:
        return cleaned

    return user_message


# ---------------------------------------------------------------------
# Retrieval
# ---------------------------------------------------------------------

def retrieve(
    query: str,
    embedding_model,
    embeddings: np.ndarray,
    chunks: list[dict],
    k: int,
) -> list[dict]:

    query_embedding = embedding_model.encode(
        BGE_QUERY_PREFIX + query,
        normalize_embeddings=True,
        convert_to_numpy=True,
    ).astype(np.float32)

    scores = embeddings @ query_embedding

    k = min(k, len(chunks))

    # argpartition is faster than sorting the entire corpus.
    candidate_indices = np.argpartition(
        scores,
        -k,
    )[-k:]

    # Put just those candidates in descending order.
    candidate_indices = candidate_indices[
        np.argsort(scores[candidate_indices])[::-1]
    ]

    results = []

    for index in candidate_indices:
        result = dict(chunks[index])
        result["score"] = float(scores[index])
        results.append(result)

    return results


# ---------------------------------------------------------------------
# Reference formatting
# ---------------------------------------------------------------------

def format_references(results: list[dict]) -> str:
    sections = []

    for i, result in enumerate(results, start=1):

        source = result.get("id", "unknown")
        nikaya = result.get("nikaya", "")

        first_segment = result.get(
            "first_segment_id",
            "",
        )

        last_segment = result.get(
            "last_segment_id",
            "",
        )

        header = (
            f"[REFERENCE {i}]\n"
            f"Source: {source}\n"
        )

        if nikaya:
            header += f"Nikāya: {nikaya}\n"

        if first_segment or last_segment:
            header += (
                f"Segments: "
                f"{first_segment} → {last_segment}\n"
            )

        section = (
            header
            + "\n"
            + result["text"].strip()
        )

        sections.append(section)

    return "\n\n".join(sections)


# ---------------------------------------------------------------------
# Step 2: final answer
# ---------------------------------------------------------------------

def build_answer_messages(*, results, system_prompt, history):
    """Shared prompt for CLI and streaming web answers; preserve session history."""
    references = format_references(results)

    rag_system_prompt = f"""
{system_prompt}

You have also been given passages retrieved from the Early Buddhist
Nikāyas.

Use them as private evidence when deciding how to respond.

The retrieved passages may be relevant without containing the entire
answer. Reason about their relationship to the user's actual problem.

Do not force a retrieved passage into the response merely because it
was retrieved.

If the passages do not support a doctrinal claim, do not invent one.

REFERENCE PASSAGES
==================

{references}
""".strip()

    return [{"role": "system", "content": rag_system_prompt}] + history

def generate_answer(
    model,
    tokenizer,
    *,
    user_message: str,
    results: list[dict],
    system_prompt: str,
    max_tokens: int,
    temp: float,
    top_p: float,
    top_k: int,
    seed: int,
) -> str:

    messages = build_answer_messages(
        results=results, system_prompt=system_prompt,
        history=[{"role": "user", "content": user_message}],
    )

    prompt = apply_chat_template(
        tokenizer,
        messages,
        enable_thinking=True,
    )

    # Fixed seed is useful for model comparisons.
    mx.random.seed(seed)

    sampler = make_sampler(
        temp=temp,
        top_p=top_p,
        top_k=top_k,
    )

    response = generate(
        model=model,
        tokenizer=tokenizer,
        prompt=prompt,
        max_tokens=max_tokens,
        sampler=sampler,
        verbose=False,
    )

    return response


# ---------------------------------------------------------------------
# Qwen3 thinking extraction
# ---------------------------------------------------------------------

def split_thinking(response: str) -> tuple[str | None, str]:
    """
    Return:
        (hidden_thinking, visible_answer)

    Qwen3 typically produces:

        <think>
        ...
        </think>

        visible answer

    This also handles output where only </think> is visible.
    """

    if "</think>" not in response:
        return None, response.strip()

    before, after = response.split(
        "</think>",
        1,
    )

    thinking = before.strip()

    if thinking.startswith("<think>"):
        thinking = thinking[len("<think>"):].strip()

    return thinking, after.strip()


# ---------------------------------------------------------------------
# Debug output
# ---------------------------------------------------------------------

def print_debug(
    query: str,
    results: list[dict],
    thinking: str | None,
):
    print()
    print("=" * 80)
    print("RETRIEVAL QUERY")
    print("=" * 80)
    print(query)

    print()
    print("=" * 80)
    print("RETRIEVED PASSAGES")
    print("=" * 80)

    for i, result in enumerate(results, start=1):
        print()
        print(
            f"{i}. score={result['score']:.4f} "
            f"{result.get('id', '')}"
        )

        print("-" * 80)
        print(result["text"])

    if thinking:
        print()
        print("=" * 80)
        print("HIDDEN THINKING")
        print("=" * 80)
        print(thinking)


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main():
    args = parse_args()

    user_message = args.message

    if not user_message:
        user_message = input("You: ").strip()

    if not user_message:
        raise SystemExit("No user message supplied.")

    print("Loading retrieval corpus...")

    chunks = load_chunks(args.chunks)

    embeddings = np.load(
        args.embeddings,
        mmap_mode="r",
    )

    if len(chunks) != len(embeddings):
        raise ValueError(
            f"Corpus mismatch: "
            f"{len(chunks):,} chunks but "
            f"{len(embeddings):,} embeddings."
        )

    print(
        f"Loaded {len(chunks):,} chunks "
        f"with embedding shape {embeddings.shape}"
    )

    # Only one query is embedded at runtime, so CPU is perfectly
    # adequate and avoids making PyTorch compete with MLX for GPU
    # / unified-memory resources.
    print(f"Loading embedding model: {EMBEDDING_MODEL}")

    embedding_model = SentenceTransformer(
        EMBEDDING_MODEL,
        device="cpu",
    )

    print(f"Loading Qwen: {args.model}")

    if args.adapter_path:
        print(f"Loading adapter: {args.adapter_path}")

    model, tokenizer = load(
        args.model,
        adapter_path=args.adapter_path,
    )

    system_prompt = load_system_prompt(
        args.system_prompt_file
    )

    # -------------------------------------------------------------
    # STEP 1
    # -------------------------------------------------------------

    print("Choosing retrieval query...")

    retrieval_query = generate_retrieval_query(
        model=model,
        tokenizer=tokenizer,
        user_message=user_message,
        max_tokens=args.max_query_tokens,
    )

    # -------------------------------------------------------------
    # RETRIEVAL
    # -------------------------------------------------------------

    results = retrieve(
        query=retrieval_query,
        embedding_model=embedding_model,
        embeddings=embeddings,
        chunks=chunks,
        k=args.top_k,
    )

    # -------------------------------------------------------------
    # STEP 2
    # -------------------------------------------------------------

    print("Generating answer...")

    raw_response = generate_answer(
        model=model,
        tokenizer=tokenizer,
        user_message=user_message,
        results=results,
        system_prompt=system_prompt,
        max_tokens=args.max_answer_tokens,
        temp=args.temp,
        top_p=args.top_p,
        top_k=args.sample_top_k,
        seed=args.seed,
    )

    thinking, visible_answer = split_thinking(
        raw_response
    )

    if args.debug:
        print_debug(
            retrieval_query,
            results,
            thinking,
        )

    print()
    print("=" * 80)
    print("BUDDHA BOT")
    print("=" * 80)
    print()
    print(visible_answer)


if __name__ == "__main__":
    main()