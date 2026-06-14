from __future__ import annotations

import json
from typing import Any

from agent.dispatch.base import (
    DispatchAdapter,
    StepMessage,
    StepResultPayload,
)


class PubSubDispatchAdapter(DispatchAdapter):
    """
    DispatchAdapter backed by Google Cloud Pub/Sub.
    Requires: pip install google-cloud-pubsub

    Uses pull-based subscription with modifyAckDeadline for lease management.
    """

    def __init__(
        self,
        project: str,
        topic: str,
        subscription: str,
        **kwargs,
    ):
        self._project = project
        self._topic = topic
        self._subscription = subscription
        self._publisher: Any = None
        self._subscriber: Any = None
        # Maps step_id -> ack_id for outstanding messages
        self._ack_ids: dict[str, str] = {}

    def _get_publisher(self) -> Any:
        if self._publisher is None:
            try:
                from google.cloud import pubsub_v1
            except ImportError as exc:
                raise ImportError(
                    "google-cloud-pubsub is required for PubSubDispatchAdapter. "
                    "Install it with: pip install google-cloud-pubsub"
                ) from exc
            self._publisher = pubsub_v1.PublisherClient()
        return self._publisher

    def _get_subscriber(self) -> Any:
        if self._subscriber is None:
            try:
                from google.cloud import pubsub_v1
            except ImportError as exc:
                raise ImportError(
                    "google-cloud-pubsub is required for PubSubDispatchAdapter. "
                    "Install it with: pip install google-cloud-pubsub"
                ) from exc
            self._subscriber = pubsub_v1.SubscriberClient()
        return self._subscriber

    def _topic_path(self) -> str:
        return f"projects/{self._project}/topics/{self._topic}"

    def _subscription_path(self) -> str:
        return f"projects/{self._project}/subscriptions/{self._subscription}"

    async def enqueue(self, plan_id: str, step_id: str) -> None:
        publisher = self._get_publisher()
        message_data = json.dumps(
            {"plan_id": plan_id, "step_id": step_id}
        ).encode("utf-8")
        future = publisher.publish(self._topic_path(), data=message_data)
        # Block on the publish future to confirm delivery.
        future.result()

    async def claim(
        self, step_id: str, worker_id: str, lease_secs: int
    ) -> StepMessage | None:
        subscriber = self._get_subscriber()
        response = subscriber.pull(
            request={
                "subscription": self._subscription_path(),
                "max_messages": 1,
            }
        )
        if not response.received_messages:
            return None
        received = response.received_messages[0]
        body = json.loads(received.message.data.decode("utf-8"))
        received_step_id = body["step_id"]
        self._ack_ids[received_step_id] = received.ack_id
        # Set initial ack deadline to lease_secs
        subscriber.modify_ack_deadline(
            request={
                "subscription": self._subscription_path(),
                "ack_ids": [received.ack_id],
                "ack_deadline_seconds": lease_secs,
            }
        )
        return StepMessage(
            plan_id=body["plan_id"],
            step_id=received_step_id,
            attempt=1,
        )

    async def extend(
        self, step_id: str, worker_id: str, lease_secs: int
    ) -> bool:
        ack_id = self._ack_ids.get(step_id)
        if not ack_id:
            return False
        subscriber = self._get_subscriber()
        subscriber.modify_ack_deadline(
            request={
                "subscription": self._subscription_path(),
                "ack_ids": [ack_id],
                "ack_deadline_seconds": lease_secs,
            }
        )
        return True

    async def complete(
        self, step_id: str, worker_id: str, result: StepResultPayload
    ) -> None:
        ack_id = self._ack_ids.pop(step_id, None)
        if ack_id is None:
            return
        subscriber = self._get_subscriber()
        subscriber.acknowledge(
            request={
                "subscription": self._subscription_path(),
                "ack_ids": [ack_id],
            }
        )

    async def release(self, step_id: str, worker_id: str) -> None:
        ack_id = self._ack_ids.pop(step_id, None)
        if ack_id is None:
            return
        # Set ack deadline to 0 to make the message immediately re-deliverable.
        subscriber = self._get_subscriber()
        subscriber.modify_ack_deadline(
            request={
                "subscription": self._subscription_path(),
                "ack_ids": [ack_id],
                "ack_deadline_seconds": 0,
            }
        )
