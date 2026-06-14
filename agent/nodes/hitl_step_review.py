from __future__ import annotations

import structlog
from langgraph.types import interrupt
from agent.graph.state import AgentState
from agentcore.plugins import get_collector

log = structlog.get_logger()

_APPROVALS = {"yes", "y", "approve", "approved", "ok", "okay", "proceed", "sure", "go", "go ahead"}
_REJECTIONS = {"no", "n", "reject", "rejected", "cancel", "stop", "abort"}


async def hitl_step_review(state: AgentState, config=None) -> dict:
    thought = state.get("current_thought") or {}
    signal = thought.get("signal")
    phase = state.get("phase", "analysis")
    step_number = len(state.get("step_history") or []) + 1
    auto_approve: bool = (config or {}).get("configurable", {}).get("auto_approve", False)

    if signal == "ANALYSIS_DONE":
        payload = {
            "phase": phase,
            "step_number": step_number,
            "reasoning": thought.get("reasoning", ""),
            "proposed_action": None,
            "signal": "ANALYSIS_DONE",
            "message": "Analysis complete. Proceed to summary? (approve / reject)",
        }
    elif signal == "REMEDIATION_DONE":
        payload = {
            "phase": phase,
            "step_number": step_number,
            "reasoning": thought.get("reasoning", ""),
            "proposed_action": None,
            "signal": "REMEDIATION_DONE",
            "message": "Remediation complete. Generate final report? (approve / reject)",
        }
    else:
        payload = {
            "phase": phase,
            "step_number": step_number,
            "reasoning": thought.get("reasoning", ""),
            "proposed_action": {
                "tool": thought.get("tool_name"),
                "inputs": thought.get("inputs", {}),
            },
            "signal": None,
            "message": "Approve / Modify <feedback> / Reject",
        }

    log.info(
        "hitl_step_review.proposed",
        phase=payload["phase"],
        step=payload["step_number"],
        signal=payload.get("signal"),
        tool=thought.get("tool_name"),
        inputs=thought.get("inputs", {}),
        reasoning=thought.get("reasoning", ""),
        auto_approve=auto_approve,
    )

    if auto_approve:
        log.info("hitl_step_review.auto_approved", step=step_number, signal=signal)
        return {"hitl_response": "approve", "hitl_feedback": None}

    user_response: str = interrupt(payload)
    r = user_response.strip().lower()

    if r.startswith("modify"):
        feedback = user_response[len("modify"):].strip()
        return {"hitl_response": user_response, "hitl_feedback": feedback}

    # Plain text that isn't approve/reject → treat as modify feedback
    if r not in _APPROVALS and r not in _REJECTIONS:
        return {"hitl_response": user_response, "hitl_feedback": user_response.strip()}

    if r in _REJECTIONS:
        # Ship metrics now — report node won't run on escalation
        collector = get_collector(config or {})
        if collector:
            collector.record_hitl_outcome("reject")
            try:
                await collector.finish("escalated")
            except Exception:
                pass

    return {"hitl_response": user_response, "hitl_feedback": None}
