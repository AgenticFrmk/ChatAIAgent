from agent.graph.state import AgentState

_APPROVALS = {"yes", "y", "approve", "approved", "ok", "okay", "proceed", "sure", "go", "go ahead"}
_REJECTIONS = {"no", "n", "reject", "rejected", "cancel", "stop", "abort"}


def route_intent(state: AgentState) -> str:
    intent = state.get("intent")
    if intent is None:
        return "end"
    if (intent.ambiguous or intent.confidence < 0.7) and state.get("clarification_attempts", 0) < 2:
        return "clarify"
    return "check_plan_cache"


def route_cache(state: AgentState) -> str:
    """After check_plan_cache: hit → propose_fix, miss → think."""
    return "propose_fix" if state.get("plan_cache_hit") else "think"


def route_hitl_step_review(state: AgentState) -> str:
    thought = state.get("current_thought") or {}
    signal = thought.get("signal")
    feedback = state.get("hitl_feedback")
    response = (state.get("hitl_response") or "").strip().lower()

    # Modify — loop back to think with feedback
    if feedback:
        return "think"
    # Reject
    if response in _REJECTIONS:
        return "end"
    # Approve — route by signal
    if signal == "ANALYSIS_DONE":
        return "analysis_summary"
    if signal == "REMEDIATION_DONE":
        return "report"
    return "act"


def route_analysis_summary(state: AgentState) -> str:
    response = (state.get("hitl_response") or "").strip().lower()
    if response in _APPROVALS:
        return "propose_fix"
    return "end"


def route_propose_fix(state: AgentState) -> str:
    feedback = state.get("hitl_feedback")
    response = (state.get("hitl_response") or "").strip().lower()
    if feedback:
        return "propose_fix"
    if response in _REJECTIONS:
        # propose_fix sets plan_cache_hit=False (explicit False, not None) on cache rejection
        # so the SRE can start full analysis. None means it was never a cache hit → end.
        return "think" if state.get("plan_cache_hit") is False else "end"
    return "think"
