"""Unit tests for ContextManager plugin (agentcore.plugins)."""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from agentcore.plugins import ContextManager
from agentcore.plugins.context_manager import _count_tokens

_cm = ContextManager()


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
# ContextManager — no-op cases
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_manage_context_no_messages_returns_empty():
    result = await _cm({"messages": []}, config={})
    assert result == {}


@pytest.mark.asyncio
async def test_manage_context_single_message_returns_empty():
    result = await _cm({"messages": [HumanMessage(content="hi")]}, config={})
    assert result == {}


@pytest.mark.asyncio
async def test_manage_context_within_budget_returns_empty():
    msgs = [HumanMessage(content="hello"), AIMessage(content="world")]
    cm = ContextManager(max_tokens=8000)
    result = await cm({"messages": msgs}, config={})
    assert result == {}


# ---------------------------------------------------------------------------
# ContextManager — trimming without summarisation (<= 20% evicted)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_manage_context_trims_when_over_budget_minor():
    msgs = [HumanMessage(content="x" * 400) for _ in range(10)]
    cm = ContextManager(max_tokens=900)
    result = await cm({"messages": msgs}, config={})

    assert "messages" in result
    assert len(result["messages"]) < 10
    assert not isinstance(result["messages"][0], SystemMessage)


# ---------------------------------------------------------------------------
# ContextManager — summarisation when > 20% evicted
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_manage_context_summarises_when_many_evicted():
    msgs = [HumanMessage(content="x" * 400) for _ in range(10)]

    fake_llm = AsyncMock()
    fake_llm.ainvoke = AsyncMock(return_value=MagicMock(content="Summary of earlier conversation."))
    fake_llm_config = MagicMock()
    fake_llm_config.default_llm = fake_llm

    config = {"configurable": {"llm_config": fake_llm_config}}
    cm = ContextManager(max_tokens=500)
    result = await cm({"messages": msgs}, config=config)

    assert "messages" in result
    assert isinstance(result["messages"][0], SystemMessage)
    assert "Summary" in result["messages"][0].content


@pytest.mark.asyncio
async def test_manage_context_summarises_without_llm_config_uses_fallback():
    msgs = [HumanMessage(content="x" * 400) for _ in range(10)]
    config = {"configurable": {}}

    cm = ContextManager(max_tokens=500)
    result = await cm({"messages": msgs}, config=config)

    assert "messages" in result
    first = result["messages"][0]
    assert isinstance(first, SystemMessage)
    assert "omitted" in first.content


# ---------------------------------------------------------------------------
# ContextManager — system message preserved
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_manage_context_preserves_system_message():
    sys_msg = SystemMessage(content="You are a helpful assistant.")
    msgs = [sys_msg] + [HumanMessage(content="x" * 300) for _ in range(9)]

    cm = ContextManager(max_tokens=500)
    result = await cm({"messages": msgs}, config={"configurable": {}})

    kept = result.get("messages", msgs)
    system_msgs = [m for m in kept if isinstance(m, SystemMessage)]
    assert len(system_msgs) >= 1
