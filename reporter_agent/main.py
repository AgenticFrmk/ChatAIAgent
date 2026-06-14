from __future__ import annotations

import os
import structlog
from fastapi import FastAPI, Request
from pydantic import BaseModel

log = structlog.get_logger()

_LLM_MODEL = os.environ.get("LLM_MODEL", "claude-haiku-4-5-20251001")

_RUNBOOK_SYSTEM = (
    "You are a senior SRE technical writer. "
    "Generate concise, actionable post-incident runbooks. "
    "Use markdown with clear sections: ## Root Cause, ## Immediate Actions, ## Prevention."
)


class InvokeRequest(BaseModel):
    message: str
    thread_id: str = ""


app = FastAPI(title="reporter-agent", version="1.0.0")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "agent": "reporter-agent"}


@app.post("/graph/invoke")
async def invoke(req: InvokeRequest, request: Request) -> dict:
    calling_agent = request.headers.get("x-calling-agent", "")
    user_id = request.headers.get("x-user-id", "unknown")

    log.info("reporter-agent.invoke", caller=calling_agent, user_id=user_id)

    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        msg = await client.messages.create(
            model=_LLM_MODEL,
            max_tokens=512,
            system=_RUNBOOK_SYSTEM,
            messages=[{
                "role": "user",
                "content": (
                    f"Generate a runbook for this incident:\n\n{req.message}\n\n"
                    "Keep it under 150 words. Be specific and actionable."
                ),
            }],
        )
        content = msg.content[0].text if msg.content else "Unable to generate runbook."
    except Exception as exc:
        log.error("reporter-agent.llm.error", error=str(exc))
        content = f"[Reporter Agent] Runbook generation failed: {exc}"

    return {
        "content": content,
        "agent": "reporter-agent",
        "called_by": calling_agent or "unknown",
        "thread_id": req.thread_id,
    }
