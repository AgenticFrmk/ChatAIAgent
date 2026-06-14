from __future__ import annotations

import structlog
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig

from agent.graph.state import AgentState
from agentcore.llm.config import LLMConfig

log = structlog.get_logger()


async def observe(state: AgentState, config: RunnableConfig) -> dict:
    llm_config: LLMConfig = config["configurable"]["llm_config"]
    thought = state.get("current_thought") or {}
    act_result = state.get("last_act_result") or {}
    step_history = state.get("step_history") or []

    tool_name = thought.get("tool_name", "unknown")
    raw_output = act_result.get("output") or act_result.get("error") or "(no output)"
    step_number = len(step_history) + 1

    system = (
        "You are an SRE analysis assistant. Summarise tool output into a single finding."
    )
    human = (
        f"Tool called: '{tool_name}'\n"
        f"Raw output:\n{raw_output}\n\n"
        "State the single most important finding from this output in one concise sentence. "
        "Be specific — include key values (status, IDs, metrics) that matter for the investigation."
    )
    msg = await llm_config.default_llm.ainvoke([SystemMessage(content=system), HumanMessage(content=human)])
    finding = msg.content if hasattr(msg, "content") else str(msg)

    tao = {
        "step_number": step_number,
        "reasoning": thought.get("reasoning", ""),
        "tool_name": tool_name,
        "inputs": thought.get("inputs", {}),
        "tool_output": str(raw_output),
        "finding": finding,
    }

    log.info("observe.finding", step=step_number, tool=tool_name, finding=finding[:80])

    updates: dict = {
        "step_history": [tao],
        "last_act_result": None,
    }
    if state.get("phase") == "analysis":
        updates["analysis_findings"] = [finding]
    return updates
