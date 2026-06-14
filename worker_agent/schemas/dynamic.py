from __future__ import annotations
from typing import Any, Optional
from pydantic import Field, create_model
from worker_agent.registry.base import SchemaMetadata


_REQUIRED_TYPE_MAP: dict[str, Any] = {
    "str":        str,
    "int":        int,
    "bool":       bool,
    "float":      float,
    "list[str]":  list[str],
}

_OPTIONAL_TYPE_MAP: dict[str, Any] = {
    "str":              str | None,
    "int":              int | None,
    "bool":             bool | None,
    "float":            float | None,
    "list[str]":        list[str] | None,
    "str | None":       str | None,
    "int | None":       int | None,
    "bool | None":      bool | None,
    "float | None":     float | None,
    "list[str] | None": list[str] | None,
}


def build_entity_model(schema: SchemaMetadata, intent_action: str) -> type:
    fields = schema.intents.get(intent_action, [])
    field_definitions: dict[str, Any] = {}
    for f in fields:
        annotation = _OPTIONAL_TYPE_MAP.get(f.type, Optional[Any])
        desc = f.description or f.name
        if f.required and f.pattern:
            desc = f"{desc} — MUST match pattern `{f.pattern}`. Return null if not found in the text."
        extra = {"pattern": f.pattern} if f.pattern else {}
        field_definitions[f.name] = (annotation, Field(default=None, description=desc, **extra))
    safe_name = schema.domain.replace(".", "_").replace("-", "_").title().replace("_", "")
    return create_model(
        f"{safe_name}Entity",
        **field_definitions,
    )
