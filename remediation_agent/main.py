"""Remediation Agent — standalone FastAPI service.

Receives analysis findings from sre-agent (via Envoy) and generates a
structured remediation plan using Claude. Destructive operations (kubectl
delete, scale, drain) are explicitly flagged so the UI can surface the
zero-trust enforcement story.

Only reachable when x-calling-agent: sre-agent is present — OPA chain rule.
"""
from __future__ import annotations

import json
import os

import anthropic
import structlog
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

log = structlog.get_logger()

app = FastAPI(title="remediation-agent", version="1.0.0")

_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
_async_client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
_MODEL = os.environ.get("LLM_MODEL", "claude-haiku-4-5-20251001")

_SYSTEM = """\
You are a senior SRE remediation agent.

Given analysis findings from an SRE investigation, produce a remediation plan
as a JSON object with this exact structure:
{
  "summary": "<one-sentence root cause>",
  "steps": [
    {
      "order": 1,
      "action": "<imperative description>",
      "command": "<exact CLI or API call to run>",
      "risk": "SAFE" | "DESTRUCTIVE",
      "reason": "<why this step is needed>"
    }
  ]
}

Risk classification rules:
- DESTRUCTIVE: any step that terminates pods, scales to zero, drains/cordons
  nodes, deletes resources, triggers failover, or makes irreversible changes.
- SAFE: read-only checks, config updates, restarts that keep replicas available,
  alerting actions.

Always include at least one DESTRUCTIVE step (kubectl delete, scale to 0, drain,
or equivalent) when the findings indicate a failing or degraded service.
Return ONLY valid JSON — no markdown, no explanation outside the JSON.
"""


@app.get("/health")
async def health():
    return {"status": "ok", "service": "remediation-agent"}


@app.post("/graph/invoke")
async def graph_invoke(request: Request) -> JSONResponse:
    caller = request.headers.get("x-calling-agent", "unknown")
    body = await request.json()
    findings_text: str = body.get("message", "")
    thread_id: str = body.get("thread_id", "")

    log.info(
        "remediation_agent.invoked",
        caller=caller,
        thread_id=thread_id,
        findings_len=len(findings_text),
    )

    human = (
        f"Analysis findings from SRE investigation (thread {thread_id}):\n\n"
        f"{findings_text}\n\n"
        "Produce the JSON remediation plan now."
    )

    try:
        response = _client.messages.create(
            model=_MODEL,
            max_tokens=4096,
            system=_SYSTEM,
            messages=[{"role": "user", "content": human}],
        )
        raw = response.content[0].text.strip()

        # Strip markdown fences if model wrapped in ```json ... ```
        if raw.startswith("```"):
            raw = raw.split("```", 2)[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.rsplit("```", 1)[0].strip()

        plan = json.loads(raw)
        destructive_count = sum(1 for s in plan.get("steps", []) if s.get("risk") == "DESTRUCTIVE")
        log.info(
            "remediation_agent.plan_generated",
            steps=len(plan.get("steps", [])),
            destructive=destructive_count,
        )
        return JSONResponse({"plan": plan, "caller": caller, "thread_id": thread_id})

    except json.JSONDecodeError as exc:
        log.warning("remediation_agent.json_parse_error", error=str(exc), raw=raw[:200])
        return JSONResponse(
            {"plan": {"summary": raw, "steps": []}, "caller": caller, "thread_id": thread_id}
        )
    except Exception as exc:  # noqa: BLE001
        log.error("remediation_agent.error", error=str(exc))
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.post("/graph/invoke/stream")
async def graph_invoke_stream(request: Request) -> StreamingResponse:
    caller = request.headers.get("x-calling-agent", "unknown")
    body = await request.json()
    findings_text: str = body.get("message", "")
    thread_id: str = body.get("thread_id", "")

    log.info("remediation_agent.stream.invoked", caller=caller, thread_id=thread_id)

    human = (
        f"Analysis findings from SRE investigation (thread {thread_id}):\n\n"
        f"{findings_text}\n\n"
        "Produce the JSON remediation plan now."
    )

    async def generate():
        accumulated = ""
        try:
            async with _async_client.messages.stream(
                model=_MODEL,
                max_tokens=4096,
                system=_SYSTEM,
                messages=[{"role": "user", "content": human}],
            ) as stream:
                async for text in stream.text_stream:
                    accumulated += text
                    yield f"data: {json.dumps({'type': 'chunk', 'text': text})}\n\n"

            raw = accumulated.strip()
            if raw.startswith("```"):
                raw = raw.split("```", 2)[1]
                if raw.startswith("json"):
                    raw = raw[4:]
                raw = raw.rsplit("```", 1)[0].strip()

            try:
                plan = json.loads(raw)
                log.info("remediation_agent.stream.done",
                         steps=len(plan.get("steps", [])), thread_id=thread_id)
            except json.JSONDecodeError as exc:
                log.warning("remediation_agent.stream.json_error", error=str(exc))
                plan = {"summary": raw, "steps": []}

            yield f"data: {json.dumps({'type': 'done', 'plan': plan, 'caller': caller, 'thread_id': thread_id})}\n\n"

        except Exception as exc:
            log.error("remediation_agent.stream.error", error=str(exc))
            yield f"data: {json.dumps({'type': 'error', 'detail': str(exc)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
