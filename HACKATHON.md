# Zero-Trust for AI Agents
### OSS4AI Hackathon Submission

---

## The Problem

When an AI agent calls another AI agent, who verifies the caller's identity?

Today's multi-agent systems assume trust implicitly. An SRE agent that decides to trigger remediation simply sets a header like `x-calling-agent: sre-agent` on its outbound HTTP call. Any process — a compromised container, a rogue LLM output, a prompt injection attack — can set that same header. The receiving agent has no way to know whether it came from a trusted orchestrator or an attacker.

This is the **confused deputy problem at the agent layer**: you have given an agent authority to trigger destructive operations, but any caller can impersonate it.

As AI agents gain the ability to drain Kubernetes nodes, delete pods, modify infrastructure, and execute financial transactions, this is not a theoretical risk. It is a deployment blocker.

---

## What We Built

A **zero-trust data plane for AI agents** — the same architectural principles that secure service meshes in cloud-native infrastructure, applied specifically to agent-to-agent communication.

The platform enforces three planes:

| Plane | Component | Responsibility |
|---|---|---|
| **Control Plane** | AgentControlPlane + Consul | Dynamic agent service discovery → Envoy cluster config (CDS) |
| **Data Plane** | Envoy (AgentSidecar) | JWT authn · rate limiting · OPA ext_authz · header injection |
| **Policy Plane** | Open Policy Agent | Chain routing rules · live policy toggle without restart |

---

## Architecture

```
Browser
   │  Authorization: Bearer <user-jwt>
   ▼
nginx (ChatAIAgent)
   │
   ▼
Envoy AgentSidecar ──── JWKS ──── AuthService
   │                         POST /auth/token/exchange
   │                         ← OBO token (act.sub=sre-agent, aud=remediation-agent)
   │
   ├─ [filter 1] local_ratelimit      — IP-level DoS protection
   ├─ [filter 2] header_mutation      — strip x-calling-agent from ALL requests
   ├─ [filter 3] jwt_authn            — verify JWT signature, inject x-calling-agent
   │                                    from calling_agent claim (OBO tokens only)
   ├─ [filter 4] ratelimit            — per-user quota via Redis
   ├─ [filter 5] ext_authz (OPA)      — chain rule enforcement
   └─ [filter 6] router               — forward to dynamically-discovered agent cluster
```

Agent clusters are not statically configured. **Consul** watches Docker socket labels to auto-register agents as they start. **AgentControlPlane** polls Consul and writes `cds.yaml` atomically — Envoy hot-reloads clusters via inotify with zero downtime.

---

## The Core Innovation: OAuth 2.0 On-Behalf-Of for Agent Chaining

RFC 8693 (Token Exchange) defines On-Behalf-Of (OBO) flows for delegated identity in human-to-service chains. We extend this to **agent-to-agent chains**.

When sre-agent decides to invoke remediation-agent:

**Step 1 — Token Exchange**
sre-agent calls `POST /auth/token/exchange` with the user's JWT as the assertion:

```http
POST /auth/token/exchange
{
  "assertion": "<user-jwt>",
  "scope": "remediation-agent",
  "calling_agent": "sre-agent"
}
```

**Step 2 — AuthService issues the OBO token**

Signed with RS256, short TTL (5 minutes), carrying:
```json
{
  "sub": "user-123",
  "act": { "sub": "sre-agent" },
  "calling_agent": "sre-agent",
  "aud": "remediation-agent",
  "exp": "<now + 5min>"
}
```

**Step 3 — Envoy enforces at the data plane**

- `header_mutation` **strips** any `x-calling-agent` header the caller sent — forged values are removed unconditionally
- `jwt_authn` validates the OBO signature against AuthService's JWKS and **injects** `x-calling-agent` from the `calling_agent` claim
- `ext_authz` sends the request to OPA, which evaluates:

```rego
routing_allowed if {
    input.attributes.request.http.headers["x-target-agent"] == "remediation-agent"
    input.attributes.request.http.headers["x-calling-agent"] == "sre-agent"
    data.routing.chain_enabled == true
}
```

The `x-calling-agent` header that OPA reads was placed there by Envoy from a cryptographically verified token — not by the caller. A forged header is stripped in filter 2. It only reappears if AuthService signed a token containing that claim.

**What this means**: a human calling `/remediation/graph/invoke` directly — even with a valid user JWT — gets `403`. Their token has no `calling_agent` claim, so `x-calling-agent` is never injected, and OPA denies. Destructive operations are unreachable without a verified agent-chain token at the data plane.

---

## Live Demo: OOM Alert in Production

**Scenario**: A memory leak in the payment-service is causing OOM kills, pod restarts, and SLA breaches.

### Step 1 — User alerts the SRE Agent
The user sends an alert through the UI. The request passes through Envoy: JWT validated, `x-target-agent: sre-agent` injected by header_mutation, OPA allows (sre-agent is the primary entry point for any authenticated user).

### Step 2 — SRE Agent produces findings
```
CPU 94% on node-prod-3
Heap OOM pattern detected in payment-service
3 pod restarts in last 15 min
p99 latency 4.2s (SLA breach)
Root cause: memory leak in payment-processor container
Recommendation: terminate affected pods, drain the node
```

### Step 3 — Policy Gate is DENY
`chain_enabled = false` in OPA. The SRE Agent exchanges the user JWT for an OBO token and calls `/remediation/graph/invoke` via Envoy. OPA denies: `chain_enabled` is false. The UI shows the Policy Gate locked. The user cannot proceed, even though the OBO token is cryptographically valid.

### Step 4 — Operator unlocks the Policy Gate
The operator flips the toggle in the UI:
```http
PUT /control/policy/chain-rule
{ "enabled": true }
```
AgentControlPlane calls OPA's data API (`PUT /v1/data/routing/chain_enabled`). Takes effect immediately — no OPA restart, no Envoy restart.

### Step 5 — Chain succeeds
The OBO token flows through Envoy. `x-calling-agent: sre-agent` is injected by jwt_authn. OPA allows. The Remediation Agent generates a structured plan:

| Step | Action | Risk |
|---|---|---|
| 1 | `kubectl cordon node-prod-3` | SAFE |
| 2 | `kubectl top pods -n production` | SAFE |
| 3 | `kubectl delete pod payment-processor-7d9f -n production` | DESTRUCTIVE |
| 4 | `kubectl scale deploy payment-service --replicas=0 -n production` | DESTRUCTIVE |
| 5 | `kubectl drain node-prod-3 --ignore-daemonsets` | DESTRUCTIVE |

SAFE steps execute. DESTRUCTIVE steps require human approval before execution.

---

## Zero-Trust Properties Demonstrated

| Threat | Mitigation |
|---|---|
| Forged `x-calling-agent` header | Stripped by `header_mutation` before jwt_authn runs |
| Self-reported agent identity | Replaced by Envoy-injected identity from verified JWT claim |
| Direct human access to destructive ops | User JWT has no `calling_agent` claim → `x-calling-agent` absent → OPA denies |
| Chain enabled without operator approval | `chain_enabled = false` by default; toggled live via AgentControlPlane |
| Replay of an OBO token | 5-minute expiry; scoped to a single target agent (`aud: remediation-agent`) |
| New agent registered without code changes | Docker label + Consul auto-registration; Envoy CDS hot-reload |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Agent runtime | FastAPI · LangGraph · Anthropic Claude (Sonnet + Haiku) |
| Data plane | Envoy Proxy v1.31 (jwt_authn · ext_authz · header_mutation · local_ratelimit) |
| Policy engine | Open Policy Agent (rego) |
| Control plane | Consul 1.19 · Python (Docker socket watcher → Envoy CDS) |
| Identity | AuthService — RS256 JWT issuance + RFC 8693 OBO token exchange |
| Rate limiting | envoy-ratelimit · Redis |
| UI | React · Vite · TailwindCSS · nginx |
| Observability | Jaeger (OTLP tracing) |
| Orchestration | Docker Compose |

---

## What Makes This OSS-Native

Every component in this stack is open source:

- **Envoy** — data plane enforcement, no vendor lock-in
- **OPA** — policy as code, version-controlled rego
- **Consul** — service discovery without a managed control plane
- **Anthropic Claude** — via the open Anthropic SDK
- **RFC 8693** — open IETF standard for token exchange, not a proprietary protocol

The pattern is portable: swap Consul for etcd, swap Envoy for another xDS-compatible proxy, swap OPA for another ext_authz server. The security model holds because it lives at the data plane, not inside any agent.

---

## Repos

| Repo | Description |
|---|---|
| `AgenticFrmk/ChatAIAgent` | Demo UI · SRE Agent · Remediation Agent · nginx · docker-compose |
| `AgenticFrmk/AgentSidecar` | Envoy config · OPA rego · ratelimit config |
| `AgenticFrmk/AgentControlPlane` | Consul → Envoy CDS bridge · live policy API |
| `AgenticFrmk/AuthService` | RS256 JWT issuance · RFC 8693 OBO token exchange |

---

*Built for OSS4AI Hackathon 2026*
