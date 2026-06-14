import asyncio
import os
import signal
import uuid

import structlog

from agent.dispatch.base import (
    DispatchAdapter,
    LeaseExpiredError,
    StepMessage,
    StepResultPayload,
)
from agent.dispatch.factory import create_adapter
from agent.tools.registry import TOOL_REGISTRY, UnknownToolError

log = structlog.get_logger()

LEASE_SECS = int(os.getenv("LEASE_SECS", "60"))
POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", "2"))
DRAIN_TIMEOUT = float(os.getenv("DRAIN_TIMEOUT", "30"))
MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT_STEPS", "4"))
WORKER_ID = os.getenv("WORKER_ID", f"worker-{uuid.uuid4().hex[:8]}")


class Worker:
    def __init__(self, adapter: DispatchAdapter, worker_id: str = WORKER_ID):
        self.adapter = adapter
        self.worker_id = worker_id
        self.accepting = True
        self.current_task: asyncio.Task | None = None
        self.current_step_id: str | None = None
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    def stop(self):
        self.accepting = False


async def next_pending_step_id(adapter: DispatchAdapter) -> str | None:
    """
    Return the next PENDING step id.
    For Postgres adapter: uses next_pending_step_id().
    For push-based adapters: returns a sentinel (adapter handles it in claim).
    """
    if hasattr(adapter, "next_pending_step_id"):
        return await adapter.next_pending_step_id()
    # For push-based adapters (SQS, PubSub), return a placeholder;
    # the adapter's claim() will handle message delivery.
    return "__push__"


async def heartbeat_task(
    adapter: DispatchAdapter, step_id: str, worker_id: str, lease_secs: int
) -> None:
    """Periodically extend the lease. Raises LeaseExpiredError if lease is stolen."""
    while True:
        await asyncio.sleep(lease_secs // 2)
        still_held = await adapter.extend(step_id, worker_id, lease_secs)
        if not still_held:
            raise LeaseExpiredError(f"Lease stolen on {step_id}; aborting")


async def execute_and_complete(
    adapter: DispatchAdapter, msg: StepMessage, worker_id: str
) -> None:
    """Execute a step and mark it complete (or failed). Manages heartbeat."""
    step_id = msg.step_id

    hb = asyncio.create_task(
        heartbeat_task(adapter, step_id, worker_id, LEASE_SECS)
    )

    try:
        # Resolve step details — in a real deployment, load from DB.
        # Here we rely on msg carrying enough info; tool resolution uses TOOL_REGISTRY.
        # For integration: load step from persistence repo.
        tool_name = getattr(msg, "tool_name", None)
        inputs: dict = getattr(msg, "inputs", {})

        tool = None
        if tool_name:
            tool = TOOL_REGISTRY.get(tool_name)

        if tool is None and tool_name:
            raise UnknownToolError(f"No tool registered for '{tool_name}'")

        if tool is not None:
            output = await tool(**inputs)
            result = StepResultPayload(status="completed", output=output, error=None)
        else:
            # No tool_name in message — step details must be resolved separately
            result = StepResultPayload(status="completed", output=None, error=None)

        hb.cancel()
        await adapter.complete(step_id, worker_id, result)
        log.info("step completed", step_id=step_id, worker_id=worker_id)

    except UnknownToolError as exc:
        hb.cancel()
        log.error("unknown tool", step_id=step_id, error=str(exc))
        failed = StepResultPayload(status="failed", output=None, error=str(exc))
        await adapter.complete(step_id, worker_id, failed)

    except LeaseExpiredError:
        hb.cancel()
        log.warning("lease stolen, discarding result", step_id=step_id)
        # Do not write result; another worker owns this step.

    except Exception as exc:
        hb.cancel()
        log.exception("step failed", step_id=step_id, error=str(exc))
        failed = StepResultPayload(status="failed", output=None, error=str(exc))
        try:
            await adapter.release(step_id, worker_id)
        except Exception:
            pass


async def run_worker(adapter: DispatchAdapter, worker_id: str = WORKER_ID) -> None:
    """Main worker event loop. Polls for steps and executes them concurrently."""
    worker = Worker(adapter, worker_id)

    async def _loop():
        while worker.accepting:
            pending_id = await next_pending_step_id(adapter)
            if pending_id is None:
                await asyncio.sleep(POLL_INTERVAL)
                continue

            async with worker._semaphore:
                msg = await adapter.claim(
                    step_id=pending_id,
                    worker_id=worker_id,
                    lease_secs=LEASE_SECS,
                )
                if msg is None:
                    await asyncio.sleep(POLL_INTERVAL)
                    continue

                worker.current_step_id = msg.step_id
                task = asyncio.create_task(
                    execute_and_complete(adapter, msg, worker_id)
                )
                worker.current_task = task
                await task

    try:
        await _loop()
    except asyncio.CancelledError:
        pass


async def graceful_shutdown(adapter: DispatchAdapter, worker: Worker) -> None:
    """Handle SIGTERM: stop accepting, drain current task, release if timeout."""
    worker.accepting = False
    if worker.current_task is not None and not worker.current_task.done():
        try:
            await asyncio.wait_for(worker.current_task, timeout=DRAIN_TIMEOUT)
        except asyncio.TimeoutError:
            log.warning("drain timeout exceeded, releasing lease", step_id=worker.current_step_id)
            if worker.current_step_id:
                await adapter.release(worker.current_step_id, worker.worker_id)


def _install_signal_handlers(adapter: DispatchAdapter, worker: Worker) -> None:
    loop = asyncio.get_event_loop()

    def _handle_sigterm():
        log.info("SIGTERM received, initiating graceful shutdown")
        loop.create_task(graceful_shutdown(adapter, worker))

    loop.add_signal_handler(signal.SIGTERM, _handle_sigterm)


async def main() -> None:
    from agentcore.logging_setup import configure_logging
    configure_logging("agentcore-worker")
    log.info("worker starting", worker_id=WORKER_ID)

    adapter = create_adapter()
    if hasattr(adapter, "connect"):
        await adapter.connect()

    worker = Worker(adapter, WORKER_ID)
    _install_signal_handlers(adapter, worker)
    await run_worker(adapter, WORKER_ID)


if __name__ == "__main__":
    asyncio.run(main())
