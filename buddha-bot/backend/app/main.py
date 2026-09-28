import asyncio
import json
import logging
import os
import queue
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator
from .models import create_backend, NoRetrieval

load_dotenv(Path(__file__).parents[1] / ".env")
SYSTEM = Path(__file__).with_name("system_prompt.txt").read_text()

@asynccontextmanager
async def lifespan(app):
    app.state.backend = create_backend()
    app.state.retriever = NoRetrieval()
    app.state.worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx")
    app.state.busy = threading.Lock()
    yield
    app.state.worker.shutdown(wait=False, cancel_futures=True)

app = FastAPI(title="Buddha Bot", lifespan=lifespan)

class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=12000)

class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def validate_history(self):
        if self.messages[-1].role != "user":
            raise ValueError("Last message must be from the user")
        if sum(len(m.content) for m in self.messages) > 120000:
            raise ValueError("Conversation is too large for this local draft")
        return self

@app.get("/api/health")
def health():
    return {"status": "ok", "backend": os.getenv("BUDDHA_BACKEND", "demo")}

@app.post("/api/chat")
async def chat(body: ChatRequest, request: Request):
    if not app.state.busy.acquire(blocking=False):
        raise HTTPException(409, "The guide is finishing another response. Try again shortly.")
    events = queue.Queue(maxsize=32)
    stop = threading.Event()

    def send(kind, **data):
        while not stop.is_set():
            try:
                events.put({"type": kind, **data}, timeout=0.1)
                return
            except queue.Full:
                pass

    def generate():
        try:
            send("state", state="thinking")
            history = [m.model_dump() for m in body.messages]
            # Only the two opening moves are scripted. Everything after them
            # belongs to the model. No doctrinal keyword rules live here.
            if sum(m["role"] == "user" for m in history) == 1:
                send("state", state="talking")
                send("delta", text="Why are you here?")
            else:
                context = app.state.retriever.context(history)
                system = SYSTEM + ("\nVerified reference material:\n" + context if context else "")
                visible = False
                for piece in app.state.backend.stream([{"role": "system", "content": system}] + history, stop):
                    if stop.is_set():
                        break
                    if piece.expression == "amused":
                        send("expression", expression="amused")
                    if piece.text:
                        if not visible:
                            send("state", state="talking")
                            visible = True
                        send("delta", text=piece.text)
                    if piece.truncated:
                        send("notice", message="The response reached its length limit.")
                if not visible and not stop.is_set():
                    send("error", message="No visible answer was produced. Please try again.")
            send("state", state="idle")
            send("done")
        except Exception:
            logging.exception("Generation failed")
            send("error", message="The local model could not finish. Check the backend terminal and retry.")
            send("done")
        finally:
            app.state.busy.release()

    app.state.worker.submit(generate)

    async def stream():
        last_ping = asyncio.get_running_loop().time()
        try:
            while not stop.is_set():
                if await request.is_disconnected():
                    break
                try:
                    event = events.get_nowait()
                except queue.Empty:
                    now = asyncio.get_running_loop().time()
                    if now - last_ping > 10:
                        yield ": keepalive\n\n"
                        last_ping = now
                    await asyncio.sleep(0.02)
                    continue
                yield "data: " + json.dumps(event) + "\n\n"
                if event["type"] == "done":
                    break
        finally:
            stop.set()

    return StreamingResponse(stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
