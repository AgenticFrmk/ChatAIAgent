from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from typing import Any

import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from worker_agent.runtime.base import BaseAgent

log = structlog.get_logger()


class TurnRequest(BaseModel):
    message: str
    thread_id: str
    config: dict[str, Any] = {}


class TurnResponse(BaseModel):
    thread_id: str
    output: dict[str, Any]


def serve(agent: BaseAgent, port: int = 8001) -> FastAPI:
    """Wire a BaseAgent into a FastAPI app with standard SDK endpoints.

    Endpoints:
        POST /v1/turn        — synchronous turn
        POST /v1/stream      — SSE streaming turn
        GET  /health         — liveness probe
        GET  /info           — agent metadata
    """

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await agent.on_start()
        log.info("agent.started", name=agent.name, version=agent.version, port=port)
        yield
        await agent.on_stop()
        log.info("agent.stopped", name=agent.name)

    app = FastAPI(title=agent.name, version=agent.version, lifespan=lifespan)

    @app.post("/v1/turn", response_model=TurnResponse)
    async def turn(req: TurnRequest) -> TurnResponse:
        try:
            output = await agent.turn(req.message, req.thread_id, req.config)
            return TurnResponse(thread_id=req.thread_id, output=output)
        except Exception as exc:
            log.exception("agent.turn.error", thread_id=req.thread_id)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/v1/stream")
    async def stream(req: TurnRequest) -> StreamingResponse:
        async def event_generator():
            try:
                async for event in agent.stream(req.message, req.thread_id, req.config):
                    yield f"data: {json.dumps(event)}\n\n"
                yield "data: {\"type\": \"done\"}\n\n"
            except Exception as exc:
                log.exception("agent.stream.error", thread_id=req.thread_id)
                yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "agent": agent.name}

    @app.get("/info")
    async def info() -> dict:
        return {"name": agent.name, "version": agent.version}

    return app
