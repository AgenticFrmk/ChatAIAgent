from __future__ import annotations
from abc import ABC, abstractmethod
from pydantic import BaseModel


# ── Shared models ─────────────────────────────────────────────────────────────

class EntityFieldMeta(BaseModel):
    name: str
    type: str                     # e.g. "str", "float | None"
    required: bool
    description: str = ""
    pattern: str = ""


class SchemaMetadata(BaseModel):
    domain: str
    intents: dict[str, list[EntityFieldMeta]]   # action → fields
    owner: str


class ToolContract(BaseModel):
    name: str
    domain: str | None = None     # None = cross-domain
    description: str              # docstring surfaced to LLM in plan prompt
    input_schema: dict[str, str]  # param_name → type_str
    output_description: str
    version: str
    owner: str
    tool_type: str = "builtin"    # "builtin" | "mcp" | "rest"
    endpoint: dict = {}           # dispatch metadata (function, server_url, url, etc.)

    @property
    def input_signature(self) -> str:
        """e.g. 'vlan_id: int, name: str'"""
        return ", ".join(f"{k}: {v}" for k, v in self.input_schema.items())


class PlaybookRule(BaseModel):
    id: str
    description: str
    before: list[str] = []        # tool names that must precede ...
    after: list[str] = []         # ... these tool names
    tools: list[str] = []         # tools sharing a soft pattern
    pattern: str = ""
    severity: str                 # "hard" | "soft"


class Playbook(BaseModel):
    domain: str
    version: str
    rules: list[PlaybookRule]
    owner: str

    def hard_rules(self) -> list[PlaybookRule]:
        return [r for r in self.rules if r.severity == "hard"]

    def soft_rules(self) -> list[PlaybookRule]:
        return [r for r in self.rules if r.severity == "soft"]


class IntentSummary(BaseModel):
    action: str
    description: str | None = None
    input_schema: list[EntityFieldMeta] | None = None
    tool_hints: list[str] = []


class DomainRecord(BaseModel):
    name: str
    hint: str | None = None
    intents: list[IntentSummary] = []
    score: float = 1.0


class ToolRecord(BaseModel):
    tool_name: str
    domain: str | None = None
    description: str | None = None
    input_schema: dict | None = None
    output_description: str | None = None
    endpoint: dict | None = None
    tool_type: str | None = None
    score: float = 1.0

    @property
    def name(self) -> str:
        return self.tool_name

    @property
    def input_signature(self) -> str:
        schema = self.input_schema or {}
        return ", ".join(f"{k}: {v}" for k, v in schema.items())


# ── ABC ───────────────────────────────────────────────────────────────────────

class RegistryProvider(ABC):

    @abstractmethod
    async def get_schema(self, domain: str) -> SchemaMetadata:
        """Entity field schema for the domain.
        Raises KeyError if domain is not registered."""

    @abstractmethod
    async def list_tools(self, domain: str | None = None) -> list[ToolContract]:
        """Tool contracts for plan prompt.
        If domain is given, returns tools for that domain plus cross-domain tools."""

    @abstractmethod
    async def get_playbook(self, domain: str, version: str | None = None) -> Playbook | None:
        """Ordering rules for plan validation. Returns None if no playbook registered."""

    async def retrieve_rag_context(self, domain: str, query: str, top_k: int = 5) -> list[str]:
        """Return prose chunks from RAG when tool registry is empty. Default: no-op returns []."""
        return []

    @abstractmethod
    async def get_intents(self, domain: str) -> list[IntentSummary]:
        """Valid intents for the domain with descriptions and input fields. Used by extract_intent to constrain LLM."""

    async def search_domains(self, query: str, k: int = 5) -> list[DomainRecord]:
        """Top-k domains by semantic similarity. Returns [] → caller falls back to list_domains_full()."""
        return []

    async def search_tools(
        self, query: str, domain: str | None = None, k: int = 10
    ) -> list[ToolRecord]:
        """Top-k tools by semantic similarity. Returns [] → caller falls back to list_tools(domain)."""
        return []

