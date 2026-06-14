from __future__ import annotations

import contextlib
from typing import Any


class SessionConflictError(Exception):
    """Raised when a session advisory lock cannot be acquired (split-brain prevention)."""
    pass


@contextlib.asynccontextmanager
async def with_session_lock(conn: Any, thread_id: str):
    """
    Acquire a PostgreSQL advisory lock keyed on thread_id.
    Raises SessionConflictError if the lock is already held by another instance.

    Args:
        conn: A raw asyncpg connection.
        thread_id: The LangGraph session / thread identifier.
    """
    acquired = await conn.fetchval(
        "SELECT pg_try_advisory_lock(hashtext($1))", thread_id
    )
    if not acquired:
        raise SessionConflictError(
            f"Session {thread_id} active on another instance"
        )
    try:
        yield
    finally:
        await conn.execute(
            "SELECT pg_advisory_unlock(hashtext($1))", thread_id
        )
