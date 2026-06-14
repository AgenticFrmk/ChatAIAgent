from __future__ import annotations

import structlog
from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig

from agent.graph.state import AgentState
from worker_agent.llm import LLMConfig
from agentcore.plugins import get_ragas_collector
from worker_agent.registry.base import Playbook, RegistryProvider, ToolContract
from worker_agent.schemas.react import Thought

log = structlog.get_logger()


async def _build_prompt(
    state: AgentState, registry: RegistryProvider
) -> tuple[str, list[ToolContract], "Playbook | None"]:
    intent = state.get("intent")
    domain = intent.domain if intent else None
    phase = state.get("phase") or "analysis"
    step_history = state.get("step_history") or []
    analysis_findings = state.get("analysis_findings") or []
    hitl_feedback = state.get("hitl_feedback")

    user_message = next(
        (m.content for m in reversed(state["messages"]) if getattr(m, "type", "") == "human"),
        "",
    )

    tools, playbook, intents, rag_chunks = await _fetch_context(registry, domain, user_message)

    # Filter to intent's tool_hints when present — search_tools already ranked by relevance.
    if intent and intents:
        matched = next((i for i in intents if i.action == intent.action), None)
        if matched and matched.tool_hints:
            hint_set = set(matched.tool_hints)
            tools = [t for t in tools if t.name in hint_set]

    tool_block = (
        "\n".join(
            f"  {t.name}({t.input_signature})"
            for t in tools
        )
        if tools
        else "  (no tools registered)"
    )

    already_called = {s["tool_name"] for s in step_history}

    parts = [
        f"You are a ReAct agent investigating: {intent.action if intent else 'unknown'} "
        f"in domain: {domain or 'unknown'}.",
        (
            "You are in the ANALYSIS phase. Call tools to gather evidence, then set "
            "signal=ANALYSIS_DONE once you have enough findings to explain the root cause."
            if phase == "analysis"
            else
            "You are in the REMEDIATION phase. Call tools to apply fixes, then set "
            "signal=REMEDIATION_DONE once all fixes are applied."
        ),
        (
            "The user's request is in the conversation messages below. "
            "Derive all tool inputs from the conversation, prior tool outputs, "
            "and the sourcing rules in the tool signatures:\n"
            "  - 'discover by calling X': call X first, extract from its output.\n"
            "  - 'always VALUE' or 'do not ask user': use that constant as-is.\n"
            "  - Anything else: read it from the user's message."
        ),
    ]

    if rag_chunks:
        parts.append(
            "Reference material (from knowledge base — use to inform reasoning):\n"
            + "\n\n".join(f"  [{i+1}] {chunk}" for i, chunk in enumerate(rag_chunks))
        )

    parts.append(f"Available tools:\n{tool_block}")

    if playbook:
        hints = _extract_tool_hints(playbook)
        if hints:
            remaining = [h for h in hints if h not in already_called]
            parts.append(
                "Recommended tool sequence (from playbook):\n"
                + "\n".join(f"  - {h}" for h in hints)
                + (f"\n\nAlready called: {', '.join(sorted(already_called))}" if already_called else "")
                + (f"\nStill to call: {', '.join(remaining)}" if remaining else
                   "\nAll recommended tools have been called — emit ANALYSIS_DONE.")
            )

    if step_history:
        lines = [
            f"  Step {s['step_number']}: {s['tool_name']}({s['inputs']}) → {s['finding']}"
            for s in step_history
        ]
        parts.append("Steps taken so far:\n" + "\n".join(lines))
        parts.append(
            f"IMPORTANT: You have already called: {', '.join(sorted(already_called))}. "
            "Do NOT call a tool you have already called with the same inputs — you already have that data. "
            "Either call a different tool or emit the completion signal."
        )

    if analysis_findings:
        parts.append(
            "Analysis findings:\n"
            + "\n".join(f"  {i+1}. {f}" for i, f in enumerate(analysis_findings))
        )

    if hitl_feedback:
        parts.append(
            f"Human feedback on your last proposal: {hitl_feedback}\n"
            "Revise your next thought accordingly."
        )

    parts.append(
        "Produce a Thought with: reasoning (why this tool), tool_name, and inputs. "
        "IMPORTANT: tool_name must be exactly ONE tool name — never a comma-separated list. "
        "Call tools one at a time; the graph will loop back for subsequent calls. "
        "OR set signal=ANALYSIS_DONE (analysis phase complete) / REMEDIATION_DONE (all fixes applied) "
        "with reasoning explaining what was found/done, and leave tool_name empty."
    )
    return "\n\n".join(parts), tools, playbook


async def _fetch_context(registry: RegistryProvider, domain: str | None, user_message: str):
    import asyncio
    # k=50 ensures completeness for any realistic domain size while still ranking
    # by query relevance — replaces the separate list_tools call.
    tool_rag_task = registry.search_tools(user_message, domain=domain, k=50) if domain else None
    playbook_task = registry.get_playbook(domain) if domain else None
    intents_task  = registry.get_intents(domain) if domain else None
    rag_task      = registry.retrieve_rag_context(domain, user_message) if domain else None
    tasks = [t for t in [tool_rag_task, playbook_task, intents_task, rag_task] if t is not None]
    results = await asyncio.gather(*tasks)
    idx = iter(results)
    tools      = next(idx) if tool_rag_task else []
    playbook   = next(idx) if playbook_task else None
    intents    = next(idx) if intents_task  else []
    rag_chunks = next(idx) if rag_task      else []
    return tools, playbook, intents, rag_chunks


def _extract_tool_hints(playbook) -> list[str]:
    seen: set[str] = set()
    result = []
    for rule in (playbook.rules or []):
        for tool in (getattr(rule, "tools", None) or []):
            if tool not in seen:
                seen.add(tool)
                result.append(tool)
    return result


def _build_context_chunks(
    tools: list[ToolContract],
    playbook: Playbook | None,
) -> list[str]:
    chunks = [f"{t.name}: {t.output_description}" for t in (tools or [])]
    if playbook:
        for rule in (playbook.rules or []):
            chunks.append(f"{rule.id}: {rule.description}")
    return chunks



async def think(state: AgentState, config: RunnableConfig) -> dict:
    llm_config: LLMConfig = config["configurable"]["llm_config"]
    registry: RegistryProvider = config["configurable"]["registry"]
    ragas = get_ragas_collector(config)

    phase = state.get("phase") or "analysis"
    system, tools, playbook = await _build_prompt(state, registry)

    if ragas:
        intent = state.get("intent")
        ragas.record_rag_context(
            question=intent.action if intent else "",
            contexts=_build_context_chunks(tools, playbook),
        )

    structured_llm = llm_config.default_llm.with_structured_output(Thought)
    messages = [SystemMessage(content=system)] + list(state["messages"])

    thought: Thought = await structured_llm.ainvoke(messages)
    step_num = len(state.get("step_history") or []) + 1
    log.info("think.produced", phase=phase, signal=thought.signal, tool=thought.tool_name, step=step_num)

    return {
        "phase": phase,
        "current_thought": thought.model_dump(),
        "hitl_feedback": None,
    }
