from langgraph.graph import StateGraph, END

from agent.graph.state import AgentState
from agentcore.plugins import ContextManager
from agent.nodes.extract_intent import extract_intent
from agent.nodes.clarify import clarify
from agent.nodes.check_plan_cache import check_plan_cache
from agent.nodes.think import think
from agent.nodes.hitl_step_review import hitl_step_review
from agent.nodes.act import act
from agent.nodes.observe import observe
from agent.nodes.analysis_summary import analysis_summary
from agent.nodes.propose_fix import propose_fix
from agent.nodes.report import report
from agent.nodes.chain_remediate import chain_remediate
from agent.graph.routes import (
    route_intent,
    route_cache,
    route_hitl_step_review, route_analysis_summary, route_propose_fix,
)
import os
from worker_agent.registry.base import RegistryProvider


def _make_session_factory(db_url: str):
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    engine = create_async_engine(db_url)
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


def build_graph(checkpointer=None, registry: RegistryProvider | None = None):
    if registry is None:
        raise ValueError("registry is required — pass a ScalableRegistryClient")

    builder = StateGraph(AgentState)

    builder.add_node("manage_context",    ContextManager(max_tokens=int(os.environ.get("CONTEXT_MAX_TOKENS", "8000"))))
    builder.add_node("extract_intent",    extract_intent)
    builder.add_node("clarify",           clarify)
    builder.add_node("check_plan_cache",  check_plan_cache)
    builder.add_node("think",             think)
    builder.add_node("hitl_step_review",  hitl_step_review)
    builder.add_node("act",               act)
    builder.add_node("observe",           observe)
    builder.add_node("analysis_summary",  analysis_summary)
    builder.add_node("propose_fix",       propose_fix)
    builder.add_node("report",            report)
    builder.add_node("chain_remediate",   chain_remediate)

    builder.set_entry_point("manage_context")
    builder.add_edge("manage_context", "extract_intent")

    builder.add_conditional_edges(
        "extract_intent", route_intent,
        {"clarify": "clarify", "check_plan_cache": "check_plan_cache", "end": END},
    )
    builder.add_edge("clarify", "extract_intent")
    builder.add_conditional_edges(
        "check_plan_cache", route_cache,
        {"think": "think", "propose_fix": "propose_fix"},
    )
    builder.add_edge("think", "hitl_step_review")
    builder.add_conditional_edges(
        "hitl_step_review", route_hitl_step_review,
        {"act": "act", "think": "think", "analysis_summary": "analysis_summary",
         "report": "report", "end": END},
    )
    builder.add_edge("act", "observe")
    builder.add_edge("observe", "think")
    builder.add_conditional_edges(
        "analysis_summary", route_analysis_summary,
        {"propose_fix": "propose_fix", "end": END},
    )
    builder.add_conditional_edges(
        "propose_fix", route_propose_fix,
        {"report": "report", "think": "think", "propose_fix": "propose_fix", "end": END},
    )
    builder.add_edge("report", "chain_remediate")
    builder.add_edge("chain_remediate", END)

    return builder.compile(checkpointer=checkpointer)


async def build_graph_with_postgres(db_url: str):
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    checkpointer = await AsyncPostgresSaver.from_conn_string(db_url)
    await checkpointer.setup()
    return build_graph(checkpointer=checkpointer)
