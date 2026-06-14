from __future__ import annotations

import asyncpg

from worker_agent.dispatch.base import (
    DispatchAdapter,
    LeaseExpiredError,
    StepMessage,
    StepResultPayload,
)


class PostgresDispatchAdapter(DispatchAdapter):
    """
    DispatchAdapter backed by PostgreSQL.
    Uses asyncpg directly for atomic SQL operations.
    """

    def __init__(self, db_url: str, **kwargs):
        # Convert SQLAlchemy-style URL to asyncpg DSN if needed
        self._db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")
        self._pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        """Create the asyncpg connection pool. Call this before using the adapter."""
        self._pool = await asyncpg.create_pool(self._db_url)

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            await self.connect()
        return self._pool  # type: ignore[return-value]

    async def next_pending_step_id(self) -> str | None:
        """Return a PENDING step id, or None if none available. Used by worker."""
        pool = await self._get_pool()
        row = await pool.fetchrow(
            "SELECT id FROM steps WHERE status='PENDING' LIMIT 1"
        )
        return row["id"] if row else None

    async def enqueue(self, plan_id: str, step_id: str) -> None:
        pool = await self._get_pool()
        await pool.execute(
            "UPDATE steps SET status='PENDING' WHERE id=$1", step_id
        )

    async def claim(
        self, step_id: str, worker_id: str, lease_secs: int
    ) -> StepMessage | None:
        pool = await self._get_pool()
        row = await pool.fetchrow(
            """
            UPDATE steps
            SET status='RUNNING', lock_token=$2,
                lock_expires_at=now() + ($3 || ' seconds')::interval,
                attempts=attempts+1
            WHERE id=$1
              AND status='PENDING'
              AND (lock_token IS NULL OR lock_expires_at < now())
            RETURNING plan_id, id, attempts
            """,
            step_id,
            worker_id,
            str(lease_secs),
        )
        if row is None:
            return None
        return StepMessage(
            plan_id=row["plan_id"],
            step_id=row["id"],
            attempt=row["attempts"],
        )

    async def extend(
        self, step_id: str, worker_id: str, lease_secs: int
    ) -> bool:
        pool = await self._get_pool()
        result = await pool.execute(
            """
            UPDATE steps SET lock_expires_at=now() + ($3 || ' seconds')::interval
            WHERE id=$1 AND lock_token=$2
            """,
            step_id,
            worker_id,
            str(lease_secs),
        )
        return result == "UPDATE 1"

    async def complete(
        self, step_id: str, worker_id: str, result: StepResultPayload
    ) -> None:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                import json as _json

                output_json = (
                    _json.dumps(result.output) if result.output is not None else None
                )
                await conn.execute(
                    """
                    INSERT INTO step_results
                        (step_id, attempt, status, output, error, finished_at, worker_id)
                    VALUES (
                        $1,
                        (SELECT attempts FROM steps WHERE id=$1),
                        $2, $3::jsonb, $4, now(), $5
                    )
                    """,
                    step_id,
                    result.status,
                    output_json,
                    result.error,
                    worker_id,
                )
                updated = await conn.execute(
                    """
                    UPDATE steps SET status=$2, lock_token=NULL, lock_expires_at=NULL
                    WHERE id=$1 AND lock_token=$3
                    """,
                    step_id,
                    result.status,
                    worker_id,
                )
                if updated != "UPDATE 1":
                    raise LeaseExpiredError(f"Lease stolen on step {step_id}")

    async def release(self, step_id: str, worker_id: str) -> None:
        pool = await self._get_pool()
        await pool.execute(
            """
            UPDATE steps SET status='PENDING', lock_token=NULL, lock_expires_at=NULL
            WHERE id=$1 AND lock_token=$2
            """,
            step_id,
            worker_id,
        )
