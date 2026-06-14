from langchain_core.messages import AIMessage, HumanMessage
from langgraph.types import interrupt
from agent.graph.state import AgentState

MAX_ATTEMPTS = 2


def clarify(state: AgentState) -> dict:
    if state.get("clarification_attempts", 0) >= MAX_ATTEMPTS:
        return {"clarification_attempts": state.get("clarification_attempts", 0) + 1}

    intent = state.get("intent")
    question_text = intent.ambiguity_reason if intent else "Could you clarify your request?"

    user_answer: str = interrupt({"question": question_text})

    # Include AIMessage(question) so extract_intent sees the full Q&A context.
    # The trailing message is HumanMessage — no assistant-prefill error on Claude 4.x.
    return {
        "messages": list(state["messages"]) + [
            AIMessage(content=question_text),
            HumanMessage(content=user_answer),
        ],
        "clarification_attempts": state.get("clarification_attempts", 0) + 1,
    }
