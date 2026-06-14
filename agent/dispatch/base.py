from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


class LeaseExpiredError(Exception):
    """Raised when a worker's lease has been stolen before completing a step."""
    pass


@dataclass
class StepMessage:
    """Minimal payload the adapter delivers to a worker."""
    plan_id: str
    step_id: str
    attempt: int


@dataclass
class StepResultPayload:
    status: str                    # "completed" | "failed" | "skipped"
    output: dict[str, Any] | None
    error: str | None


class DispatchAdapter(ABC):
    """
    Decouples control plane and workers from any specific backend.
    Implement this to support a new dispatch mechanism.
    """

    # --- Control plane side ---

    @abstractmethod
    async def enqueue(self, plan_id: str, step_id: str) -> None:
        """Mark a step as ready for execution. Called by executor_router."""
        ...

    # --- Worker side ---

    @abstractmethod
    async def claim(
        self, step_id: str, worker_id: str, lease_secs: int
    ) -> StepMessage | None:
        """
        Atomically claim a step for this worker.
        Returns StepMessage on success, None if already claimed or not available.
        """
        ...

    @abstractmethod
    async def extend(
        self, step_id: str, worker_id: str, lease_secs: int
    ) -> bool:
        """
        Extend the lease on a claimed step (heartbeat).
        Returns False if the lease was stolen — worker must abort.
        """
        ...

    @abstractmethod
    async def complete(
        self, step_id: str, worker_id: str, result: StepResultPayload
    ) -> None:
        """
        Write the result and release the claim.
        Raises if the lease was stolen before this call.
        """
        ...

    @abstractmethod
    async def release(self, step_id: str, worker_id: str) -> None:
        """
        Release a lease without completing (e.g. on SIGTERM drain).
        Makes the step available for another worker to claim.
        """
        ...
