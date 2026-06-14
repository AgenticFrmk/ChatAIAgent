"""
chain_remediate node — terminal graph node that replaces a local report with a real
call to the remediation-agent via Envoy (OBO token, OPA-gated).

Flow:
  1. Exchange user JWT (from graph config auth.token) for an OBO token at AuthService
  2. POST to Envoy /remediation/graph/invoke with OBO token
  3. Envoy jwt_authn validates token → injects x-calling-agent from calling_agent claim
  4. OPA ext_authz enforces chain rule (chain_enabled + x-calling-agent: sre-agent)
  5. Result saved to Redis remediation:latest so RemediationPage can poll it
"""
from __future__ import annotations

import hashlib
import json
import os
import structlog
import httpx
import redis.asyncio as aioredis
from langchain_core.runnables import RunnableConfig

from agent.graph.state import AgentState

log = structlog.get_logger()

AUTH_SERVICE_URL  = os.environ.get("AUTH_SERVICE_URL",       "http://auth-service:9000")
ENVOY_URL         = os.environ.get("ENVOY_URL",              "http://envoy:10000")
REDIS_URL         = os.environ.get("REDIS_URL",              "redis://redis:6379/0")
PLAN_CACHE_TTL    = int(os.environ.get("RAG_CACHE_TTL_SECONDS", "86400"))


async def chain_remediate(state: AgentState, config: RunnableConfig) -> dict:
    cfg       = config.get("configurable", {})
    auth      = cfg.get("auth") or {}
    thread_id = cfg.get("thread_id", "")
    token     = auth.get("token", "")

    intent           = state.get("intent")
    analysis_findings = state.get("analysis_findings") or []
    step_history     = state.get("step_history")      or []
    remediation_plan = state.get("remediation_plan")  or ""
    report_text      = state.get("report")            or ""

    findings = (
        f"Intent: {intent.action if intent else 'investigation'}\n"
        f"Domain: {intent.domain  if intent else 'unknown'}\n\n"
        + ("Analysis findings:\n" + "\n".join(f"  - {f}" for f in analysis_findings) + "\n\n" if analysis_findings else "")
        + ("Tool steps:\n" + "\n".join(f"  [{s['tool_name']}]: {s['finding']}" for s in step_history) + "\n\n" if step_history else "")
        + (f"Proposed remediation:\n  {remediation_plan}\n\n" if remediation_plan else "")
        + (f"SRE report:\n  {report_text}" if report_text else "")
    )

    # ── Step 0: plan cache check ──────────────────────────────────────────────
    plan_cache_key = f"plan:{hashlib.sha256(findings.encode()).hexdigest()[:16]}"
    try:
        _r = aioredis.from_url(REDIS_URL, decode_responses=True)
        async with _r:
            _cached = await _r.get(plan_cache_key)
            if _cached:
                plan = json.loads(_cached)
                log.info("chain_remediate.plan_cache_hit", thread_id=thread_id,
                         steps=len(plan.get("steps", [])))
                opa_decision = "ALLOW"
                payload = {
                    "thread_id": thread_id, "intent": intent_str, "domain": domain_str,
                    "opa_decision": "ALLOW", "findings": findings,
                    "plan": plan, "status": "done", "raw_text": "",
                }
                await _r.set("remediation:latest", json.dumps(payload), ex=3600)
                return {"remediation_response": {"opa_decision": "ALLOW", "plan": plan}}
    except Exception as exc:
        log.warning("chain_remediate.plan_cache_check_failed", error=str(exc))

    # ── Step 1: OBO token exchange ────────────────────────────────────────────
    obo_token: str | None = None
    if token:
        try:
            async with httpx.AsyncClient(timeout=5.0) as c:
                r = await c.post(
                    f"{AUTH_SERVICE_URL}/auth/token/exchange",
                    json={"assertion": token, "scope": "remediation-agent", "calling_agent": "sre-agent"},
                )
                r.raise_for_status()
                obo_token = r.json()["access_token"]
            log.info("chain_remediate.obo_issued", thread_id=thread_id)
        except Exception as exc:
            log.warning("chain_remediate.obo_failed", error=str(exc))

    intent_str = intent.action if intent else ""
    domain_str = intent.domain  if intent else ""

    # ── Step 2: stream from remediation-agent via Envoy ───────────────────────
    opa_decision = "NO_TOKEN" if not obo_token else "UNKNOWN"
    plan: dict   = {}

    def _base_payload(status: str, raw_text: str = "", extra: dict | None = None) -> dict:
        p = {
            "thread_id":    thread_id,
            "intent":       intent_str,
            "domain":       domain_str,
            "opa_decision": opa_decision,
            "findings":     findings,
            "plan":         plan,
            "status":       status,
            "raw_text":     raw_text,
        }
        if extra:
            p.update(extra)
        return p

    try:
        r = aioredis.from_url(REDIS_URL, decode_responses=True)
        async with r:
            if obo_token:
                # Write "streaming" state immediately so the page shows activity
                await r.set(
                    "remediation:latest",
                    json.dumps(_base_payload("streaming")),
                    ex=3600,
                )

                timeout = httpx.Timeout(connect=5.0, read=None, write=5.0, pool=5.0)
                accumulated = ""
                try:
                    async with httpx.AsyncClient(timeout=timeout) as c:
                        async with c.stream(
                            "POST",
                            f"{ENVOY_URL}/remediation/graph/invoke/stream",
                            json={"message": findings, "thread_id": thread_id},
                            headers={
                                "Authorization":  f"Bearer {obo_token}",
                                "Content-Type":   "application/json",
                            },
                        ) as resp:
                            if resp.status_code == 403:
                                opa_decision = "DENY"
                                log.info("chain_remediate.opa_denied", thread_id=thread_id)
                            else:
                                opa_decision = "ALLOW"
                                async for line in resp.aiter_lines():
                                    if not line.startswith("data: "):
                                        continue
                                    try:
                                        event = json.loads(line[6:])
                                    except json.JSONDecodeError:
                                        continue

                                    if event.get("type") == "chunk":
                                        accumulated += event.get("text", "")
                                        await r.set(
                                            "remediation:latest",
                                            json.dumps(_base_payload("streaming", accumulated)),
                                            ex=3600,
                                        )
                                    elif event.get("type") == "done":
                                        plan = event.get("plan", {})
                                        # Unwrap double-encoded summary if steps is empty
                                        if isinstance(plan.get("summary"), str) and plan.get("steps") == []:
                                            try:
                                                inner = json.loads(plan["summary"])
                                                if isinstance(inner, dict) and "steps" in inner:
                                                    plan = inner
                                            except (json.JSONDecodeError, TypeError):
                                                pass
                                        log.info("chain_remediate.success",
                                                 thread_id=thread_id, steps=len(plan.get("steps", [])))
                                        if plan:
                                            try:
                                                await r.set(plan_cache_key, json.dumps(plan), ex=PLAN_CACHE_TTL)
                                                log.info("chain_remediate.plan_cache_set", thread_id=thread_id)
                                            except Exception:
                                                pass
                                    elif event.get("type") == "error":
                                        opa_decision = "ERROR"
                                        log.error("chain_remediate.stream_error",
                                                  detail=event.get("detail"), thread_id=thread_id)
                except Exception as exc:
                    log.error("chain_remediate.call_failed", error=str(exc))
                    opa_decision = "ERROR"

            # Write final state (done or error/deny)
            await r.set(
                "remediation:latest",
                json.dumps(_base_payload("done")),
                ex=3600,
            )
    except Exception as exc:
        log.warning("chain_remediate.redis_failed", error=str(exc))

    return {"remediation_response": {"opa_decision": opa_decision, "plan": plan}}
