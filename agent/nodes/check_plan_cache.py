from __future__ import annotations

import os

import structlog
from langchain_core.runnables import RunnableConfig

from agent.graph.state import AgentState

log = structlog.get_logger()


def _format_cached_steps(steps: list[dict]) -> str:
    lines = []
    for i, step in enumerate(steps, 1):
        tool = step.get("tool_name", "unknown")
        desc = step.get("name") or step.get("description") or tool
        lines.append(f"{i}. {desc} (tool: {tool})")
    return "\n".join(lines) if lines else "(no steps recorded)"


async def check_plan_cache(state: AgentState, config: RunnableConfig) -> dict:
    """Query plan_history for a reusable cached plan.

    Returns state patches on hit; empty dict on miss so the normal think/act
    flow is entered unchanged.
    """
    if os.getenv("PLAN_CACHE_ENABLED", "true").lower() == "false":
        return {}

    intent = state.get("intent")
    if not intent:
        return {}

    cfg = config.get("configurable") or {}
    session_factory = cfg.get("session_factory")
    if session_factory is None:
        return {}

    tenant_id: str | None = cfg.get("tenant_id")

    try:
        from agent.persistence.plan_history_repo import get_best_cached

        async with session_factory() as session:
            row = await get_best_cached(
                session,
                action=intent.action,
                domain=intent.domain,
                tenant_id=tenant_id,
            )
    except Exception:
        log.warning("check_plan_cache db error", exc_info=True)
        return {}

    if row is None:
        log.info("plan_cache.miss", action=intent.action, domain=intent.domain)
        return {}

    proposal = _format_cached_steps(row.steps or [])
    log.info(
        "plan_cache.hit",
        action=intent.action,
        domain=intent.domain,
        source_plan_id=str(row.plan_id),
    )
    return {
        "plan_cache_hit": True,
        "cached_plan_proposal": proposal,
        "analysis_findings": [
            f"[Cached plan from {row.created_at.date()}] {row.intent_summary}"
        ],
    }
