from __future__ import annotations

import json
import os
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path

from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from pydantic import ValidationError
from worker_agent.llm import LLMConfig
from worker_agent.registry.base import RegistryProvider, DomainRecord
from agent.schemas.intent import Intent
from agent.graph.state import AgentState


# ── DSPy-optimized few-shot examples (opt-in) ─────────────────────────────────

@lru_cache(maxsize=1)
def _load_optimized_examples() -> list[dict]:
    """
    Load few-shot examples produced by AgentEvals DSPy optimization.

    Activated by setting DSPY_INTENT_EXAMPLES_PATH to the path of
    optimized/intent_examples.json produced by:
      python optimize/run_optimization.py --suite intent

    Returns empty list when the env var is unset — no behaviour change.
    Cached after first load; restart process to reload new examples.
    """
    path_str = os.environ.get("DSPY_INTENT_EXAMPLES_PATH", "")
    if not path_str:
        return []
    path = Path(path_str)
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text()).get("examples", [])
    except Exception:
        return []


def _format_few_shot_examples(examples: list[dict]) -> str:
    """Format DSPy examples as prompt text injected after the domain list."""
    if not examples:
        return ""
    lines = ["\nExamples:"]
    for ex in examples:
        ambig_note = f" (ambiguous: {ex['ambiguity_reason']})" if ex.get("ambiguous") else ""
        lines.append(f'  Query: "{ex["query"]}"')
        lines.append(f'  → domain={ex["domain"]}, action={ex["action"]}{ambig_note}')
    return "\n".join(lines)


def _cosine_nearest(action: str, candidates: list[str]) -> tuple[str, float]:
    """Return (closest_candidate, similarity_score) using SequenceMatcher character-level ratio.

    Handles minor variations like pluralization, extra suffixes, and typos better
    than word-level Jaccard — sufficient to catch LLM hallucinations that are close
    but not identical to a registered intent name.
    """
    a = action.lower()
    best, best_score = candidates[0], 0.0
    for c in candidates:
        score = SequenceMatcher(None, a, c.lower()).ratio()
        if score > best_score:
            best, best_score = c, score
    return best, best_score


_RAG_DOMAIN_K = int(os.getenv("RAG_DOMAIN_K", "5"))


async def _build_intent_prompt(
    registry: RegistryProvider, user_message: str
) -> tuple[str, list[str], list]:
    """Returns (system_prompt, valid_domains, rag_results).

    domain_embeddings is the sole source — no relational fallback.
    """
    rag_results = await registry.search_domains(user_message, k=_RAG_DOMAIN_K)
    if not rag_results:
        raise RuntimeError("No domains found — seed domain_embeddings before running the agent")

    domain_lines = []
    for rec in rag_results:
        hint = rec.hint or rec.name
        intents_str = ", ".join(
            f"{i.action}: {i.description}" if i.description else i.action
            for i in rec.intents
        ) or "(no intents registered)"
        domain_lines.append(f"  {rec.name}: {hint}\n    valid intents: {intents_str}")
    valid_domains = [r.name for r in rag_results]
    hint_lines = "\n".join(domain_lines)

    examples_block = _format_few_shot_examples(_load_optimized_examples())
    prompt = "\n".join(filter(None, [
        "You are an intent classifier. Given the conversation, identify the user's primary action and domain.",
        f"Valid domains: {', '.join(valid_domains)}",
        "Domain descriptions and valid intents:",
        hint_lines,
        "domain MUST be one of the valid domains listed above.",
        "action MUST be one of the valid intents listed for the resolved domain.",
        "If the intent is unclear, set ambiguous=true and populate ambiguity_reason with a single sentence explaining what information is missing.",
        examples_block,
    ]))
    return prompt, valid_domains, rag_results


async def extract_intent(state: AgentState, config: RunnableConfig) -> dict:
    llm_config: LLMConfig = config["configurable"]["llm_config"]
    registry: RegistryProvider = config["configurable"]["registry"]

    # Resolve routing policy when SLM routing is enabled
    # Policy is fetched after intent is extracted (domain needed first),
    # so the first invocation always uses the general LLM.
    # The selected model is stored in state for the plan node to pick up.
    structured_llm = llm_config.default_llm.with_structured_output(Intent)

    user_message = next(
        (m.content for m in reversed(state["messages"]) if getattr(m, "type", "") == "human"),
        "",
    )
    system_prompt, _, rag_results = await _build_intent_prompt(registry, user_message)
    # Strip trailing AI messages — Claude 4.x rejects conversations ending with an
    # assistant message. The clarify node appends an AIMessage (the question) before
    # looping back here; intent classification only needs human turns.
    human_msgs = list(state["messages"])
    while human_msgs and getattr(human_msgs[-1], "type", "") == "ai":
        human_msgs.pop()
    messages = [SystemMessage(content=system_prompt)] + human_msgs

    from agentcore.plugins import get_collector
    collector = get_collector(config)
    if collector:
        collector.record_phase_start("intent")

    try:
        intent: Intent = await structured_llm.ainvoke(messages)
        if collector:
            collector.record_confidence(1.0)
    except (ValidationError, Exception):
        # Retry with fresh message list — do NOT append a SystemMessage here.
        # Anthropic rejects "multiple non-consecutive system messages" and
        # with_structured_output already uses tool-calling, so a plain retry suffices.
        intent = await structured_llm.ainvoke(messages)
        if collector:
            collector.record_confidence(0.5)

    if collector:
        collector.record_phase_end("intent")
        thread_id = str((config.get("configurable") or {}).get("thread_id", "unknown"))
        await collector.start(thread_id, intent.domain)

    # Validate action against registry-declared intents; cosine-correct minor hallucinations
    # Reuse RAG results to avoid an extra HTTP call when possible
    matched = next((r for r in rag_results if r.name == intent.domain), None)
    valid_intents_summary = (
        matched.intents
        if matched and matched.intents
        else await registry.get_intents(intent.domain)
    )
    valid_intents = [i.action for i in valid_intents_summary]
    if valid_intents and intent.action not in valid_intents:
        nearest, score = _cosine_nearest(intent.action, valid_intents)
        if score > 0.85:
            intent = Intent(
                action=nearest,
                domain=intent.domain,
                confidence=intent.confidence,
                ambiguous=intent.ambiguous,
                ambiguity_reason=intent.ambiguity_reason,
            )
        else:
            intent = Intent(
                action=intent.action,
                domain=intent.domain,
                confidence=intent.confidence,
                ambiguous=True,
                ambiguity_reason=(
                    intent.ambiguity_reason
                    or f"action '{intent.action}' is not a valid intent for domain '{intent.domain}'"
                ),
            )

    domain = intent.domain
    playbook_pins = dict(state.get("playbook_version_pin") or {})

    if domain not in playbook_pins:
        playbook = await registry.get_playbook(domain)
        playbook_pins[domain] = playbook.version if playbook else ""

    return {
        "intent": intent,
        "playbook_version_pin": playbook_pins,
    }
