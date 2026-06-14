# Build context: AgenticFrmk/ (repo root — needed to access AgentCore/ and ChatAIAgent/)
# docker-compose passes: context: ../ dockerfile: ChatAIAgent/agent/Dockerfile

FROM python:3.13-alpine

RUN apk add --no-cache git gcc musl-dev libffi-dev postgresql-client libpq-dev

WORKDIR /app

# Install AgentCore SDK (includes agentcore.credentials + agentcore.dispatch)
COPY AgentCore/pyproject.toml AgentCore/
COPY AgentCore/agentcore/ AgentCore/agentcore/
RUN pip install --no-cache-dir -e AgentCore/

# Install SRE agent (pyproject.toml lives at ChatAIAgent/ level; packages = ["agent"])
COPY ChatAIAgent/pyproject.toml ChatAIAgent/
COPY ChatAIAgent/agent/ ChatAIAgent/agent/
RUN pip install --no-cache-dir -e ChatAIAgent/

WORKDIR /app/ChatAIAgent

EXPOSE 8080

CMD ["uvicorn", "agent.main:app", "--host", "0.0.0.0", "--port", "8080"]
