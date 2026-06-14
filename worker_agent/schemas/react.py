from __future__ import annotations
import json
from typing import Literal
from pydantic import BaseModel, Field, field_validator


class Thought(BaseModel):
    reasoning: str
    tool_name: str | None = None
    inputs: dict = Field(default_factory=dict)
    signal: Literal["ANALYSIS_DONE", "REMEDIATION_DONE"] | None = None

    @field_validator("tool_name", mode="before")
    @classmethod
    def _single_tool_only(cls, v: object) -> str | None:
        """Guard against LLM batching multiple names — take only the first."""
        if v is None:
            return None
        name = str(v).strip()
        if "," in name:
            name = name.split(",")[0].strip()
        return name or None

    @field_validator("inputs", mode="before")
    @classmethod
    def _coerce_inputs(cls, v: object) -> dict:
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                if isinstance(parsed, dict):
                    return parsed
            except (json.JSONDecodeError, ValueError):
                pass
            return {}
        return v if isinstance(v, dict) else {}


class ThoughtActObserve(BaseModel):
    step_number: int
    reasoning: str
    tool_name: str
    inputs: dict
    tool_output: str
    finding: str
