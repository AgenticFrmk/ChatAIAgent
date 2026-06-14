from __future__ import annotations

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.evolution.patterns import (
    extract_consistent_orderings,
    extract_parallel_patterns,
)
from agent.persistence.models import PlanHistory, PlaybookSuggestion

log = structlog.get_logger()

_BATCH_SIZE = 10


class PlaybookEvolutionJob:
    BATCH_SIZE = _BATCH_SIZE
    MIN_FREQ_ORDERING = 0.9
    MIN_FREQ_PARALLEL = 0.8

    async def run(self, action: str, domain: str, session: AsyncSession) -> None:
        """Fetch last BATCH_SIZE COMPLETED plans, extract patterns, write suggestions."""
        stmt = (
            select(PlanHistory)
            .where(
                PlanHistory.action == action,
                PlanHistory.domain == domain,
                PlanHistory.outcome == "COMPLETED",
            )
            .order_by(PlanHistory.created_at.desc())
            .limit(self.BATCH_SIZE)
        )
        result = await session.execute(stmt)
        plans = list(result.scalars().all())

        if len(plans) < self.BATCH_SIZE:
            return

        candidates = extract_consistent_orderings(plans, self.MIN_FREQ_ORDERING)
        candidates += extract_parallel_patterns(plans, self.MIN_FREQ_PARALLEL)

        await self._write_suggestions(action, domain, candidates, session)

    async def _write_suggestions(
        self,
        action: str,
        domain: str,
        candidates: list[dict],
        session: AsyncSession,
    ) -> None:
        """Insert PENDING rows; skip any already ACCEPTED or REJECTED."""
        for c in candidates:
            # Check for existing ACCEPTED/REJECTED duplicate
            existing_stmt = select(PlaybookSuggestion).where(
                PlaybookSuggestion.action == action,
                PlaybookSuggestion.domain == domain,
                PlaybookSuggestion.rule_type == c["rule_type"],
                PlaybookSuggestion.before_tool == c.get("before_tool"),
                PlaybookSuggestion.after_tool == c.get("after_tool"),
                PlaybookSuggestion.status.in_(["ACCEPTED", "REJECTED"]),
            )
            existing = (await session.execute(existing_stmt)).scalar_one_or_none()
            if existing is not None:
                continue

            row = PlaybookSuggestion(
                action=action,
                domain=domain,
                rule_type=c["rule_type"],
                before_tool=c.get("before_tool"),
                after_tool=c.get("after_tool"),
                tools=c.get("tools"),
                frequency=c["frequency"],
                sample_size=c["sample_size"],
                status="PENDING",
            )
            session.add(row)

        await session.flush()


async def _count_completed(action: str, domain: str, session: AsyncSession) -> int:
    """Count COMPLETED plan_history rows for this action+domain."""
    stmt = select(func.count()).where(
        PlanHistory.action == action,
        PlanHistory.domain == domain,
        PlanHistory.outcome == "COMPLETED",
    )
    result = await session.execute(stmt)
    return result.scalar_one()


async def trigger_evolution_check(
    action: str,
    domain: str,
    session: AsyncSession,
) -> None:
    """Called after every COMPLETED plan_history write. Fire-and-forget."""
    try:
        count = await _count_completed(action, domain, session)
        if count >= _BATCH_SIZE and count % _BATCH_SIZE == 0:
            await PlaybookEvolutionJob().run(action, domain, session)
    except Exception:
        log.warning("playbook evolution job failed", exc_info=True)
