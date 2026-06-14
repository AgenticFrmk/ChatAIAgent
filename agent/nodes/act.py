from __future__ import annotations

import os

import structlog
from langchain_core.runnables import RunnableConfig

from agent.graph.state import AgentState

log = structlog.get_logger()

_OPA_URL = os.environ.get("OPA_URL", "http://opa:8181")


async def _check_tool_policy(tool_name: str, inputs: dict, auth: dict) -> str:
    """Query OPA for a per-call tool decision. Fail-open on any error."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=1.0) as client:
            resp = await client.post(
                f"{_OPA_URL}/v1/data/policy/tool/tool_decision",
                json={
                    "input": {
                        "tool_name": tool_name,
                        "tool_args": inputs,
                        "user_id": auth.get("user_id", ""),
                        "tenant_id": auth.get("tenant_id", ""),
                    }
                },
            )
            if resp.status_code == 200:
                return resp.json().get("result", "allow")
    except Exception as exc:
        log.warning("act.opa_check.fail_open", tool=tool_name, error=str(exc))
    return "allow"


async def act(state: AgentState, config: RunnableConfig) -> dict:
    thought = state.get("current_thought") or {}
    tool_name = thought.get("tool_name", "")
    inputs = thought.get("inputs", {})
    auth: dict = config.get("configurable", {}).get("auth") or {}

    dispatcher = config.get("configurable", {}).get("tool_dispatcher")
    if dispatcher is None:
        log.warning("act.no_dispatcher", tool=tool_name)
        return {"last_act_result": {"status": "failed", "output": None, "error": "no dispatcher configured"}}

    decision = await _check_tool_policy(tool_name, inputs, auth)
    if decision == "block":
        log.warning("act.tool_blocked", tool=tool_name, user_id=auth.get("user_id"))
        return {"last_act_result": {"status": "blocked", "output": None, "error": f"Tool '{tool_name}' is blocked by policy"}}

    if decision == "require_approval":
        log.info("act.tool_approval_required", tool=tool_name)
        from langgraph.types import interrupt
        interrupt({"reason": "policy_approval_required", "tool_name": tool_name, "inputs": inputs})

    try:
        output, api_url = await dispatcher.dispatch_with_url(tool_name, inputs)
        log.info("act.completed", tool=tool_name)
        return {"last_act_result": {"status": "completed", "output": output, "api_url": api_url}}
    except Exception as exc:
        log.error("act.failed", tool=tool_name, error=str(exc))
        return {"last_act_result": {"status": "failed", "output": None, "error": str(exc)}}
