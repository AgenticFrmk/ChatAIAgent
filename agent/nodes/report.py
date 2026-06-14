from __future__ import annotations

import os
import uuid
import structlog
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig

from agent.graph.state import AgentState
from agentcore.llm.config import LLMConfig
from agentcore.observability.metrics import get_collector
from agentcore.observability.ragas import get_ragas_collector

log = structlog.get_logger()


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

    system = "You are generating a concise incident resolution report."
    human = (
        f"Generate a report for: {intent.action if intent else 'investigation'}\n\n"
        f"Analysis findings:\n{findings_block}\n\n"
        f"Steps executed:\n{steps_block}\n\n"
        f"Remediation applied:\n{remediation_plan or '  (none)'}\n\n"
        "Write a 3-5 sentence summary covering: root cause, actions taken, and outcome."
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
    pushed = await _push_to_distillation(state, config, plan_id)
    collector = get_collector(config)
    if collector is not None:
        collector.record_distillation_outcome(pushed)
    await _finish_metrics(state, config)

    return {"report": report_text}


async def _finish_metrics(state: AgentState, config: RunnableConfig) -> None:
    collector = get_collector(config)
    if collector is None:
        return
    try:
        # report node is only reached on REMEDIATION_DONE — the run always resolved
        await collector.finish("resolved")
    except Exception:
        log.warning("metrics_collector.finish.failed", exc_info=True)


async def _save_plan_history(
    state: AgentState, config: RunnableConfig, plan_id: "uuid.UUID"
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
    entities = {}

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
        from agent.persistence import plan_history_repo

        async with db_session_factory() as session:
            await plan_history_repo.save(
                session=session,
                plan_id=plan_id,
                action=intent.action,
                domain=intent.domain,
                intent_text=intent_text,
                entities=entities,
                steps=plan_steps,
                tool_results=tool_results,
                outcome="COMPLETED",
                tenant_id=auth.get("tenant_id"),
                user_id=auth.get("user_id"),
            )
            await session.commit()
    except Exception:
        log.warning("plan_history.save.failed", exc_info=True)


async def _push_to_distillation(
    state: AgentState, config: RunnableConfig, plan_id: "uuid.UUID"
) -> bool:
    registry_url = os.environ.get("REGISTRY_SERVICE_URL", "")
    if not registry_url:
        log.warning("distillation.push.skipped", reason="REGISTRY_SERVICE_URL not set")
        return False

    # TODO: replace user-credential fallback with a dedicated service token
    # (machine-to-machine OAuth2 client_credentials grant or a long-lived API key
    # issued to agentbe by AuthService) so distillation pushes are not tied to a
    # human user account.
    push_token = os.environ.get("REGISTRY_PUSH_TOKEN", "")
    if not push_token:
        auth_url  = os.environ.get("REGISTRY_AUTH_URL", "")
        username  = os.environ.get("REGISTRY_USERNAME", "")
        password  = os.environ.get("REGISTRY_PASSWORD", "")
        if not (auth_url and username and password):
            log.warning("distillation.push.skipped", reason="no auth credentials configured")
            return False
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as _ac:
                _r = await _ac.post(
                    f"{auth_url.rstrip('/')}/auth/token",
                    data={"username": username, "password": password},
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
                _r.raise_for_status()
                push_token = _r.json()["access_token"]
        except Exception:
            log.warning("distillation.push.auth_failed", exc_info=True)
            return False

    intent = state.get("intent")
    if intent is None:
        return False

    intent_text = next(
        (str(m.content) for m in state.get("messages", []) if isinstance(m, HumanMessage)),
        "",
    )
    step_history = state.get("step_history") or []
    tool_results = {
        f"s{s['step_number']}": {"status": "completed", "finding": s.get("finding", "")}
        for s in step_history
    }
    payload = {
        "rows": [{
            "plan_id": str(plan_id),
            "action": intent.action,
            "domain": intent.domain,
            "intent_summary": intent_text,
            "steps": [
                {
                    "step_number": s["step_number"],
                    "tool_name":   s["tool_name"],
                    "reasoning":   s.get("reasoning", ""),
                    "inputs":      s.get("inputs", {}),
                    "tool_output": s.get("tool_output", ""),
                    "finding":     s["finding"],
                }
                for s in step_history
            ],
            "tool_results": tool_results,
            "outcome": "COMPLETED",
            "schema_version_pin": (state.get("schema_version_pin") or {}).get(intent.domain),
            "playbook_version_pin": (state.get("playbook_version_pin") or {}).get(intent.domain),
        }]
    }

    try:
        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{registry_url.rstrip('/')}/distillation/trajectories/import",
                json=payload,
                headers={"Authorization": f"Bearer {push_token}"},
            )
            if resp.status_code not in (200, 201):
                log.warning(
                    "distillation.push.non2xx",
                    status=resp.status_code,
                    body=resp.text[:200],
                )
                return False
            log.info("distillation.push.ok", plan_id=str(plan_id), status=resp.status_code)
            return True
    except Exception:
        log.warning("distillation.push.failed", exc_info=True)
        return False
