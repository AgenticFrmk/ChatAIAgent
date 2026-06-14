from __future__ import annotations
import hashlib
import json
import time
import httpx
from worker_agent.registry.base import (
    RegistryProvider,
    SchemaMetadata,
    EntityFieldMeta,
    ToolContract,
    Playbook,
    PlaybookRule,
    DomainRecord,
    IntentSummary,
    ToolRecord,
)


class RegistryUnavailableError(RuntimeError):
    pass


class ConfigurationError(RuntimeError):
    pass


class ScalableRegistryClient(RegistryProvider):

    def __init__(
        self,
        base_url: str,
        cache_ttl_seconds: int = 60,
        auth_url: str | None = None,
        username: str | None = None,
        password: str | None = None,
        redis_client=None,
        rag_cache_ttl: int = 7200,
    ):
        if not base_url:
            raise ConfigurationError("REGISTRY_SERVICE_URL must be set")
        self._base_url = base_url.rstrip("/")
        self._ttl = cache_ttl_seconds
        self._cache: dict[tuple, tuple[float, object]] = {}  # key → (expires_at, value)
        self._auth_url = auth_url.rstrip("/") if auth_url else None
        self._username = username
        self._password = password
        self._token: str | None = None
        self._token_expires_at: float = 0.0
        self._redis = redis_client
        self._rag_cache_ttl = rag_cache_ttl
        # Persistent client — reuses TCP connections for all registry calls
        self._http = httpx.AsyncClient(timeout=10.0)

    def _get(self, key: tuple) -> object | None:
        entry = self._cache.get(key)
        if entry and time.monotonic() < entry[0]:
            return entry[1]
        return None

    def _set(self, key: tuple, value: object) -> None:
        self._cache[key] = (time.monotonic() + self._ttl, value)

    def flush_cache(self) -> None:
        self._cache.clear()

    async def _get_token(self) -> str | None:
        """Fetch a JWT from the auth service if credentials are configured. Caches until ~30s before expiry."""
        if not (self._auth_url and self._username and self._password):
            return None
        if self._token and time.monotonic() < self._token_expires_at - 30:
            return self._token
        try:
            resp = await self._http.post(
                f"{self._auth_url}/auth/token",
                data={"username": self._username, "password": self._password},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp.raise_for_status()
        except Exception as exc:
            raise RegistryUnavailableError(f"Registry auth failed: {exc}") from exc
        body = resp.json()
        self._token = body["access_token"]
        # JWTs from AuthService default to 60-minute TTL; use that as the expiry window
        self._token_expires_at = time.monotonic() + body.get("expires_in", 3600)
        return self._token

    async def _fetch(self, path: str) -> dict | list | None:
        token = await self._get_token()
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        try:
            resp = await self._http.get(f"{self._base_url}{path}", headers=headers)
            if resp.status_code == 401 and token:
                # Token may have expired mid-flight — refresh once and retry
                self._token = None
                token = await self._get_token()
                headers = {"Authorization": f"Bearer {token}"} if token else {}
                resp = await self._http.get(f"{self._base_url}{path}", headers=headers)
        except Exception as exc:
            raise RegistryUnavailableError(f"RegistryService unreachable: {exc}") from exc
        if resp.status_code == 404:
            return None
        if not resp.is_success:
            raise RegistryUnavailableError(
                f"RegistryService returned {resp.status_code} for {path}"
            )
        return resp.json()

    async def get_schema(self, domain: str) -> SchemaMetadata:
        key = ("schema", domain)
        if (cached := self._get(key)) is not None:
            return cached
        data = await self._fetch(f"/domains/{domain}/intents")
        if data is None:
            raise KeyError(f"No schema registered for domain '{domain}'")
        intents: dict[str, list[EntityFieldMeta]] = {}
        for row in (data if isinstance(data, list) else []):
            fields = [EntityFieldMeta(**f) for f in (row.get("input_schema") or [])]
            intents[row["action"]] = fields
        result = SchemaMetadata(domain=domain, intents=intents, owner="")
        self._set(key, result)
        return result

    async def list_tools(self, domain: str | None = None) -> list[ToolContract]:
        key = ("tools", domain)
        if (cached := self._get(key)) is not None:
            return cached
        path = f"/tools?domain={domain}" if domain else "/tools"
        data = await self._fetch(path) or []
        result = [
            ToolContract(
                name=row["tool_name"],
                domain=row.get("domain"),
                description=row["description"],
                input_schema=_normalise_input_schema(row.get("input_schema", {})),
                output_description=row.get("output_description", ""),
                version=row["version"],
                owner=row["owner"],
                tool_type=row.get("tool_type", "builtin"),
                endpoint=row.get("endpoint", {}),
            )
            for row in data
        ]
        self._set(key, result)
        return result

    async def get_playbook(self, domain: str, version: str | None = None) -> Playbook | None:
        key = ("playbook", domain, version)
        if (cached := self._get(key)) is not None:
            return cached
        path = f"/playbooks/{domain}/{version}" if version else f"/playbooks/{domain}"
        data = await self._fetch(path)
        if data is None:
            self._set(key, None)
            return None
        result = Playbook(
            domain=data["domain"],
            version=data["version"],
            owner=data["owner"],
            rules=[PlaybookRule(**r) for r in data["rules"]],
        )
        self._set(key, result)
        return result


    async def get_intents(self, domain: str) -> list[IntentSummary]:
        key = ("intents", domain)
        if (cached := self._get(key)) is not None:
            return cached
        data = await self._fetch(f"/domains/{domain}/intents")
        if not data:
            self._set(key, [])
            return []
        # Endpoint returns a list: [{"action": "...", "description": "...", "input_schema": [...]}, ...]
        rows = data if isinstance(data, list) else []
        result = [
            IntentSummary(
                action=row["action"],
                description=row.get("description"),
                input_schema=[EntityFieldMeta(**f) for f in (row.get("input_schema") or [])],
                tool_hints=(row.get("manifest") or {}).get("tool_hints", []),
            )
            for row in rows
        ]
        self._set(key, result)
        return result

    async def retrieve_rag_context(self, domain: str, query: str, top_k: int = 5) -> list[str]:
        """Return top-k prose chunks from migration_chunks via cosine similarity.

        L1: in-process dict (self._ttl). L2: Redis (self._rag_cache_ttl, default 2h).
        Returns [] if the endpoint is unavailable or no chunks exist for the domain.
        """
        key = ("rag_context", domain, query, top_k)
        if (cached := self._get(key)) is not None:
            return cached

        rkey = f"rag:{domain}:{_hash_str(query)}:{top_k}"
        if self._redis:
            try:
                raw = await self._redis.get(rkey)
                if raw:
                    result = json.loads(raw)
                    self._set(key, result)
                    return result
            except Exception:
                pass

        try:
            resp = await self._http.post(
                f"{self._base_url}/rag/retrieve",
                json={"domain": domain, "query": query, "top_k": top_k},
            )
            if resp.status_code in (503, 404):
                return []
            if not resp.is_success:
                return []
            result = resp.json().get("chunks", [])
        except Exception:
            return []

        self._set(key, result)
        if self._redis and result:
            try:
                await self._redis.set(rkey, json.dumps(result), ex=self._rag_cache_ttl)
            except Exception:
                pass
        return result

    async def search_domains(self, query: str, k: int = 5) -> list[DomainRecord]:
        """GET /domains/search — returns [] on any failure."""
        key = ("search_domains", query, k)
        if (cached := self._get(key)) is not None:
            return cached
        try:
            resp = await self._http.get(
                f"{self._base_url}/domains/search",
                params={"q": query, "k": k},
            )
            if not resp.is_success:
                return []
            data = resp.json()
            results = []
            for r in data.get("results", []):
                intents = [IntentSummary(**i) for i in r.get("intents", [])]
                results.append(DomainRecord(
                    name=r["name"],
                    hint=r.get("hint"),
                    intents=intents,
                    score=r.get("score", 1.0),
                ))
        except Exception:
            return []
        self._set(key, results)
        return results

    async def search_tools(
        self, query: str, domain: str | None = None, k: int = 10
    ) -> list[ToolRecord]:
        """GET /tools/search — returns [] on any failure.

        L1: in-process dict. L2: Redis (self._rag_cache_ttl, same as RAG — tool embeddings are stable).
        """
        key = ("search_tools", query, domain, k)
        if (cached := self._get(key)) is not None:
            return cached

        rkey = f"tool_search:{domain or ''}:{_hash_str(query)}:{k}"
        if self._redis:
            try:
                raw = await self._redis.get(rkey)
                if raw:
                    result = [ToolRecord(**r) for r in json.loads(raw)]
                    self._set(key, result)
                    return result
            except Exception:
                pass

        try:
            params: dict = {"q": query, "k": k}
            if domain:
                params["domain"] = domain
            resp = await self._http.get(
                f"{self._base_url}/tools/search",
                params=params,
            )
            if not resp.is_success:
                return []
            result = [ToolRecord(**r) for r in resp.json().get("results", [])]
        except Exception:
            return []

        self._set(key, result)
        if self._redis and result:
            try:
                await self._redis.set(
                    rkey,
                    json.dumps([r.model_dump() if hasattr(r, "model_dump") else vars(r) for r in result]),
                    ex=self._rag_cache_ttl,
                )
            except Exception:
                pass
        return result



def _hash_str(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:16]


def _normalise_input_schema(raw: dict) -> dict[str, str]:
    """Convert JSON Schema property map to dict[str, str] type strings."""
    props = raw.get("properties", raw)  # unwrap JSON Schema {"properties": {...}} if present
    return {param: _json_schema_type(schema) for param, schema in props.items()}


def _json_schema_type(schema: dict | str) -> str:
    if isinstance(schema, str):
        return schema
    t = schema.get("type")
    if t == "string":   return "str"
    if t == "integer":  return "int"
    if t == "boolean":  return "bool"
    if t == "number":   return "float"
    if t == "array":
        inner = _json_schema_type(schema.get("items", {}))
        return f"list[{inner}]"
    any_of = schema.get("anyOf")
    if any_of:
        non_null = [s for s in any_of if s.get("type") != "null"]
        nullable = any(s.get("type") == "null" for s in any_of)
        mapped = _json_schema_type(non_null[0]) if non_null else "any"
        return f"{mapped} | None" if nullable else mapped
    return "any"
