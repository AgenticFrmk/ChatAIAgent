from dataclasses import dataclass
from langchain_core.language_models import BaseChatModel


@dataclass
class LLMConfig:
    """Provider-agnostic LLM configuration injected into all nodes via RunnableConfig."""
    default_llm: BaseChatModel
