from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, AsyncIterator


class NodeInterface(ABC):
    """Stable SDK contract for a LangGraph node.

    Agents implement this per-node. The SDK guarantees this interface across
    major versions — node authors depend on NodeInterface, not on LangGraph
    internals directly.
    """

    @abstractmethod
    async def __call__(self, state: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
        """Execute the node. Returns state delta to merge."""
        ...


class GraphRuntime:
    """Thin wrapper around a compiled LangGraph graph.

    Provides a stable SDK surface so agent code imports GraphRuntime, not
    langgraph.graph directly.
    """

    def __init__(self, graph: Any) -> None:
        self._graph = graph

    async def invoke(self, state: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
        return await self._graph.ainvoke(state, config)

    async def stream_events(
        self, state: dict[str, Any], config: dict[str, Any]
    ) -> AsyncIterator[dict[str, Any]]:
        async for event in self._graph.astream_events(state, config, version="v2"):
            yield event

    async def update_state(
        self, config: dict[str, Any], values: dict[str, Any], as_node: str | None = None
    ) -> None:
        await self._graph.aupdate_state(config, values, as_node=as_node)

    def get_state(self, config: dict[str, Any]) -> Any:
        return self._graph.get_state(config)
