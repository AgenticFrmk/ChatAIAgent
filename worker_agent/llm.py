from dataclasses import dataclass
from langchain_core.language_models import BaseChatModel


@dataclass
class LLMConfig:
    """Provider-agnostic LLM configuration injected into all nodes via RunnableConfig.

    default_llm   — used by: extract_intent, think, clarify, report, observe, propose_fix
    reasoning_llm — used by: validate_cot only (requires stronger CoT reasoning)
    """
    default_llm: BaseChatModel
    reasoning_llm: BaseChatModel


def default_anthropic_config() -> LLMConfig:
    from langchain_anthropic import ChatAnthropic
    return LLMConfig(
        default_llm=ChatAnthropic(model="claude-sonnet-4-6"),
        reasoning_llm=ChatAnthropic(model="claude-opus-4-6"),
    )
