from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.persistence.models import PlanHistory

log = structlog.get_logger()

# PII scrubbing patterns
_IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}(?:/\d+)?\b")
_EMAIL_RE = re.compile(r"\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b")
# Tokens ≥ 12 chars containing at least one digit — likely resource/account IDs
_ID_RE = re.compile(r"\b(?=[a-zA-Z0-9_\-]*\d)[a-zA-Z0-9_\-]{12,}\b")


def _strip_intent_summary(text: str) -> str:
    """Scrub PII from raw intent text: removes IPs, emails, and long ID tokens."""
    text = _IPV4_RE.sub("[IP]", text)
    text = _EMAIL_RE.sub("[EMAIL]", text)
    text = _ID_RE.sub("[ID]", text)
    return text.strip()


def _strip_entity_summary(entities: dict[str, Any]) -> dict[str, str]:
    """Return {field_name: type_name} for all entity fields — no values stored."""
    result: dict[str, str] = {}
    for domain_val in entities.values():
        fields: dict[str, Any] = {}
        if isinstance(domain_val, dict):
            fields = domain_val
        elif hasattr(domain_val, "model_fields"):
            fields = {f: getattr(domain_val, f, None) for f in domain_val.model_fields}
        elif hasattr(domain_val, "__dict__"):
            fields = {k: v for k, v in domain_val.__dict__.items() if not k.startswith("_")}
        for field, value in fields.items():
            result[field] = type(value).__name__ if value is not None else "NoneType"
    return result


async def save(
    session: AsyncSession,
    plan_id: UUID,
    action: str,
    domain: str,
    intent_text: str,
    entities: dict[str, Any],
    steps: list[dict],
    tool_results: dict[str, dict],
    outcome: str,
    tenant_id: str | None = None,
    user_id: str | None = None,
) -> None:
    """Write one plan_history row. Swallows all exceptions — non-critical path."""
    try:
        row = PlanHistory(
            plan_id=plan_id,
            action=action,
            domain=domain,
            intent_summary=_strip_intent_summary(intent_text),
            entity_summary=_strip_entity_summary(entities),
            steps=steps,
            tool_results=tool_results,
            outcome=outcome,
            tenant_id=tenant_id,
            user_id=user_id,
        )
        session.add(row)
        await session.flush()
    except Exception:
        log.warning("plan_history save failed", exc_info=True)


async def get_all_recent(
    session: AsyncSession,
    limit: int = 20,
    tenant_id: str | None = None,
) -> list[PlanHistory]:
    """Return up to `limit` most recent rows, optionally filtered by tenant."""
    stmt = select(PlanHistory).order_by(PlanHistory.created_at.desc()).limit(limit)
    if tenant_id is not None:
        stmt = stmt.where(PlanHistory.tenant_id == tenant_id)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_best_cached(
    session: AsyncSession,
    action: str,
    domain: str,
    ttl_days: int | None = None,
    tenant_id: str | None = None,
) -> PlanHistory | None:
    """Return the most recent COMPLETED plan for (action, domain) within TTL.

    Never raises — returns None on any error so callers always fall through to
    the normal think/act flow.
    """
    if ttl_days is None:
        ttl_days = int(os.getenv("PLAN_CACHE_TTL_DAYS", "7"))
    try:
        cutoff = datetime.now(tz=timezone.utc) - timedelta(days=ttl_days)
        stmt = (
            select(PlanHistory)
            .where(
                PlanHistory.action == action,
                PlanHistory.domain == domain,
                PlanHistory.outcome == "COMPLETED",
                PlanHistory.created_at >= cutoff,
            )
            .order_by(PlanHistory.created_at.desc())
            .limit(1)
        )
        if tenant_id is not None:
            stmt = stmt.where(PlanHistory.tenant_id == tenant_id)
        result = await session.execute(stmt)
        return result.scalars().first()
    except Exception:
        log.warning("plan_cache lookup failed", exc_info=True)
        return None


async def get_recent(
    session: AsyncSession,
    action: str,
    domain: str,
    limit: int = 3,
    outcome_filter: str | None = "COMPLETED",
) -> list[PlanHistory]:
    """Return up to `limit` rows newest-first, filtered by action + domain."""
    stmt = (
        select(PlanHistory)
        .where(PlanHistory.action == action, PlanHistory.domain == domain)
        .order_by(PlanHistory.created_at.desc())
        .limit(limit)
    )
    if outcome_filter is not None:
        stmt = stmt.where(PlanHistory.outcome == outcome_filter)
    result = await session.execute(stmt)
    return list(result.scalars().all())
