from __future__ import annotations

import os

import structlog
from langchain_core.messages import BaseMessage, SystemMessage, trim_messages
from langchain_core.runnables import RunnableConfig

from agent.graph.state import AgentState

log = structlog.get_logger()

_SUMMARISE_THRESHOLD = 0.20  # summarise when >20% of messages are evicted


def _count_tokens(messages: list[BaseMessage]) -> int:
    """Rough token estimate (~4 chars per token). Avoids API calls during context checks."""
    return sum(len(str(m.content)) for m in messages) // 4


async def _summarise_evicted(config: RunnableConfig, evicted: list[BaseMessage]) -> str:
    from langchain_core.messages import HumanMessage
    from agentcore.llm.config import LLMConfig

    llm_config: LLMConfig | None = config["configurable"].get("llm_config")
    if not llm_config:
        return "Earlier conversation omitted due to context window limits."

    lines = "\n".join(
        f"{m.type}: {m.content}" for m in evicted if hasattr(m, "content")
    )
    prompt = HumanMessage(
        content=(
            "Summarise the following conversation history in 2-3 sentences, "
            "preserving key facts, decisions, and named entities:\n\n" + lines
        )
    )
    response = await llm_config.default_llm.ainvoke([prompt])
    return str(response.content)


async def manage_context(state: AgentState, config: RunnableConfig) -> dict:
    """First node in the graph. Trims messages to CONTEXT_MAX_TOKENS.

    If more than 20% of messages are evicted, the oldest messages are replaced
    with a short LLM-generated summary to preserve continuity.
    """
    messages: list[BaseMessage] = state.get("messages") or []
    if len(messages) < 2:
        return {}

    max_tokens = int(os.environ.get("CONTEXT_MAX_TOKENS", "8000"))

    trimmed = trim_messages(
        messages,
        max_tokens=max_tokens,
        token_counter=_count_tokens,
        strategy="last",
        include_system=True,
        allow_partial=False,
    )

    if len(trimmed) == len(messages):
        return {}  # within budget — no state change

    evicted_count = len(messages) - len(trimmed)
    log.info(
        "manage_context.trimmed",
        total=len(messages),
        kept=len(trimmed),
        evicted=evicted_count,
    )

    if evicted_count / len(messages) > _SUMMARISE_THRESHOLD:
        trimmed_ids = {id(m) for m in trimmed}
        evicted = [m for m in messages if id(m) not in trimmed_ids]
        summary_text = await _summarise_evicted(config, evicted)
        summary_msg = SystemMessage(content=f"[Earlier context summary: {summary_text}]")
        return {"messages": [summary_msg] + trimmed}

    return {"messages": trimmed}
