"""ToolDispatcher — executes tool contracts fetched from RegistryService.

PURPOSE:
    Bridges the gap between what the LLM decided to call (a tool name + inputs
    from the agent's reasoning context) and the actual external API or script
    that performs the action.

    Flow:
        LLM decides → tool_name + inputs
            ↓
        ToolDispatcher.dispatch(tool_name, inputs)
            ↓
        ScalableRegistryClient.list_tools()  ← fetches ToolContract from RegistryService
            ↓
        Selects executor by tool_type:
            "script"  → exec() inline Python (endpoint.script)
            "rest"    → httpx HTTP call (bearer / api-key / aws_sigv4 auth)
            "mcp"     → JSON-RPC POST to MCP server
            "builtin" → importlib dynamic function call
            ↓
        Returns output dict back to act node → agent state

AUTH:
    REST tools carry auth_type in their RegistryService contract:
        "bearer"    → Authorization: Bearer <secret resolved via CredentialResolver>
        "api-key"   → X-API-Key: <secret>
        "aws_sigv4" → botocore SigV4 signing (runs in thread-pool executor)
        "none"      → no auth header
"""
from __future__ import annotations

import asyncio
import hashlib
import importlib
import json as _json
import os
from functools import partial
from typing import Any

import httpx

from worker_agent.tools.credentials import CredentialResolveError, CredentialResolver
from worker_agent.registry.base import RegistryProvider
from worker_agent.registry.scalable import RegistryUnavailableError


class DispatchError(RuntimeError):
    pass


class ToolDispatcher:

    _CACHEABLE_TYPES = frozenset({"rest", "script", "mcp"})

    def __init__(
        self,
        registry: RegistryProvider,
        mcp_live_client=None,
        credential_resolver: CredentialResolver | None = None,
        redis_client=None,
        tool_cache_ttl: int = 30,
    ):
        self._registry = registry
        self._mcp_live = mcp_live_client
        self._credential_resolver = credential_resolver or CredentialResolver.from_env()
        self._redis = redis_client
        self._tool_cache_ttl = tool_cache_ttl

    async def dispatch(self, tool_name: str, inputs: dict) -> object:
        """Resolve tool contract from registry and execute."""
        output, _ = await self.dispatch_with_url(tool_name, inputs)
        return output

    async def dispatch_with_url(self, tool_name: str, inputs: dict) -> tuple[object, str | None]:
        """Resolve tool contract from registry once, execute, and return (output, api_url).

        api_url is the canonical endpoint URL from the RegistryService tool contract.
        """
        # ── MCP live tools bypass registry lookup ────────────────────────────
        if tool_name.startswith("mcp::"):
            output = await self._dispatch_mcp_live(tool_name, inputs)
            return output, None

        contract = await self._resolve_contract(tool_name)
        endpoint: dict = getattr(contract, "endpoint", None) or {}
        tool_type: str = getattr(contract, "tool_type", None) or "builtin"

        # ── Resolve api_url from the registry contract (one lookup, not two) ─
        api_url: str | None = self._extract_api_url(tool_type, endpoint, inputs)

        # ── Synthetic shortcut ───────────────────────────────────────────────
        # When USE_SYNTHETIC_DATA=true, return the canned response stored in the
        # tool contract — no real API call, no cloud credentials needed.
        if os.environ.get("USE_SYNTHETIC_DATA", "").lower() == "true":
            synthetic = endpoint.get("synthetic_response")
            if synthetic is not None:
                return synthetic, api_url

        # ── Redis cache (REST / script / MCP only) ───────────────────────────
        cache_key: str | None = None
        if self._redis and tool_type in self._CACHEABLE_TYPES:
            cache_key = f"tool:{tool_name}:{_hash_inputs(inputs)}"
            try:
                raw = await self._redis.get(cache_key)
                if raw:
                    return _json.loads(raw), api_url
            except Exception:
                pass

        # ── Dispatch by executor type ────────────────────────────────────────
        if tool_type == "script":
            output = await self._dispatch_script(endpoint, inputs)
        elif tool_type == "mcp":
            output = await self._dispatch_mcp(endpoint, inputs)
        elif tool_type == "rest":
            output = await self._dispatch_rest(endpoint, inputs)
        elif tool_type == "builtin":
            output = await self._dispatch_builtin(tool_name, endpoint, inputs)
        else:
            raise DispatchError(f"Unknown tool_type '{tool_type}' for tool '{tool_name}'")

        if cache_key and self._redis:
            try:
                await self._redis.set(cache_key, _json.dumps(output, default=str), ex=self._tool_cache_ttl)
            except Exception:
                pass

        return output, api_url

    @staticmethod
    def _extract_api_url(tool_type: str, endpoint: dict, inputs: dict) -> str | None:
        """Extract the canonical endpoint URL from a registry tool contract."""
        if tool_type == "rest":
            url = endpoint.get("url", "")
            for k, v in inputs.items():
                url = url.replace(f"{{{k}}}", str(v))
            return url
        if tool_type == "script":
            return "inline:script"
        if tool_type == "mcp":
            return endpoint.get("server_url")
        return None

    # ── Contract resolution ──────────────────────────────────────────────────

    async def _resolve_contract(self, tool_name: str) -> Any:
        """Fetch contract from registry."""
        try:
            contracts = await self._registry.list_tools()
        except RegistryUnavailableError:
            raise

        contract = next((c for c in contracts if c.name == tool_name), None)
        if contract is None:
            raise DispatchError(f"Tool '{tool_name}' not found in ToolRegistry")
        return contract

    # ── Script executor ──────────────────────────────────────────────────────

    async def _dispatch_script(self, endpoint: dict, inputs: dict) -> object:
        """exec() an inline async Python script stored in endpoint.script.

        The script must define:  async def run(inputs: dict) -> dict
        Runs in an isolated namespace so imports do not pollute globals.
        Timeout enforced via asyncio.wait_for (TOOL_SCRIPT_TIMEOUT_S, default 60s).
        """
        script = endpoint.get("script")
        if not script:
            raise DispatchError("Script endpoint missing 'script' field")

        timeout = int(os.environ.get("TOOL_SCRIPT_TIMEOUT_S", "60"))
        namespace: dict = {}
        try:
            exec(compile(script, "<tool_script>", "exec"), namespace)  # noqa: S102
        except SyntaxError as exc:
            raise DispatchError(f"Script syntax error: {exc}") from exc

        run_fn = namespace.get("run")
        if not callable(run_fn):
            raise DispatchError("Script must define 'async def run(inputs: dict) -> dict'")

        try:
            return await asyncio.wait_for(run_fn(inputs), timeout=timeout)
        except asyncio.TimeoutError:
            raise DispatchError(f"Script timed out after {timeout}s")

    # ── REST executor ────────────────────────────────────────────────────────

    async def _resolve_auth_secret(self, ref: str | None) -> str:
        """Resolve an auth_secret_ref via CredentialResolver."""
        if not ref:
            raise DispatchError("auth_secret_ref is required but not set in endpoint config")
        try:
            return await self._credential_resolver.aresolve(ref)
        except CredentialResolveError as exc:
            raise DispatchError(str(exc)) from exc

    async def _dispatch_rest(self, endpoint: dict, inputs: dict) -> object:
        """HTTP REST call. Supports bearer, api-key, aws_sigv4, none auth."""
        url = endpoint["url"]
        for k, v in inputs.items():
            url = url.replace(f"{{{k}}}", str(v))

        method = endpoint.get("method", "POST").upper()
        auth_type = endpoint.get("auth_type", "none")

        if auth_type == "aws_sigv4":
            return await self._dispatch_aws(endpoint, inputs)

        headers: dict = {}
        if auth_type == "bearer":
            secret = await self._resolve_auth_secret(endpoint.get("auth_secret_ref"))
            headers["Authorization"] = f"Bearer {secret}"
        elif auth_type == "api-key":
            secret = await self._resolve_auth_secret(endpoint.get("auth_secret_ref"))
            headers["X-API-Key"] = secret

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.request(method, url, json=inputs, headers=headers)
            resp.raise_for_status()
            return resp.json()

    # ── AWS SigV4 executor ───────────────────────────────────────────────────

    async def _dispatch_aws(self, endpoint: dict, inputs: dict) -> object:
        """Sign and dispatch an AWS API call via botocore SigV4 in a thread pool."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, partial(_invoke_aws_sync, endpoint, inputs))

    # ── MCP executor ─────────────────────────────────────────────────────────

    async def _dispatch_mcp(self, endpoint: dict, inputs: dict) -> object:
        """Call an MCP server tool via JSON-RPC POST."""
        server_url = endpoint.get("server_url", "")
        mcp_tool = endpoint.get("mcp_tool_name", "")
        if not server_url or not mcp_tool:
            raise DispatchError("MCP endpoint requires 'server_url' and 'mcp_tool_name'")

        payload = {
            "jsonrpc": "2.0", "id": 1,
            "method": "tools/call",
            "params": {"name": mcp_tool, "arguments": inputs},
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(server_url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            if "error" in data:
                raise DispatchError(f"MCP error: {data['error']}")
            result = data.get("result", data)
            content = result.get("content", result)
            if isinstance(content, list):
                texts = [c.get("text", str(c)) if isinstance(c, dict) else str(c) for c in content]
                return {"content": "\n".join(texts)}
            return content

    # ── MCP live executor ────────────────────────────────────────────────────

    async def _dispatch_mcp_live(self, namespaced_name: str, inputs: dict) -> object:
        """Parse mcp::{server}::{tool}, resolve URL, call tools/call JSON-RPC."""
        if self._mcp_live is None:
            raise DispatchError(
                f"Tool '{namespaced_name}' requires MCPLiveClient but none was configured"
            )
        parts = namespaced_name.split("::", 2)
        if len(parts) != 3 or parts[0] != "mcp":
            raise DispatchError(f"Invalid mcp_live tool name format: '{namespaced_name}'")
        _, server_name, bare_tool = parts

        servers = await self._mcp_live._fetch_server_list()
        server = next((s for s in servers if s["name"] == server_name), None)
        if server is None:
            raise DispatchError(
                f"MCP server '{server_name}' not found in registered server list"
            )
        from worker_agent.registry.mcp_live_client import MCPCallError, MCPServerUnreachable
        try:
            return await self._mcp_live.call(
                server_name=server_name,
                server_url=server["url"],
                tool_name=bare_tool,
                inputs=inputs,
            )
        except MCPServerUnreachable:
            raise DispatchError(f"MCP_SERVER_UNREACHABLE: {server_name}")
        except MCPCallError as exc:
            raise DispatchError(str(exc))

    # ── Builtin executor (backward compat) ───────────────────────────────────

    async def _dispatch_builtin(self, tool_name: str, endpoint: dict, inputs: dict) -> object:
        fn_path = endpoint.get("function")
        if fn_path:
            module_path, fn_name = fn_path.rsplit(".", 1)
            module = importlib.import_module(module_path)
            try:
                fn = getattr(module, fn_name)
            except AttributeError:
                raise DispatchError(f"No callable '{fn_name}' found in module '{module_path}'")
        else:
            raise DispatchError(f"No function path configured for builtin tool '{tool_name}'")

        if fn is None:
            raise DispatchError(f"No callable found for builtin tool '{tool_name}'")

        if asyncio.iscoroutinefunction(fn):
            return await fn(**inputs)
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, partial(fn, **inputs))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hash_inputs(inputs: dict) -> str:
    return hashlib.sha256(
        _json.dumps(inputs, sort_keys=True, default=str).encode()
    ).hexdigest()[:16]


def _invoke_aws_sync(endpoint: dict, inputs: dict) -> dict:
    """Synchronous AWS SigV4 call — runs inside a thread-pool executor."""
    import urllib.request
    import botocore.auth
    import botocore.awsrequest
    import botocore.session

    service = endpoint.get("aws_service", "ec2")
    region_param = endpoint.get("aws_region_param", "region")
    region = inputs.get(region_param, os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))

    url = endpoint["url"]
    for k, v in inputs.items():
        url = url.replace(f"{{{k}}}", str(v))
    url = url.replace("{service}", service).replace("{region}", region)

    method = endpoint.get("method", "POST")
    action = endpoint.get("action", "")

    params = {k: str(v) for k, v in inputs.items() if k != region_param and v is not None}
    if action:
        params["Action"] = action
        params.setdefault("Version", "2016-11-15")
    body = "&".join(f"{k}={v}" for k, v in sorted(params.items()))

    session = botocore.session.get_session()
    credentials = session.get_credentials()
    if credentials is None:
        raise DispatchError("AWS credentials not found — set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY")
    credentials = credentials.resolve()

    aws_request = botocore.awsrequest.AWSRequest(
        method=method, url=url,
        data=body.encode() if body else None,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    botocore.auth.SigV4Auth(credentials, service, region).add_auth(aws_request)
    prepared = aws_request.prepare()

    req = urllib.request.Request(
        prepared.url,
        data=prepared.body.encode() if isinstance(prepared.body, str) else prepared.body,
        headers=dict(prepared.headers),
        method=method,
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode()

    try:
        import xmltodict
        return xmltodict.parse(raw)
    except ImportError:
        return {"raw_xml": raw}
