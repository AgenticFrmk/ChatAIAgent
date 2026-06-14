import operator
from typing import Annotated
from typing_extensions import TypedDict
from langchain_core.messages import BaseMessage
from agent.schemas.intent import Intent


class AgentState(TypedDict):
    # ── Core ──────────────────────────────────────────────────────────────────
    messages: list[BaseMessage]
    intent: Intent | None
    clarification_attempts: int
    report: str | None
    playbook_version_pin: dict[str, str]  # domain → pinned version ("" = no playbook)

    # ── Plan cache ────────────────────────────────────────────────────────────
    plan_cache_hit: bool | None          # True when propose_fix is serving a cached plan
    cached_plan_proposal: str | None     # pre-formatted plan text from plan_history.steps

    # ── HITL shared ───────────────────────────────────────────────────────────
    hitl_feedback: str | None   # modify feedback carried into think / propose_fix
    hitl_response: str | None   # raw user reply used by route functions

    # ── ReAct loop ────────────────────────────────────────────────────────────
    phase: str | None                                       # "analysis" | "remediation"
    current_thought: dict | None                            # serialized Thought
    step_history: Annotated[list[dict], operator.add]       # ThoughtActObserve records
    analysis_findings: Annotated[list[str], operator.add]   # one finding per observe cycle
    last_act_result: dict | None                            # raw output from act node
    remediation_plan: str | None                            # proposed fix text

    # ── Policy ────────────────────────────────────────────────────────────────
    policy_decision: str | None   # 'allow' | 'block' | 'require_approval' | None
    policy_step: dict | None      # step payload emitted to policy_review interrupt
