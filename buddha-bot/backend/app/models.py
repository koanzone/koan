import os
import time
from dataclasses import dataclass
from typing import Iterator, Protocol
from threading import Event
from .filtering import ThinkFilter

@dataclass
class Piece:
    text: str = ""
    expression: str | None = None
    truncated: bool = False

class ModelBackend(Protocol):
    def stream(self, messages: list[dict], stop: Event) -> Iterator[Piece]: ...

class Retriever(Protocol):
    """Future hook: return verified source material with stable citation IDs."""
    def context(self, messages: list[dict]) -> str: ...

class NoRetrieval:
    def context(self, messages):
        return ""

class DemoBackend:
    """UI fixture only; never presented as model intelligence."""
    def stream(self, messages, stop):
        if stop.wait(0.6):
            return
        yield Piece(expression="amused")
        for word in "We can start there. What feels most important for us to look at together?".split(" "):
            if stop.wait(0.045):
                return
            yield Piece(text=word + " ")

class MLXBackend:
    def __init__(self):
        self.model = self.tokenizer = None

    def stream(self, messages, stop):
        # All MLX loading and generation run on the same dedicated worker.
        from mlx_lm import load, stream_generate
        from mlx_lm.sample_utils import make_sampler
        if self.model is None:
            self.model, self.tokenizer = load(
                os.getenv("BUDDHA_MODEL", "mlx-community/Qwen3-8B-4bit"),
                adapter_path=os.getenv("BUDDHA_ADAPTER") or None,
            )
        if stop.is_set():
            return
        budget = int(os.getenv("BUDDHA_CONTEXT_TOKENS", "8192"))
        maximum = int(os.getenv("BUDDHA_MAX_TOKENS", "2048"))
        selected = list(messages)
        while True:
            prompt = self.tokenizer.apply_chat_template(
                selected, tokenize=False, add_generation_prompt=True, enable_thinking=True,
            )
            ids = self.tokenizer.encode(prompt, add_special_tokens=False)
            if len(ids) + maximum <= budget:
                break
            if len(selected) <= 2:
                raise ValueError("Latest message exceeds the model context budget")
            # Keep system + most recent conversation; remove the oldest pair.
            del selected[1:min(3, len(selected)-1)]
        hidden = prompt.rfind("<think>") > prompt.rfind("</think>")
        parser = ThinkFilter(hidden=hidden)
        stream = stream_generate(self.model, self.tokenizer, prompt=ids,
            max_tokens=maximum, sampler=make_sampler(temp=0.6, top_p=0.95, top_k=20))
        try:
            for result in stream:
                if stop.is_set():
                    return
                visible = parser.feed(result.text)
                if visible:
                    yield Piece(text=visible)
                if result.finish_reason == "length":
                    yield Piece(truncated=True)
        finally:
            stream.close()
            parser.finish()

def create_backend():
    mode = os.getenv("BUDDHA_BACKEND", "demo")
    if mode == "mlx":
        return MLXBackend()
    if mode == "demo":
        return DemoBackend()
    raise ValueError("BUDDHA_BACKEND must be demo or mlx")
