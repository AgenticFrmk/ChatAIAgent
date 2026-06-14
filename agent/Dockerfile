# Build context: AgenticFrmk/ (repo root — needed to access AgentCore/ and ChatAIAgent/)
# docker-compose passes: context: ../ dockerfile: ChatAIAgent/agent/Dockerfile
#
# Two build targets:
#   sre-agent          — full LangGraph SRE agent (default)
#   remediation-agent  — destructive-ops remediation planner, OPA-gated chain target

# ── Shared OS base ────────────────────────────────────────────────────────────
FROM python:3.13-alpine AS python-base

RUN apk add --no-cache git gcc musl-dev libffi-dev postgresql-client libpq-dev

# ── sre-agent ─────────────────────────────────────────────────────────────────
FROM python-base AS sre-agent

WORKDIR /app

# Install AgentCore SDK (agentcore.plugins)
COPY AgentCore/pyproject.toml AgentCore/
COPY AgentCore/agentcore/ AgentCore/agentcore/
RUN pip install --no-cache-dir -e AgentCore/

# Install platform SDK + customer agent (pyproject.toml at ChatAIAgent/ level)
COPY ChatAIAgent/pyproject.toml ChatAIAgent/
COPY ChatAIAgent/worker_agent/ ChatAIAgent/worker_agent/
COPY ChatAIAgent/agent/ ChatAIAgent/agent/
RUN pip install --no-cache-dir -e ChatAIAgent/

WORKDIR /app/ChatAIAgent

EXPOSE 8080

CMD ["uvicorn", "worker_agent.main:app", "--host", "0.0.0.0", "--port", "8080"]

# ── remediation-agent ─────────────────────────────────────────────────────────
# Destructive-ops remediation planner — no AgentCore, no LangGraph.
# Receives analysis findings from sre-agent and generates a structured
# remediation plan (SAFE + DESTRUCTIVE steps).
# Only reachable through Envoy when x-calling-agent: sre-agent is present (OPA chain rule).
FROM python-base AS remediation-agent

WORKDIR /app

RUN pip install --no-cache-dir fastapi "uvicorn[standard]" anthropic structlog

COPY ChatAIAgent/remediation_agent/ remediation_agent/

EXPOSE 8085

CMD ["uvicorn", "remediation_agent.main:app", "--host", "0.0.0.0", "--port", "8085"]
