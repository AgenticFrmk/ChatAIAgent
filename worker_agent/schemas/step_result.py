from pydantic import BaseModel, Field
from typing import Literal

class StepResult(BaseModel):
    status: Literal["completed", "failed", "skipped"]
    output: dict | str | None = None
    error: str | None = None
    inputs: dict = Field(default_factory=dict)
    api_url: str | None = None
    tool_name: str | None = None
