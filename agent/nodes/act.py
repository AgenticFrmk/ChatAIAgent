from __future__ import annotations

import os

import structlog
from langchain_core.runnables import RunnableConfig

from agent.graph.state import AgentState
from agentcore.plugins import PolicyGate

log = structlog.get_logger()

_policy_gate = PolicyGate(opa_url=os.environ.get("OPA_URL", "http://opa:8181"))


@_policy_gate
async def act(state: AgentState, config: RunnableConfig) -> dict:
    thought = state.get("current_thought") or {}
    tool_name = thought.get("tool_name", "")
    inputs = thought.get("inputs", {})

    dispatcher = config.get("configurable", {}).get("tool_dispatcher")
    if dispatcher is None:
        log.warning("act.no_dispatcher", tool=tool_name)
        return {"last_act_result": {"status": "failed", "output": None, "error": "no dispatcher configured"}}

    try:
        output, api_url = await dispatcher.dispatch_with_url(tool_name, inputs)
        log.info("act.completed", tool=tool_name)
        return {"last_act_result": {"status": "completed", "output": output, "api_url": api_url}}
    except Exception as exc:
        log.error("act.failed", tool=tool_name, error=str(exc))
        return {"last_act_result": {"status": "failed", "output": None, "error": str(exc)}}
