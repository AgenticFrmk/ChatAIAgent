> **Cross-service work:** Read `CONTRACT.md` (this service's interface) and `../platform/SERVICE_CONTRACTS.md` (full stack map) before touching any inter-service boundary.
> **Scalability:** Follow **Rule Set A** in `../platform/SCALABILITY_RULES.md` (nginx is stateless; no app-layer state).
> **API changes:** Before any route or schema change, open `../platform/API_CHANGE_PROTOCOL.md` and execute the mandatory checklist at the top.
> **Event contract:** Any change to `eventMapper.ts` event handling — must update `../platform/EVENT_CONTRACTS.md` and all three parties (sre-agent, Envoy, ChatAiAgent) in the same PR.

# Project: ChatAiAgent

## What this project is
The integration layer for the AgenticFrmk stack. Contains:
- React SPA (chat UI + analytics + billing + registry portal link)
- nginx reverse proxy that wires the browser to all backend services
- Docker Compose that brings up the full stack

## Tech Stack
- Frontend: React + Vite + TailwindCSS + react-router-dom
- Proxy: nginx (template at `nginx/nginx.conf.template`)
- Orchestration: Docker Compose (`docker-compose.yml`)

## Key files
- `nginx/nginx.conf.template` — all proxy routes; env vars substituted at container start
- `docker-compose.yml` — full stack definition; authoritative source for service URLs and env vars
- `frontend/src/lib/gateway.ts` — all API calls to sre-agent (via Envoy sidecar)
- `frontend/src/hooks/` — data fetching hooks

## Architecture (Phase 3)
All agent API calls go: `browser → nginx → Envoy (:10000) → sre-agent (:8080)`

Envoy handles JWT authn (jwt_authn filter + JWKS from AuthService), rate limiting (local + per-user via Redis), and OPA ext_authz (session ownership + input safety). AgentGateway has been removed.

## Key env vars (nginx container)
```
ENVOY_URL             http://envoy:10000
AUTH_SERVICE_URL      http://auth-service:9000
SLM_PLATFORM_URL      http://slm-platform:8080
REGISTRY_SERVICE_URL  http://registry-service:8001
```

## Frontend API base URLs
| Client | Env var | Docker | Local dev |
|---|---|---|---|
| gateway.ts | `VITE_GATEWAY_URL` | `/gateway` | `http://localhost:10000` |

## Public contract
See `../platform/SERVICE_CONTRACTS.md` — nginx proxy routes and UI clients sections.
