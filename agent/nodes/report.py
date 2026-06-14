from __future__ import annotations

import os
import uuid
import structlog
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig

from agent.graph.state import AgentState
from worker_agent.llm import LLMConfig
from agentcore.plugins import get_collector, get_ragas_collector, DistillationPlugin

log = structlog.get_logger()

_distillation = DistillationPlugin(
    registry_url=os.environ.get("REGISTRY_SERVICE_URL", ""),
    push_token=os.environ.get("REGISTRY_PUSH_TOKEN", ""),
    auth_url=os.environ.get("REGISTRY_AUTH_URL", ""),
    username=os.environ.get("REGISTRY_USERNAME", ""),
    password=os.environ.get("REGISTRY_PASSWORD", ""),
)


async def report(state: AgentState, config: RunnableConfig) -> dict:
    llm_config: LLMConfig = config["configurable"]["llm_config"]
    step_history = state.get("step_history") or []
    analysis_findings = state.get("analysis_findings") or []
    remediation_plan = state.get("remediation_plan") or ""
    intent = state.get("intent")

    findings_block = "\n".join(f"  {i+1}. {f}" for i, f in enumerate(analysis_findings)) or "  (none)"
    steps_block = "\n".join(
        f"  Step {s['step_number']}: {s['tool_name']} → {s['finding']}"
        for s in step_history
    ) or "  (none)"

    system = "You are generating a concise SRE incident investigation report."
    human = (
        f"Generate a report for: {intent.action if intent else 'investigation'}\n\n"
        f"Analysis findings:\n{findings_block}\n\n"
        f"Steps executed:\n{steps_block}\n\n"
        f"Proposed remediation:\n{remediation_plan or '  (none yet — pending approval)'}\n\n"
        "Write a 3-5 sentence summary covering only: what the root cause is and what evidence was gathered. "
        "Do NOT mention remediation status, whether steps were applied, or the current state of the system. "
        "End the report after describing the root cause and evidence."
    )
    msg = await llm_config.default_llm.ainvoke([SystemMessage(content=system), HumanMessage(content=human)])
    report_text = msg.content if hasattr(msg, "content") else str(msg)

    log.info("report.generated", intent=intent.action if intent else "unknown")

    ragas = get_ragas_collector(config)
    if ragas:
        step_findings = [
            f"Step {s['step_number']} ({s['tool_name']}): {s['finding']}"
            for s in step_history
        ]
        ragas.record_evidence(step_findings)
        ragas.record_final_answer(report_text)

    plan_id = uuid.uuid4()
    await _save_plan_history(state, config, plan_id)

    pushed = await _distillation.push(state, plan_id)
    collector = get_collector(config)
    if collector is not None:
        collector.record_distillation_outcome(pushed)
        try:
            await collector.finish("resolved")
        except Exception:
            log.warning("report.metrics_finish.failed", exc_info=True)

    return {"report": report_text}


async def _save_plan_history(
    state: AgentState, config: RunnableConfig, plan_id: uuid.UUID
) -> None:
    db_session_factory = config.get("configurable", {}).get("db_session_factory")
    if db_session_factory is None:
        return

    intent = state.get("intent")
    if intent is None:
        return

    auth = config.get("configurable", {}).get("auth") or {}
    intent_text = next(
        (str(m.content) for m in state.get("messages", []) if isinstance(m, HumanMessage)),
        "",
    )
    step_history = state.get("step_history") or []

    plan_steps = [
        {"id": f"s{s['step_number']}", "name": s["tool_name"],
         "tool_name": s["tool_name"], "dependencies": []}
        for s in step_history
    ]
    tool_results = {
        f"s{s['step_number']}": {"status": "completed", "finding": s.get("finding", "")}
        for s in step_history
    }

    try:
        from worker_agent.persistence import plan_history_repo
        async with db_session_factory() as session:
            await plan_history_repo.save(
                session=session,
                plan_id=plan_id,
                action=intent.action,
                domain=intent.domain,
                intent_text=intent_text,
                entities={},
                steps=plan_steps,
                tool_results=tool_results,
                outcome="COMPLETED",
                tenant_id=auth.get("tenant_id"),
                user_id=auth.get("user_id"),
            )
            await session.commit()
    except Exception:
        log.warning("plan_history.save.failed", exc_info=True)
