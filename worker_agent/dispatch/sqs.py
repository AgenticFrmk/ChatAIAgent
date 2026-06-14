from __future__ import annotations

import json
from typing import Any

from worker_agent.dispatch.base import (
    DispatchAdapter,
    LeaseExpiredError,
    StepMessage,
    StepResultPayload,
)


class SQSDispatchAdapter(DispatchAdapter):
    """
    DispatchAdapter backed by AWS SQS.
    Uses aioboto3 for async SQS operations.
    Requires: pip install aioboto3
    """

    def __init__(self, queue_url: str, **kwargs):
        self._queue_url = queue_url
        self._receipts: dict[str, str] = {}
        self._session: Any = None
        self._sqs: Any = None

    async def _get_sqs(self) -> Any:
        if self._sqs is None:
            try:
                import aioboto3
            except ImportError as exc:
                raise ImportError(
                    "aioboto3 is required for SQSDispatchAdapter. "
                    "Install it with: pip install aioboto3"
                ) from exc
            self._session = aioboto3.Session()
            # Note: In production use async context manager; here we open lazily.
            self._sqs = await self._session.client("sqs").__aenter__()
        return self._sqs

    async def _write_result_to_postgres(
        self, step_id: str, result: StepResultPayload, worker_id: str | None = None
    ) -> None:
        """
        Placeholder: write result to Postgres for auditability.
        In production, inject a repo or db connection at construction time.
        """
        # Override this method or inject a repo via __init__ for full integration.
        pass

    async def enqueue(self, plan_id: str, step_id: str) -> None:
        sqs = await self._get_sqs()
        await sqs.send_message(
            QueueUrl=self._queue_url,
            MessageBody=json.dumps({"plan_id": plan_id, "step_id": step_id}),
        )

    async def claim(
        self, step_id: str, worker_id: str, lease_secs: int
    ) -> StepMessage | None:
        # SQS: receive a message; visibility timeout acts as lease.
        # Note: step_id is ignored for SQS — messages are received in FIFO order.
        sqs = await self._get_sqs()
        msgs = await sqs.receive_message(
            QueueUrl=self._queue_url,
            MaxNumberOfMessages=1,
            VisibilityTimeout=lease_secs,
        )
        if not msgs.get("Messages"):
            return None
        msg = msgs["Messages"][0]
        body = json.loads(msg["Body"])
        self._receipts[body["step_id"]] = msg["ReceiptHandle"]
        return StepMessage(
            plan_id=body["plan_id"],
            step_id=body["step_id"],
            attempt=1,
        )

    async def extend(
        self, step_id: str, worker_id: str, lease_secs: int
    ) -> bool:
        receipt = self._receipts.get(step_id)
        if not receipt:
            return False
        sqs = await self._get_sqs()
        await sqs.change_message_visibility(
            QueueUrl=self._queue_url,
            ReceiptHandle=receipt,
            VisibilityTimeout=lease_secs,
        )
        return True

    async def complete(
        self, step_id: str, worker_id: str, result: StepResultPayload
    ) -> None:
        # Write result to Postgres (always authoritative), then ack SQS.
        await self._write_result_to_postgres(step_id, result, worker_id)
        receipt = self._receipts.pop(step_id)
        sqs = await self._get_sqs()
        await sqs.delete_message(
            QueueUrl=self._queue_url,
            ReceiptHandle=receipt,
        )

    async def release(self, step_id: str, worker_id: str) -> None:
        receipt = self._receipts.pop(step_id, None)
        if receipt:
            sqs = await self._get_sqs()
            await sqs.change_message_visibility(
                QueueUrl=self._queue_url,
                ReceiptHandle=receipt,
                VisibilityTimeout=0,
            )
