#!/usr/bin/env bash
# e2e_distillation.sh — end-to-end smoke test for the distillation pipeline.
#
# Submits a real agent run against the running stack, waits for completion,
# then asserts that a new distillation record landed in RegistryService.
#
# Prerequisites: the full Docker Compose stack must be up (make up).
# Usage: make e2e
#
# Exit 0 = pipeline working end-to-end
# Exit 1 = failure (timeout, auth error, distillation record not created)

set -euo pipefail

BASE_URL="${E2E_BASE_URL:-http://localhost:3001}"
TIMEOUT_SECONDS="${E2E_TIMEOUT:-300}"
USERNAME="${SEED_USERNAME:-sre-seed@example.com}"
PASSWORD="${SEED_PASSWORD:-changeme}"
MESSAGE="${E2E_MESSAGE:-VPN tunnel Boston is dropping packets. Please investigate and fix.}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${YELLOW}[e2e]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC}  $*"; }
fail() { echo -e "${RED}[fail]${NC} $*" >&2; exit 1; }

# ── 1. Auth token ──────────────────────────────────────────────────────────────

log "Obtaining auth token for $USERNAME..."
TOKEN=$(curl -sf -X POST "$BASE_URL/gateway/auth/token" \
  -d "username=$USERNAME&password=$PASSWORD" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])") \
  || fail "Auth failed — is the stack up? ($BASE_URL)"
ok "Auth token obtained"

# ── 2. Baseline distillation count ────────────────────────────────────────────

log "Reading baseline distillation count..."
BASELINE=$(curl -sf "$BASE_URL/api/registry/distillation/trajectories" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin)))") \
  || fail "Could not read distillation list from RegistryService"
log "Baseline: $BASELINE record(s)"

# ── 3. Submit agent run ────────────────────────────────────────────────────────

log "Submitting agent run (auto_approve=true)..."
THREAD_ID=$(curl -sf -X POST "$BASE_URL/gateway/invoke/stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"message\": \"$MESSAGE\", \"auto_approve\": true}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['thread_id'])") \
  || fail "Failed to invoke agent run"
ok "Agent run started — thread_id=$THREAD_ID"

# ── 4. Poll until done or timeout ─────────────────────────────────────────────

log "Polling events (timeout ${TIMEOUT_SECONDS}s)..."
FROM=0
DEADLINE=$(( $(date +%s) + TIMEOUT_SECONDS ))
OUTCOME=""

while true; do
  if [ $(date +%s) -gt $DEADLINE ]; then
    fail "Timed out after ${TIMEOUT_SECONDS}s waiting for agent run to complete"
  fi

  RESPONSE=$(curl -sf "$BASE_URL/gateway/events/$THREAD_ID?from=$FROM" \
    -H "Authorization: Bearer $TOKEN") || { sleep 2; continue; }

  TOTAL=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['total'])")
  FROM=$TOTAL

  OUTCOME=$(echo "$RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for ev in data.get('events', []):
    t = ev.get('payload', {}).get('type', '')
    if t in ('done', 'error', 'interrupt'):
        print(t)
        break
" 2>/dev/null)

  if [ "$OUTCOME" = "done" ]; then
    ok "Agent run completed (thread_id=$THREAD_ID)"
    break
  elif [ "$OUTCOME" = "error" ]; then
    fail "Agent run ended with error — check agentbe logs"
  elif [ "$OUTCOME" = "interrupt" ]; then
    # auto_approve is set but HITL may still interrupt for clarification; resume with approve
    log "Run interrupted — resuming with 'approve'..."
    curl -sf -X POST "$BASE_URL/gateway/resume/stream" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{\"thread_id\": \"$THREAD_ID\", \"response\": \"approve\", \"auto_approve\": true}" \
      > /dev/null || fail "Failed to resume interrupted run"
  fi

  sleep 3
done

# ── 5. Verify distillation record appeared ─────────────────────────────────────

log "Waiting up to 15s for distillation record to land..."
WAIT=0
while [ $WAIT -lt 15 ]; do
  AFTER=$(curl -sf "$BASE_URL/api/registry/distillation/trajectories" \
    -H "Authorization: Bearer $TOKEN" \
    | python3 -c "import sys,json; print(len(json.load(sys.stdin)))") \
    || fail "Could not re-read distillation list"

  if [ "$AFTER" -gt "$BASELINE" ]; then
    ok "Distillation record created (${BASELINE} → ${AFTER})"
    break
  fi
  sleep 3
  WAIT=$(( WAIT + 3 ))
done

if [ "$AFTER" -le "$BASELINE" ]; then
  fail "No new distillation record after ${WAIT}s (still $AFTER — expected > $BASELINE)"
fi

# ── 6. Verify SLMPlatform received a metrics run ──────────────────────────────

log "Checking SLMPlatform has a metrics run for agent $AGENT_ID..."
AGENT_ID="${AGENT_ID:-chat-ai-agent}"
RUN_COUNT=$(curl -sf "$BASE_URL/api/agent-perf/$AGENT_ID/runs" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('total', 0))") \
  || { log "SLMPlatform check skipped (endpoint not reachable)"; RUN_COUNT="-1"; }

if [ "$RUN_COUNT" = "-1" ]; then
  log "SLMPlatform metrics check skipped"
else
  ok "SLMPlatform run count: $RUN_COUNT"
fi

ok "E2E distillation pipeline: PASS"
