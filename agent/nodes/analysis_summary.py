from __future__ import annotations

import hashlib
import os

import structlog
from langgraph.types import interrupt
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig

from agent.graph.state import AgentState
from worker_agent.llm import LLMConfig

log = structlog.get_logger()

_REDIS_URL      = os.environ.get("REDIS_URL", "redis://redis:6379/0")
_RCA_CACHE_TTL  = int(os.environ.get("RAG_CACHE_TTL_SECONDS", "86400"))

_APPROVALS = {"yes", "y", "approve", "approved", "ok", "okay", "proceed", "sure"}


async def analysis_summary(state: AgentState, config: RunnableConfig) -> dict:
    llm_config: LLMConfig = config["configurable"]["llm_config"]
    findings = state.get("analysis_findings") or []

    findings_block = (
        "\n".join(f"{i+1}. {f}" for i, f in enumerate(findings))
        or "(no findings recorded)"
    )

    cache_key = f"rca:{hashlib.sha256(findings_block.encode()).hexdigest()[:16]}"
    summary: str | None = None

    # Check Redis cache before calling LLM
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(_REDIS_URL, decode_responses=True)
        async with r:
            cached = await r.get(cache_key)
            if cached:
                summary = cached
                log.info("analysis_summary.cache_hit", key=cache_key)
    except Exception:
        pass

    if summary is None:
        system = "You are summarizing a diagnostic investigation."
        human = (
            "Given the findings below, synthesize a clear root cause analysis in 2-3 sentences.\n\n"
            f"Findings:\n{findings_block}"
        )
        msg = await llm_config.default_llm.ainvoke([SystemMessage(content=system), HumanMessage(content=human)])
        summary = msg.content if hasattr(msg, "content") else str(msg)

        try:
            import redis.asyncio as aioredis
            r = aioredis.from_url(_REDIS_URL, decode_responses=True)
            async with r:
                await r.set(cache_key, summary, ex=_RCA_CACHE_TTL)
                log.info("analysis_summary.cache_set", key=cache_key)
        except Exception:
            pass

    user_response: str = interrupt({
        "summary": summary,
        "findings": findings,
        "message": "I found the issue above. Do you want me to propose a fix? (yes / no)",
    })

    return {"hitl_response": user_response}
