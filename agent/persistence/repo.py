from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.dispatch.base import StepResultPayload
from agent.persistence.models import Plan, Step, StepResult


async def get_plan(session: AsyncSession, plan_id: UUID) -> Plan | None:
    result = await session.get(Plan, plan_id)
    return result


async def get_step(session: AsyncSession, step_id: str) -> Step | None:
    result = await session.get(Step, step_id)
    return result


async def write_result(
    session: AsyncSession,
    step_id: str,
    result: StepResultPayload,
    worker_id: str | None = None,
) -> None:
    """Write a step result row and update the step status."""
    # Fetch current attempt count from step
    step = await session.get(Step, step_id)
    attempt = step.attempts if step else 0

    row = StepResult(
        step_id=step_id,
        attempt=attempt,
        status=result.status,
        output=result.output,
        error=result.error,
        worker_id=worker_id,
    )
    session.add(row)
    if step:
        step.status = result.status
    await session.flush()


async def get_step_result(
    session: AsyncSession, step_id: str
) -> StepResult | None:
    """Return the most recent result row for a step, or None."""
    stmt = (
        select(StepResult)
        .where(StepResult.step_id == step_id)
        .order_by(StepResult.id.desc())
        .limit(1)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()
