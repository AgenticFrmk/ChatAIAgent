from __future__ import annotations

import asyncio
import json
import os
from typing import Any, AsyncIterator

import structlog
from fastapi import FastAPI, Query, Request
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
from pydantic import BaseModel

from worker_agent.runtime import BaseAgent, serve
from worker_agent.llm import LLMConfig
from worker_agent.logging_setup import configure_logging
from agentcore.plugins import SafetyFilter
from agent.graph.builder import build_graph, _make_session_factory
from worker_agent.observability import configure_tracing

log = structlog.get_logger()

_DEFAULT_LLM_MODEL = os.environ.get("LLM_MODEL", "claude-sonnet-4-6")
_REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
_TTL_SECONDS = 86400


def _serialise(obj: Any) -> Any:
    """Recursively convert LangGraph/LangChain objects to JSON-safe types."""
    try:
        from langchain_core.messages import BaseMessage
        if isinstance(obj, BaseMessage):
            return {"role": obj.type, "content": obj.content}
    except ImportError:
        pass
    try:
        from pydantic import BaseModel as PydanticModel
        if isinstance(obj, PydanticModel):
            return obj.model_dump()
    except ImportError:
        pass
    try:
        from langgraph.types import Interrupt
        if isinstance(obj, Interrupt):
            return {"value": _serialise(obj.value), "resumable": obj.resumable}
    except (ImportError, AttributeError):
        pass
    if isinstance(obj, dict):
        return {k: _serialise(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_serialise(v) for v in obj]
    return obj


class SREAgent(BaseAgent):
    """SRE domain agent: intent → plan → HITL → execute → report."""

    def __init__(self) -> None:
        self._graph = None
        self._registry = None
        self._tool_dispatcher = None
        self._redis = None
        self._db_session_factory = None
        self._llm_config: LLMConfig | None = None
        self._collectors: dict[str, object] = {}
        self._ragas_collectors: dict[str, object] = {}
        self._checkpointer_cm = None  # holds AsyncPostgresSaver CM across start/stop

    @property
    def name(self) -> str:
        return "sre-agent"

    @property
    def version(self) -> str:
        return "1.0.0"

    @property
    def _safety(self) -> SafetyFilter:
        policy_url = os.environ.get("POLICY_SERVICE_URL", "http://policy-service:8090")
        if not hasattr(self, "_safety_filter"):
            self._safety_filter = SafetyFilter(policy_url=policy_url)
        return self._safety_filter

    async def on_start(self) -> None:
        from langchain_anthropic import ChatAnthropic
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        import redis.asyncio as aioredis
        from worker_agent.registry.scalable import ScalableRegistryClient
        from worker_agent.tools.dispatcher import ToolDispatcher
        from sqlalchemy.ext.asyncio import create_async_engine
        from worker_agent.persistence.models import PlanHistory

        checkpointer_url = os.environ["CHECKPOINTER_URL"]
        registry_url = os.environ.get("REGISTRY_SERVICE_URL", "")
        if not registry_url:
            raise RuntimeError("REGISTRY_SERVICE_URL is required")

        self._llm_config = LLMConfig(
            default_llm=ChatAnthropic(model=_DEFAULT_LLM_MODEL),
            reasoning_llm=ChatAnthropic(model="claude-opus-4-6"),
        )

        # Redis first — passed to registry and dispatcher for caching
        self._redis = aioredis.from_url(_REDIS_URL, decode_responses=True)
        await self._redis.ping()

        self._registry = ScalableRegistryClient(
            registry_url,
            cache_ttl_seconds=int(os.environ.get("REGISTRY_CACHE_TTL_SECONDS", "60")),
            auth_url=os.environ.get("REGISTRY_AUTH_URL") or None,
            username=os.environ.get("REGISTRY_USERNAME") or None,
            password=os.environ.get("REGISTRY_PASSWORD") or None,
            redis_client=self._redis,
            rag_cache_ttl=int(os.environ.get("RAG_CACHE_TTL_SECONDS", "86400")),
        )

        tool_auth_enabled = os.environ.get("TOOL_AUTH_ENABLED", "false").lower() == "true"
        if tool_auth_enabled:
            from worker_agent.tools.credentials import CredentialResolver
            credential_resolver = CredentialResolver.from_env()
        else:
            credential_resolver = None
        self._tool_dispatcher = ToolDispatcher(
            self._registry,
            credential_resolver=credential_resolver,
            redis_client=self._redis,
            tool_cache_ttl=int(os.environ.get("TOOL_CACHE_TTL_SECONDS", "3600")),
        )

        agentcore_db_url = os.environ.get(
            "AGENTCORE_DB_URL",
            checkpointer_url.replace("postgresql://", "postgresql+asyncpg://", 1),
        )
        self._db_session_factory = _make_session_factory(agentcore_db_url)

        engine = create_async_engine(agentcore_db_url)
        async with engine.begin() as conn:
            await conn.run_sync(PlanHistory.__table__.create, checkfirst=True)
        await engine.dispose()

        self._checkpointer_cm = AsyncPostgresSaver.from_conn_string(checkpointer_url)
        checkpointer = await self._checkpointer_cm.__aenter__()
        await checkpointer.setup()
        self._graph = build_graph(checkpointer=checkpointer, registry=self._registry)

        log.info("sre-agent.ready", registry_url=registry_url, redis=_REDIS_URL)

    async def on_stop(self) -> None:
        if self._redis:
            await self._redis.aclose()
        if self._checkpointer_cm:
            await self._checkpointer_cm.__aexit__(None, None, None)

    def _get_ragas_collector(self, thread_id: str):
        if thread_id not in self._ragas_collectors:
            from agentcore.plugins import RAGAsPlugin as RAGASCollector
            self._ragas_collectors[thread_id] = RAGASCollector()
        return self._ragas_collectors[thread_id]

    def _get_metrics_collector(self, thread_id: str):
        if thread_id not in self._collectors:
            slm_url = os.environ.get("SLM_PLATFORM_URL", "")
            agent_id = os.environ.get("AGENT_ID", "sre-agent")
            if slm_url:
                from agentcore.plugins import MetricsPlugin as MetricsCollector
                self._collectors[thread_id] = MetricsCollector(
                    agent_id=agent_id,
                    slm_url=slm_url,
                    ragas_collector=self._get_ragas_collector(thread_id),
                )
        return self._collectors.get(thread_id)

    def _make_config(self, thread_id: str, auth: dict, auto_approve: bool = False) -> dict:
        ragas = self._get_ragas_collector(thread_id)
        metrics = self._get_metrics_collector(thread_id)
        return {
            "recursion_limit": 100,
            "configurable": {
                "thread_id":          thread_id,
                "auth":               auth,
                "registry":           self._registry,
                "tool_dispatcher":    self._tool_dispatcher,
                "llm_config":         self._llm_config,
                "metrics_collector":  metrics,
                "ragas_collector":    ragas,
                "db_session_factory": self._db_session_factory,
                "auto_approve":       auto_approve,
            },
        }

    async def turn(self, message: str, thread_id: str, config: dict) -> dict[str, Any]:
        auth = config.pop("auth", {})
        auto_approve = config.pop("auto_approve", False)
        lg_config = self._make_config(thread_id, auth, auto_approve)
        state = await self._graph.ainvoke(
            {"messages": [HumanMessage(content=message)]}, lg_config
        )
        self._collectors.pop(thread_id, None)
        return _serialise(state)

    async def stream(
        self, message: str, thread_id: str, config: dict
    ) -> AsyncIterator[dict[str, Any]]:
        auth = config.pop("auth", {})
        auto_approve = config.pop("auto_approve", False)
        lg_config = self._make_config(thread_id, auth, auto_approve)
        async for event in self._graph.astream_events(
            {"messages": [HumanMessage(content=message)]}, config=lg_config, version="v2"
        ):
            ev_type = event.get("event", "")
            if ev_type not in ("on_chain_end", "on_chain_start"):
                continue
            node = event.get("metadata", {}).get("langgraph_node", "")
            if not node or event.get("name") != node:
                continue
            yield {"node": node, "event": ev_type, "data": _serialise(event.get("data", {}))}

    # ── Redis pub/sub helpers ──────────────────────────────────────────────────

    async def _append_event(self, thread_id: str, payload: str) -> None:
        key = f"events:{thread_id}"
        try:
            length = await self._redis.rpush(key, payload)
            if length == 1:
                await self._redis.expire(key, _TTL_SECONDS)
        except Exception as exc:
            log.warning("sre-agent.append_event.failed", thread_id=thread_id, error=str(exc))


    async def publish_stream(self, thread_id: str, input_data: Any, lg_config: dict) -> None:
        channel = f"stream:{thread_id}"
        total_input_tokens = 0
        total_output_tokens = 0
        output_texts: list[str] = []
        try:
            async for event in self._graph.astream_events(input_data, config=lg_config, version="v2"):
                ev_type = event.get("event", "")

                if ev_type == "on_chat_model_end":
                    output = event.get("data", {}).get("output")
                    usage = getattr(output, "usage_metadata", None) or {}
                    total_input_tokens += usage.get("input_tokens", 0)
                    total_output_tokens += usage.get("output_tokens", 0)
                    text = getattr(output, "content", None)
                    if text and isinstance(text, str):
                        output_texts.append(text)
                    continue

                if ev_type not in ("on_chain_end", "on_chain_start"):
                    continue
                node = event.get("metadata", {}).get("langgraph_node", "")
                if not node or event.get("name") != node:
                    continue

                payload = json.dumps(
                    {"node": node, "event": ev_type, "data": _serialise(event.get("data", {}))},
                    default=str,
                )
                await self._redis.publish(channel, payload)
                await self._append_event(thread_id, payload)

            usage_msg = json.dumps({
                "type": "usage",
                "input_tokens": total_input_tokens,
                "output_tokens": total_output_tokens,
            })
            await self._redis.publish(channel, usage_msg)
            await self._append_event(thread_id, usage_msg)

            if output_texts:
                asyncio.create_task(self._safety.scan_output(thread_id, " ".join(output_texts)))

            graph_state = await self._graph.aget_state(lg_config)
            if graph_state.next:
                interrupt_payloads = []
                for task in graph_state.tasks:
                    for intr in getattr(task, "interrupts", []):
                        interrupt_payloads.append(_serialise(getattr(intr, "value", intr)))
                terminal = json.dumps({
                    "type": "interrupt",
                    "next": list(graph_state.next),
                    "interrupts": interrupt_payloads,
                })
            else:
                terminal = json.dumps({"type": "done"})
                self._collectors.pop(thread_id, None)

            await self._redis.publish(channel, terminal)
            await self._append_event(thread_id, terminal)
            log.info("sre-agent.stream.finished", thread_id=thread_id, interrupted=bool(graph_state.next))

        except Exception as exc:
            log.error("sre-agent.stream.error", thread_id=thread_id, error=str(exc))
            self._collectors.pop(thread_id, None)
            try:
                err = json.dumps({"type": "error", "detail": str(exc)})
                await self._redis.publish(channel, err)
                await self._append_event(thread_id, err)
            except Exception:
                pass


def _extract_auth_from_headers(headers) -> dict | None:
    """Extract auth context from Envoy-injected headers (set by jwt_authn claim_to_headers).
    Also captures the raw JWT so graph nodes can call OBO token exchange downstream."""
    user_id = headers.get("x-user-id")
    tenant_id = headers.get("x-tenant-id")
    if user_id and tenant_id:
        raw = headers.get("authorization", "")
        token = raw.removeprefix("Bearer ").removeprefix("bearer ").strip()
        return {"user_id": user_id, "tenant_id": tenant_id, "token": token}
    return None


# ── Request schemas ───────────────────────────────────────────────────────────

class InvokeStreamRequest(BaseModel):
    message:      str
    thread_id:    str
    auth:         dict = {}
    auto_approve: bool = False


class ResumeStreamRequest(BaseModel):
    thread_id:    str
    response:     str
    auth:         dict = {}
    auto_approve: bool = False


class CompactRequest(BaseModel):
    thread_id: str
    messages:  list[dict]


class PingRequest(BaseModel):
    message: str


class ChainRequest(BaseModel):
    message:   str
    thread_id: str = ""


# ── App factory ───────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    agent = SREAgent()
    app = serve(agent, port=int(os.environ.get("PORT", "8001")))
    configure_tracing("sre-agent", app)

    @app.post("/graph/invoke/stream", status_code=202)
    async def graph_invoke_stream(req: InvokeStreamRequest, request: Request) -> dict:
        auth = _extract_auth_from_headers(request.headers) or req.auth
        lg_config = agent._make_config(req.thread_id, auth, req.auto_approve)
        if agent._redis:
            try:
                await agent._redis.delete("remediation:latest")
            except Exception:
                pass
        asyncio.create_task(
            agent.publish_stream(
                req.thread_id,
                {"messages": [HumanMessage(content=req.message)]},
                lg_config,
            ),
            name=f"stream-invoke-{req.thread_id[:8]}",
        )
        log.info("sre-agent.invoke_stream.started", thread_id=req.thread_id)
        return {"thread_id": req.thread_id}

    @app.post("/graph/resume/stream", status_code=202)
    async def graph_resume_stream(req: ResumeStreamRequest, request: Request) -> dict:
        from langgraph.types import Command
        auth = _extract_auth_from_headers(request.headers) or req.auth
        lg_config = agent._make_config(req.thread_id, auth, req.auto_approve)

        # Re-seed the metrics collector when resuming after a server restart.
        # On restart _collectors is wiped, so the new collector has _run_id=None
        # and collector.finish() would bail early without posting to SLMPlatform.
        collector = agent._get_metrics_collector(req.thread_id)
        if collector is not None and collector._run_id is None:
            try:
                state = await agent._graph.aget_state({"configurable": {"thread_id": req.thread_id}})
                intent = (state.values or {}).get("intent")
                if intent and getattr(intent, "domain", None):
                    await collector.start(req.thread_id, intent.domain)
                    log.info("sre-agent.resume_stream.collector_reseeded", thread_id=req.thread_id, domain=intent.domain)
            except Exception as exc:
                log.warning("sre-agent.resume_stream.collector_reseed_failed", error=str(exc))

        asyncio.create_task(
            agent.publish_stream(req.thread_id, Command(resume=req.response), lg_config),
            name=f"stream-resume-{req.thread_id[:8]}",
        )
        log.info("sre-agent.resume_stream.started", thread_id=req.thread_id)
        return {"status": "resumed"}

    @app.post("/graph/ping/stream")
    async def graph_ping_stream(req: PingRequest) -> StreamingResponse:
        """Demo endpoint: quick SRE Agent liveness reply (no LLM, no graph)."""
        async def generate():
            yield f'data: {json.dumps({"type": "chain_event", "step": "sre_response", "from_agent": "sre-agent", "content": f"SRE Agent online. Received: {req.message}"})}\n\n'
            yield f'data: {json.dumps({"type": "done"})}\n\n'

        return StreamingResponse(generate(), media_type="text/event-stream")

    @app.post("/graph/chain/stream")
    async def graph_chain_stream(req: ChainRequest, request: Request) -> StreamingResponse:
        """Real zero-trust demo: runs the actual SRE agent LangGraph on a VPN incident,
        streams real node execution (intent → think → tool calls → observe → report),
        then chains to remediation-agent via Envoy with an OBO token (RFC 8693).

        The OBO token is signed by AuthService — Envoy validates it and injects
        x-calling-agent from the calling_agent claim. OPA enforces the chain rule.
        """
        import httpx
        import uuid as _uuid

        auth_header = request.headers.get("authorization", "")
        user_token  = auth_header.removeprefix("Bearer ").removeprefix("bearer ").strip()
        auth        = _extract_auth_from_headers(request.headers) or {}
        envoy_url   = os.environ.get("ENVOY_URL",        "http://envoy:10000")
        auth_svc    = os.environ.get("AUTH_SERVICE_URL", "http://auth-service:9000")

        # Default to the real-world VPN scenario if no message supplied
        message   = req.message or (
            "Our VPN tunnels to Boston and Chicago keep dropping. "
            "Phase 2 is renegotiating repeatedly — it used to be stable. "
            "Investigate and produce a remediation plan."
        )
        thread_id = req.thread_id or f"chain-{_uuid.uuid4().hex[:8]}"

        _NODE_LABELS = {
            "manage_context":   "Managing context window",
            "extract_intent":   "Classifying VPN intent",
            "clarify":          "Requesting clarification",
            "check_plan_cache": "Checking plan cache",
            "think":            "Planning next action",
            "hitl_step_review": "Step review (auto-approved)",
            "act":              "Executing tool call",
            "observe":          "Analysing tool output",
            "analysis_summary": "Summarising analysis",
            "propose_fix":      "Proposing remediation",
            "report":           "Generating report",
        }

        async def generate():
            # ── Step 1: announce start ────────────────────────────────────────
            yield f'data: {json.dumps({"type": "chain_event", "step": "sre_start", "from_agent": "user", "to_agent": "sre-agent", "opa": "ALLOW", "reason": "JWT valid · sre-agent is primary entry point"})}\n\n'

            # ── Step 2: run the REAL SRE agent graph ─────────────────────────
            lg_config = agent._make_config(thread_id, auth, auto_approve=True)
            node_log: list[str] = []

            try:
                async for event in agent._graph.astream_events(
                    {"messages": [HumanMessage(content=message)]},
                    config=lg_config,
                    version="v2",
                ):
                    ev_type = event.get("event", "")
                    node    = event.get("metadata", {}).get("langgraph_node", "")
                    if not node or event.get("name") != node:
                        continue
                    if ev_type == "on_chain_start":
                        label = _NODE_LABELS.get(node, node)
                        node_log.append(f"[{node}] {label}")
                        yield f'data: {json.dumps({"type": "chain_event", "step": "sre_node", "node": node, "label": label, "from_agent": "sre-agent", "log": node_log[:] })}\n\n'
            except Exception as exc:
                log.error("sre-agent.graph.error", error=str(exc))
                yield f'data: {json.dumps({"type": "chain_event", "step": "error", "detail": str(exc)})}\n\n'
                yield f'data: {json.dumps({"type": "done"})}\n\n'
                return

            # ── Step 3: extract real findings from graph state ────────────────
            final = await agent._graph.aget_state(lg_config)
            vals  = final.values if final else {}

            analysis_findings = vals.get("analysis_findings") or []
            step_history      = vals.get("step_history")      or []
            remediation_plan  = vals.get("remediation_plan")  or ""
            intent            = vals.get("intent")
            report_text       = vals.get("report")            or ""

            findings = (
                f"Intent: {intent.action if intent else 'VPN tunnel investigation'}\n"
                f"Domain: {intent.domain  if intent else 'connectivity.cradlepoint'}\n\n"
                + ("Analysis findings:\n" + "\n".join(f"  - {f}" for f in analysis_findings) + "\n\n" if analysis_findings else "")
                + ("Tool steps executed:\n" + "\n".join(f"  [{s['tool_name']}]: {s['finding']}" for s in step_history) + "\n\n" if step_history else "")
                + (f"Proposed remediation:\n  {remediation_plan}\n\n" if remediation_plan else "")
                + (f"Summary:\n  {report_text}" if report_text else "")
            ) or message

            yield f'data: {json.dumps({"type": "chain_event", "step": "sre_findings", "from_agent": "sre-agent", "content": findings, "nodes_executed": len(node_log)})}\n\n'
            await asyncio.sleep(0.2)

            # ── Step 4: exchange user JWT for OBO token (RFC 8693) ────────────
            obo_token: str | None = None
            try:
                async with httpx.AsyncClient(timeout=5.0) as c:
                    r = await c.post(
                        f"{auth_svc}/auth/token/exchange",
                        json={"assertion": user_token, "scope": "remediation-agent", "calling_agent": "sre-agent"},
                    )
                    r.raise_for_status()
                    obo_token = r.json()["access_token"]
            except Exception as exc:
                log.error("sre-agent.obo_exchange.failed", error=str(exc))
                yield f'data: {json.dumps({"type": "chain_event", "step": "error", "detail": f"OBO exchange failed: {exc}"})}\n\n'
                yield f'data: {json.dumps({"type": "done"})}\n\n'
                return

            yield f'data: {json.dumps({"type": "chain_event", "step": "obo_issued", "from_agent": "sre-agent", "detail": "AuthService signed OBO token: act.sub=sre-agent · aud=remediation-agent · exp=5min"})}\n\n'
            await asyncio.sleep(0.15)

            # ── Step 5: announce chain call ───────────────────────────────────
            yield f'data: {json.dumps({"type": "chain_event", "step": "chain_request", "from_agent": "sre-agent", "to_agent": "remediation-agent", "headers": {"Authorization": "Bearer <obo-token>", "x-calling-agent": "injected by Envoy jwt_authn from calling_agent claim", "x-target-agent": "injected by Envoy header_mutation"}})}\n\n'
            await asyncio.sleep(0.15)

            # ── Step 6: call remediation-agent via Envoy (OBO token only) ─────
            # x-calling-agent is NOT set here — Envoy injects it from the verified JWT.
            try:
                async with httpx.AsyncClient(timeout=60.0) as c:
                    resp = await c.post(
                        f"{envoy_url}/remediation/graph/invoke",
                        json={"message": findings, "thread_id": thread_id},
                        headers={"Authorization": f"Bearer {obo_token}", "Content-Type": "application/json"},
                    )
                if resp.status_code == 403:
                    yield f'data: {json.dumps({"type": "chain_event", "step": "opa_deny", "from_agent": "sre-agent", "to_agent": "remediation-agent", "opa": "DENY", "reason": "OPA denied: chain_enabled=false · toggle the Policy Gate to ALLOW"})}\n\n'
                else:
                    result     = resp.json()
                    plan       = result.get("plan", {})
                    steps      = plan.get("steps", [])
                    destructive = [s for s in steps if s.get("risk") == "DESTRUCTIVE"]
                    yield f'data: {json.dumps({"type": "chain_event", "step": "remediation_response", "from_agent": "remediation-agent", "to_agent": "sre-agent", "opa": "ALLOW", "reason": "OBO JWT verified · x-calling-agent: sre-agent · chain rule matched", "plan": plan, "destructive_count": len(destructive)})}\n\n'
            except Exception as exc:
                log.error("sre-agent.chain.error", error=str(exc))
                yield f'data: {json.dumps({"type": "chain_event", "step": "error", "detail": str(exc)})}\n\n'

            yield f'data: {json.dumps({"type": "done"})}\n\n'

        return StreamingResponse(generate(), media_type="text/event-stream")

    @app.post("/graph/compact")
    async def compact_messages(req: CompactRequest) -> dict:
        from langchain_core.messages import messages_from_dict
        config = {"configurable": {"thread_id": req.thread_id}}
        compacted = messages_from_dict(req.messages)
        await agent._graph.aupdate_state(config, {"messages": compacted})
        return {"ok": True, "message_count": len(compacted)}

    @app.get("/history")
    async def get_history(tenant_id: str = Query(""), limit: int = Query(20, le=100)) -> list[dict]:
        if agent._db_session_factory is None:
            return []
        from worker_agent.persistence import plan_history_repo
        try:
            async with agent._db_session_factory() as session:
                rows = await plan_history_repo.get_all_recent(session, limit=limit, tenant_id=tenant_id)
            return [
                {
                    "plan_id":        str(row.plan_id),
                    "action":         row.action,
                    "domain":         row.domain,
                    "intent_summary": row.intent_summary or "",
                    "outcome":        row.outcome,
                    "steps":          row.steps or [],
                    "tool_results":   row.tool_results or {},
                    "created_at":     row.created_at.isoformat() if row.created_at else None,
                }
                for row in rows
            ]
        except Exception as exc:
            log.warning("sre-agent.history.error", error=str(exc))
            return []

    @app.get("/remediation-result")
    async def remediation_result() -> dict:
        """Return the latest remediation plan published by chain_remediate node.
        RemediationPage polls this every 2s — updates the moment sre-agent chains."""
        if agent._redis is None:
            return {"status": "no_data"}
        raw = await agent._redis.get("remediation:latest")
        if not raw:
            return {"status": "no_data"}
        import json as _json
        return {"status": "ok", "data": _json.loads(raw)}

    @app.delete("/remediation-result")
    async def clear_remediation_result() -> dict:
        if agent._redis:
            await agent._redis.delete("remediation:latest")
        return {"status": "cleared"}

    @app.get("/events/{thread_id}")
    async def get_events(thread_id: str, from_index: int = Query(0, alias="from")) -> dict:
        key = f"events:{thread_id}"
        raw_list = await agent._redis.lrange(key, from_index, -1)
        events = []
        for i, raw in enumerate(raw_list):
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {"raw": raw}
            events.append({"index": from_index + i, "payload": payload})
        total = await agent._redis.llen(key)
        return {"events": events, "total": total}

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    configure_logging()
    uvicorn.run("agent.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8001")), reload=False)
