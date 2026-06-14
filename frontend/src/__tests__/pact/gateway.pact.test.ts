/**
 * Pact consumer tests: ChatAiAgent → sre-agent (via Envoy)
 *
 * Documents the HTTP contract the frontend expects from sre-agent / Envoy.
 * Mirrors the four functions in src/lib/gateway.ts:
 *   login()        → POST /auth/token   (AuthService via nginx, NOT Envoy)
 *   invokeStream() → POST /graph/invoke/stream
 *   getEvents()    → GET  /events/{threadId}?from=N
 *   getHistory()   → GET  /history?limit=N
 *
 * Generates pacts/ChatAiAgent-sre-agent.json.
 *
 * Run locally:  npm run test:pact
 * CI:           api-contracts.yml calls this; pact.json is published to Pactflow.
 */
import path from "path"
import { PactV3, MatchersV3 } from "@pact-foundation/pact"
import { describe, it, expect } from "vitest"

const { like, eachLike } = MatchersV3

const MOCK_PORT = 9005
const PACT_DIR = path.resolve(__dirname, "../../../pacts")

const provider = new PactV3({
  consumer: "ChatAiAgent",
  provider: "sre-agent",
  dir: PACT_DIR,
  port: MOCK_PORT,
})

// ── helpers (mirror gateway.ts logic against a configurable base URL) ─────────

async function login(baseUrl: string, username: string, password: string): Promise<string> {
  const body = new URLSearchParams({ username, password, grant_type: "password" })
  const res = await fetch(`${baseUrl}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}

async function invokeStream(baseUrl: string, token: string, message: string): Promise<string> {
  const threadId = "thread-" + Math.random().toString(36).slice(2)
  const res = await fetch(`${baseUrl}/graph/invoke/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, thread_id: threadId, auth: {}, auto_approve: false }),
  })
  const json = (await res.json()) as { thread_id: string }
  return json.thread_id
}

async function getEvents(
  baseUrl: string,
  token: string,
  threadId: string,
  fromIndex: number,
): Promise<{ events: unknown[]; total: number }> {
  const res = await fetch(
    `${baseUrl}/events/${encodeURIComponent(threadId)}?from=${fromIndex}`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
  )
  return res.json()
}

async function getHistory(
  baseUrl: string,
  token: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${baseUrl}/history?limit=${limit}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  })
  return res.json()
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("ChatAiAgent → sre-agent pact", () => {
  it("login returns an access token", () =>
    provider.addInteraction({
      states: [{ description: "valid user credentials exist" }],
      uponReceiving: "a login request with valid credentials",
      withRequest: {
        method: "POST",
        path: "/auth/token",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "username=alice&password=secret&grant_type=password",
      },
      willRespondWith: {
        status: 200,
        headers: { "Content-Type": like("application/json") },
        body: { access_token: like("eyJ..."), token_type: like("bearer") },
      },
    }).executeTest(async (mockServer) => {
      const token = await login(mockServer.url, "alice", "secret")
      expect(typeof token).toBe("string")
      expect(token.length).toBeGreaterThan(0)
    }))

  it("invokeStream returns a thread_id", () =>
    provider.addInteraction({
      states: [{ description: "sre-agent graph is ready" }],
      uponReceiving: "an invoke stream request",
      withRequest: {
        method: "POST",
        path: "/graph/invoke/stream",
        headers: {
          "Content-Type": like("application/json"),
          Authorization: like("Bearer eyJ..."),
        },
        body: { message: "hello", thread_id: like("thread-abc"), auth: like({}), auto_approve: false },
      },
      willRespondWith: {
        status: 202,
        body: { thread_id: like("thread-abc") },
      },
    }).executeTest(async (mockServer) => {
      const threadId = await invokeStream(mockServer.url, "eyJ...", "hello")
      expect(typeof threadId).toBe("string")
      expect(threadId.length).toBeGreaterThan(0)
    }))

  it("getEvents returns events and total", () =>
    provider.addInteraction({
      states: [{ description: "events exist for thread t-1" }],
      uponReceiving: "a get events request from index 0",
      withRequest: {
        method: "GET",
        path: "/events/t-1",
        query: { from: "0" },
        headers: { Authorization: like("Bearer eyJ...") },
      },
      willRespondWith: {
        status: 200,
        body: {
          events: eachLike({ index: like(0), payload: like({ type: "done" }) }),
          total: like(1),
        },
      },
    }).executeTest(async (mockServer) => {
      const result = await getEvents(mockServer.url, "eyJ...", "t-1", 0)
      expect(result.events).toBeDefined()
      expect(Array.isArray(result.events)).toBe(true)
      expect(typeof result.total).toBe("number")
    }))

  it("getHistory returns a list of plan history entries", () =>
    provider.addInteraction({
      states: [{ description: "plan history exists" }],
      uponReceiving: "a get history request with limit 100",
      withRequest: {
        method: "GET",
        path: "/history",
        query: { limit: "100" },
        headers: { Authorization: like("Bearer eyJ...") },
      },
      willRespondWith: {
        status: 200,
        body: eachLike({ plan_id: like("uuid"), domain: like("connectivity") }),
      },
    }).executeTest(async (mockServer) => {
      const history = await getHistory(mockServer.url, "eyJ...", 100)
      expect(Array.isArray(history)).toBe(true)
    }))
})
