import os
from worker_agent.dispatch.base import DispatchAdapter


def create_adapter(**kwargs) -> DispatchAdapter:
    adapter_type = os.getenv("DISPATCH_ADAPTER", "postgres")
    if adapter_type == "postgres":
        from worker_agent.dispatch.postgres import PostgresDispatchAdapter
        return PostgresDispatchAdapter(db_url=os.environ["DATABASE_URL"], **kwargs)
    elif adapter_type == "sqs":
        from worker_agent.dispatch.sqs import SQSDispatchAdapter
        return SQSDispatchAdapter(queue_url=os.environ["SQS_QUEUE_URL"], **kwargs)
    elif adapter_type == "pubsub":
        from worker_agent.dispatch.pubsub import PubSubDispatchAdapter
        return PubSubDispatchAdapter(
            project=os.environ["GCP_PROJECT"],
            topic=os.environ["PUBSUB_TOPIC"],
            subscription=os.environ["PUBSUB_SUBSCRIPTION"],
            **kwargs,
        )
    else:
        raise ValueError(f"Unknown DISPATCH_ADAPTER: {adapter_type!r}")
