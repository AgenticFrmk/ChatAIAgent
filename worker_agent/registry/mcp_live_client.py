"""Live MCP tool discovery and dispatch.

Fetches tool manifests directly from registered MCP servers via tools/list
JSON-RPC at invocation time (TTL-cached). No registry approval required.
"""
from __future__ import annotations

import logging
import time

import httpx

from worker_agent.registry.base import ToolContract

logger = logging.getLogger(__name__)

_JSON_TO_STR: dict[str, str] = {
    "string": "str",
    "integer": "int",
    "number": "float",
    "boolean": "bool",
}


class MCPServerUnreachable(RuntimeError):
    def __init__(self, server_name: str):
        super().__init__(f"MCP_SERVER_UNREACHABLE: {server_name}")
        self.server_name = server_name


class MCPCallError(RuntimeError):
    def __init__(self, server_name: str, tool_name: str, message: str):
        super().__init__(f"MCP error from '{server_name}/{tool_name}': {message}")
        self.server_name = server_name
        self.tool_name = tool_name


class MCPLiveClient:
    """Fetches and dispatches MCP tools live at invocation time.

    Two independent TTL caches:
    - server list: result of GET /mcp-servers (shared TTL window)
    - per-server tool list: result of tools/list per server URL
    """

    def __init__(
        self,
        registry_url: str,
        cache_ttl_seconds: int = 60,
        timeout_seconds: float = 5.0,
    ):
        self._registry_url = registry_url.rstrip("/")
        self._ttl = cache_ttl_seconds
        self._timeout = timeout_seconds
        self._server_cache: tuple[float, list[dict]] | None = None
        self._tool_cache: dict[str, tuple[float, list[dict]]] = {}

    # ── Server list ───────────────────────────────────────────────────────────

    async def _fetch_server_list(self) -> list[dict]:
        now = time.monotonic()
        if self._server_cache and now < self._server_cache[0]:
            return self._server_cache[1]
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(f"{self._registry_url}/mcp-servers")
                resp.raise_for_status()
                servers = resp.json()
        except Exception as exc:
            logger.warning(
                "MCPLiveClient: could not reach RegistryService (%s) — live MCP tools disabled",
                exc,
            )
            return []
        self._server_cache = (now + self._ttl, servers)
        return servers

    # ── Per-server tool list ──────────────────────────────────────────────────

    async def _fetch_tools(self, server_name: str, server_url: str) -> list[dict]:
        now = time.monotonic()
        cached = self._tool_cache.get(server_url)
        if cached and now < cached[0]:
            return cached[1]
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(
                    server_url,
                    json={"jsonrpc": "2.0", "method": "tools/list", "id": 1},
                )
                resp.raise_for_status()
                data = resp.json()
                tools = data["result"]["tools"]
        except Exception as exc:
            logger.warning(
                "MCPLiveClient: tools/list failed for server '%s' (%s) — skipping",
                server_name,
                exc,
            )
            return []
        self._tool_cache[server_url] = (now + self._ttl, tools)
        return tools

    # ── Public interface ──────────────────────────────────────────────────────

    async def list_tools_all(self) -> list[ToolContract]:
        """Return live ToolContract list from all active registered MCP servers."""
        servers = await self._fetch_server_list()
        result: list[ToolContract] = []
        for server in servers:
            name = server["name"]
            url = server["url"]
            tools = await self._fetch_tools(name, url)
            for tool in tools:
                result.append(_to_contract(name, url, tool))
        return result

    async def call(
        self,
        server_name: str,
        server_url: str,
        tool_name: str,
        inputs: dict,
    ) -> dict:
        """Call tools/call JSON-RPC on the originating server.

        Raises MCPServerUnreachable on transport error.
        Raises MCPCallError when the MCP server returns a JSON-RPC error object.
        """
        payload = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "id": 1,
            "params": {"name": tool_name, "arguments": inputs},
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(server_url, json=payload)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError as exc:
            raise MCPServerUnreachable(server_name) from exc
        if "error" in data:
            raise MCPCallError(
                server_name, tool_name, data["error"].get("message", str(data["error"]))
            )
        return data.get("result", {})

    def flush_cache(self) -> None:
        self._server_cache = None
        self._tool_cache.clear()


# ── Helpers ───────────────────────────────────────────────────────────────────


def _to_contract(server_name: str, server_url: str, tool: dict) -> ToolContract:
    bare_name = tool["name"]
    props = tool.get("inputSchema", {}).get("properties", {})
    return ToolContract(
        name=f"mcp::{server_name}::{bare_name}",
        description=tool.get("description", ""),
        tool_type="mcp_live",
        input_schema={k: _map_type(v) for k, v in props.items()},
        output_description="",
        version="live",
        owner=server_name,
        domain=None,
        endpoint={"server_url": server_url, "mcp_tool_name": bare_name},
    )


def _map_type(prop: dict) -> str:
    t = prop.get("type")
    if t is None and "anyOf" not in prop:
        return "any"
    if t == "array":
        return f"list[{_map_type(prop.get('items', {}))}]"
    any_of = prop.get("anyOf")
    if any_of:
        non_null = [s for s in any_of if s.get("type") != "null"]
        nullable = len(non_null) < len(any_of)
        base = _map_type(non_null[0]) if non_null else "any"
        return f"{base} | None" if nullable else base
    return _JSON_TO_STR.get(t, "any")
