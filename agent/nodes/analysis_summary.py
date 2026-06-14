from __future__ import annotations

from langgraph.types import interrupt
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig

from agent.graph.state import AgentState
from agentcore.llm.config import LLMConfig

_APPROVALS = {"yes", "y", "approve", "approved", "ok", "okay", "proceed", "sure"}


async def analysis_summary(state: AgentState, config: RunnableConfig) -> dict:
    llm_config: LLMConfig = config["configurable"]["llm_config"]
    findings = state.get("analysis_findings") or []

    findings_block = (
        "\n".join(f"{i+1}. {f}" for i, f in enumerate(findings))
        or "(no findings recorded)"
    )
    system = "You are summarizing a diagnostic investigation."
    human = (
        "Given the findings below, synthesize a clear root cause analysis in 2-3 sentences.\n\n"
        f"Findings:\n{findings_block}"
    )
    msg = await llm_config.default_llm.ainvoke([SystemMessage(content=system), HumanMessage(content=human)])
    summary = msg.content if hasattr(msg, "content") else str(msg)

    user_response: str = interrupt({
        "summary": summary,
        "findings": findings,
        "message": "I found the issue above. Do you want me to propose a fix? (yes / no)",
    })

    return {"hitl_response": user_response}
