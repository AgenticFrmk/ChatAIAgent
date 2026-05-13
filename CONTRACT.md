# ChatAiAgent — Exposed Interface

ChatAiAgent exposes no service API. Its interface is the nginx proxy surface and the frontend client functions.

## nginx Proxy Routes (browser → port 3001)

| Browser path | Proxies to | Strips prefix |
|---|---|---|
| `POST /gateway/auth/token` | `auth-service:9000/auth/token` | yes |
| `/gateway/*` | `agent-gateway:8000/*` | `/gateway` |
| `/api/agent-perf/*` | `slm-platform:8080/agent-perf/*` | `/api` |
| `/api/registry/*` | `registry-service:8001/*` | `/api/registry` |
| `/registry/*` | `registry-service:8001/*` | `/registry` |
| `/*` (fallback) | static files → `index.html` | — |

Authorization header forwarded on `/gateway/*` only.

## Frontend client functions (`frontend/src/lib/gateway.ts`)

| Function | Method | Path | Auth |
|---|---|---|---|
| `login()` | POST | `/gateway/auth/token` | — |
| `invokeStream()` | POST | `/gateway/invoke/stream` | Bearer |
| `resumeStream()` | POST | `/gateway/resume/stream` | Bearer |
| `getEvents()` | GET | `/gateway/events/{thread_id}?from=` | Bearer |
| `getHistory()` | GET | `/gateway/history?limit=` | Bearer |
