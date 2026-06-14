from __future__ import annotations

from langgraph.types import interrupt
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig

from agent.graph.state import AgentState
from agentcore.llm.config import LLMConfig
from agentcore.observability.metrics import get_collector
from agentcore.observability.ragas import get_ragas_collector

_APPROVALS = {"yes", "y", "approve", "approved", "ok", "okay", "proceed", "sure"}
_REJECTIONS = {"no", "n", "reject", "rejected", "cancel", "stop", "abort"}


async def propose_fix(state: AgentState, config: RunnableConfig) -> dict:
    llm_config: LLMConfig = config["configurable"]["llm_config"]
    findings = state.get("analysis_findings") or []
    hitl_feedback = state.get("hitl_feedback")
    cache_hit = state.get("plan_cache_hit")

    if cache_hit and not hitl_feedback:
        # Cache hit — skip LLM call, present stored plan directly
        fix_text = state.get("cached_plan_proposal") or "(cached plan unavailable)"
    else:
        findings_block = (
            "\n".join(f"{i+1}. {f}" for i, f in enumerate(findings))
            or "(no findings)"
        )
        system = "You are proposing a remediation plan based on analysis findings."
        human = (
            "Create a numbered list of concrete fix steps based on the analysis findings below.\n\n"
            f"Analysis findings:\n{findings_block}"
        )
        if hitl_feedback:
            human += f"\n\nHuman feedback on previous proposal: {hitl_feedback}\nRevise accordingly."

        msg = await llm_config.default_llm.ainvoke([SystemMessage(content=system), HumanMessage(content=human)])
        fix_text = msg.content if hasattr(msg, "content") else str(msg)

    ragas = get_ragas_collector(config)
    if ragas:
        ragas.record_final_answer(fix_text)

    user_response: str = interrupt({
        "fix_proposal": fix_text,
        "based_on_findings": findings,
        "cache_hit": bool(cache_hit),
        "message": "Proposed fix above. Approve / Modify <feedback> / Reject",
    })

    r = user_response.strip().lower()

    if r in _APPROVALS:
        hitl_key = "approve"
    elif r in _REJECTIONS:
        hitl_key = "reject"
    else:
        hitl_key = "modify"
    collector = get_collector(config)
    if collector:
        collector.record_hitl_outcome(hitl_key)

    if hitl_key == "modify" or r.startswith("modify"):
        feedback = user_response[len("modify"):].strip() if r.startswith("modify") else user_response.strip()
        return {"hitl_response": user_response, "hitl_feedback": feedback, "remediation_plan": fix_text,
                "plan_cache_hit": False, "cached_plan_proposal": None}

    if hitl_key == "approve":
        return {"hitl_response": user_response, "hitl_feedback": None, "remediation_plan": fix_text, "phase": "remediation"}

    # Rejected — if this was a cache hit, fall back to full analysis rather than ending
    if cache_hit:
        return {
            "hitl_response": user_response,
            "hitl_feedback": None,
            "remediation_plan": fix_text,
            "plan_cache_hit": False,
            "cached_plan_proposal": None,
            "phase": "analysis",
        }

    # Normal rejection — ship metrics and end
    if collector:
        try:
            await collector.finish("escalated")
        except Exception:
            pass
    return {"hitl_response": user_response, "hitl_feedback": None, "remediation_plan": fix_text}
