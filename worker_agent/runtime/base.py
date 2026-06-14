from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, AsyncIterator


class BaseAgent(ABC):
    """Abstract base class for all agents built on agent-core SDK.

    Subclass this in your agent service. Implement `stream()` to drive the
    LangGraph graph. The SDK's `serve()` helper wires the HTTP endpoints.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique agent name — used for Consul registration and agent-registry."""
        ...

    @property
    @abstractmethod
    def version(self) -> str:
        """Semver string e.g. '1.0.0'."""
        ...

    @abstractmethod
    async def turn(self, message: str, thread_id: str, config: dict[str, Any]) -> dict[str, Any]:
        """Handle a single synchronous turn. Returns final state."""
        ...

    @abstractmethod
    async def stream(
        self, message: str, thread_id: str, config: dict[str, Any]
    ) -> AsyncIterator[dict[str, Any]]:
        """Stream graph events for a turn. Yields node events as dicts."""
        ...

    async def on_start(self) -> None:
        """Called once at agent startup. Override for resource initialisation."""

    async def on_stop(self) -> None:
        """Called once at agent shutdown. Override for graceful cleanup."""
