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

## Live Demo: VPN Tunnel Down at Branch Office

**Scenario**: The VPN tunnel `vpn-hq-001` on router `BRANCH-BOSTON-R01` (Cradlepoint IBR1700) is down and flapping. The network engineer reports 7 tunnel resets in the last hour with `ICMP_FRAG_NEEDED` errors. Connectivity to HQ is intermittent.

### Step 1 — Engineer alerts the SRE Agent
The engineer types the incident into the chat UI. The request flows through Envoy: JWT validated, `x-target-agent: sre-agent` injected by header_mutation, OPA allows (sre-agent is the primary entry point for any authenticated user).

### Step 2 — SRE Agent investigates via NCM API
The agent calls the Cradlepoint NCM API tools in sequence — checking router status, WAN telemetry, and tunnel alerts:

```
Router BRANCH-BOSTON-R01 (IBR1700) — state: online, firmware: 7.22.40
WAN signal: RSRP -88 dBm, SINR 14.2 dB, signal_percent: 75% (LTE/AT&T)
Tunnel alert: vpn-hq-001 — ICMP_FRAG_NEEDED, MTU 1500, flap_count: 7
Root cause: MTU mismatch causing IP fragmentation on LTE uplink
Fix: set MTU 1372 with MSS clamping at 1332, reboot modem to renegotiate tunnel
```

### Step 3 — Policy Gate is DENY
By default `chain_enabled = false` in OPA. The SRE Agent exchanges the user JWT for a 5-minute OBO token and calls `/remediation/graph/invoke` via Envoy. OPA denies: `chain_enabled` is false.

The chat shows:
```
⛔ Remediation blocked by OPA (DENY) — view policy details →
```
The Remediation page confirms the block. The engineer cannot push config changes to the router — even though the OBO token is cryptographically valid — because the admin has not authorized automated remediation.

### Step 4 — Admin unlocks the Policy Gate
The admin opens the Policy page in the UI and flips the toggle:
```http
PUT /control/policy/chain-rule
{ "enabled": true }
```
AgentControlPlane calls OPA's data API (`PUT /v1/data/routing/chain_enabled`). Takes effect immediately — no OPA restart, no Envoy restart, no redeployment.

### Step 5 — Chain succeeds, plan streams live
The engineer re-runs the query. The OBO token flows through Envoy. `x-calling-agent: sre-agent` is injected by jwt_authn from the verified token claim. OPA allows. The Remediation Agent generates a structured plan — tokens stream live to the Remediation page as they are produced:

| Step | Action | Risk |
|---|---|---|
| 1 | `GET /ncm/api/v2/router_alerts/` — confirm tunnel alert active | SAFE |
| 2 | `POST /ncm/api/v2/reboot_activity/` — reboot modem on BRANCH-BOSTON-R01 | SAFE |
| 3 | `PATCH /ncm/api/v2/configuration_managers/550e8400-0001/` — set MTU 1372, MSS clamp 1332 | DESTRUCTIVE |

SAFE steps are described in the plan. DESTRUCTIVE steps are flagged for human review before execution. The tunnel renegotiates and clears.

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
