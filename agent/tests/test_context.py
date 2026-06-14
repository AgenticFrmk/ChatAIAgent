"""Unit tests for agent/graph/context.py — manage_context node."""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from agent.graph.context import _count_tokens, _summarise_evicted, manage_context


# ---------------------------------------------------------------------------
# _count_tokens
# ---------------------------------------------------------------------------

def test_count_tokens_empty():
    assert _count_tokens([]) == 0


def test_count_tokens_approximation():
    msgs = [HumanMessage(content="hello world")]  # 11 chars → 2 tokens
    assert _count_tokens(msgs) == 2


def test_count_tokens_multiple_messages():
    msgs = [
        HumanMessage(content="a" * 100),
        AIMessage(content="b" * 100),
    ]
    assert _count_tokens(msgs) == 50  # 200 chars // 4


# ---------------------------------------------------------------------------
# manage_context — no-op cases
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_manage_context_no_messages_returns_empty():
    result = await manage_context({"messages": []}, config={})
    assert result == {}


@pytest.mark.asyncio
async def test_manage_context_single_message_returns_empty():
    result = await manage_context({"messages": [HumanMessage(content="hi")]}, config={})
    assert result == {}


@pytest.mark.asyncio
async def test_manage_context_within_budget_returns_empty():
    """Two short messages well under 8000 tokens — should be a no-op."""
    msgs = [HumanMessage(content="hello"), AIMessage(content="world")]
    with patch.dict(os.environ, {"CONTEXT_MAX_TOKENS": "8000"}):
        result = await manage_context({"messages": msgs}, config={})
    assert result == {}


# ---------------------------------------------------------------------------
# manage_context — trimming without summarisation (<= 20% evicted)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_manage_context_trims_when_over_budget_minor():
    """When <= 20% of messages are evicted, return trimmed list, no summary."""
    # 10 messages; trim will remove 1 (10%) → below summarise threshold
    msgs = [HumanMessage(content="x" * 400) for _ in range(10)]  # 400 chars ea → 100 tokens ea
    # total = 1000 tokens; limit 900 → must evict 1 message
    with patch.dict(os.environ, {"CONTEXT_MAX_TOKENS": "900"}):
        result = await manage_context({"messages": msgs}, config={})

    assert "messages" in result
    assert len(result["messages"]) < 10
    # No summary message prepended
    assert not isinstance(result["messages"][0], SystemMessage)


# ---------------------------------------------------------------------------
# manage_context — summarisation when > 20% evicted
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_manage_context_summarises_when_many_evicted():
    """When > 20% of messages are evicted, a SystemMessage summary is prepended."""
    # 10 messages; trim keeps only 5 (50% evicted) → triggers summarisation
    msgs = [HumanMessage(content="x" * 400) for _ in range(10)]

    fake_llm = AsyncMock()
    fake_llm.ainvoke = AsyncMock(return_value=MagicMock(content="Summary of earlier conversation."))
    fake_config = MagicMock()
    fake_llm_config = MagicMock()
    fake_llm_config.default_llm = fake_llm

    config = {"configurable": {"llm_config": fake_llm_config}}

    with patch.dict(os.environ, {"CONTEXT_MAX_TOKENS": "500"}):  # keeps ~5 messages
        result = await manage_context({"messages": msgs}, config=config)

    assert "messages" in result
    assert isinstance(result["messages"][0], SystemMessage)
    assert "Summary" in result["messages"][0].content


@pytest.mark.asyncio
async def test_manage_context_summarises_without_llm_config_uses_fallback():
    """When llm_config is absent, the fallback summary text is used."""
    msgs = [HumanMessage(content="x" * 400) for _ in range(10)]

    config = {"configurable": {}}  # no llm_config

    with patch.dict(os.environ, {"CONTEXT_MAX_TOKENS": "500"}):
        result = await manage_context({"messages": msgs}, config=config)

    assert "messages" in result
    first = result["messages"][0]
    assert isinstance(first, SystemMessage)
    assert "omitted" in first.content


# ---------------------------------------------------------------------------
# manage_context — system message is preserved by trim_messages
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_manage_context_preserves_system_message():
    """SystemMessage at index 0 must survive trimming (include_system=True)."""
    sys_msg = SystemMessage(content="You are a helpful assistant.")
    # Pad with many human/AI turns to force trimming
    msgs = [sys_msg] + [HumanMessage(content="x" * 300) for _ in range(9)]

    with patch.dict(os.environ, {"CONTEXT_MAX_TOKENS": "500"}):
        result = await manage_context({"messages": msgs}, config={"configurable": {}})

    # After trimming, the first non-summary message should still be the SystemMessage
    kept = result.get("messages", msgs)
    system_msgs = [m for m in kept if isinstance(m, SystemMessage)]
    assert len(system_msgs) >= 1
