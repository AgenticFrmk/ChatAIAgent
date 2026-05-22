/**
 * Pact consumer tests: ChatAiAgent → SLMPlatform
 *
 * The useAnalytics hook calls three SLMPlatform endpoints via the nginx
 * /api/agent-perf/ proxy. nginx strips the /api prefix, so the SLMPlatform
 * sees /agent-perf/{agentId}/roi|perf|runs.
 *
 * These tests mock SLMPlatform directly (not nginx) and verify that:
 *   - The hook hits the correct paths with from_dt / to_dt query params
 *   - The response shapes match what RoiPanel, AgentPerfPanel, RunHistoryTable
 *     actually consume
 *
 * If SLMPlatform renames a field (e.g. mttr_seconds → mean_mttr), the
 * provider verification of this pact will fail before the frontend ships.
 *
 * Generates pacts/ChatAiAgent-SLMPlatform.json.
 *
 * Run locally:  npm run test:pact
 */
import path from "path"
import { PactV3, MatchersV3 } from "@pact-foundation/pact"
import { describe, it, expect } from "vitest"

const { like, eachLike, number, string } = MatchersV3

const MOCK_PORT = 9006
const PACT_DIR = path.resolve(__dirname, "../../../pacts")

const FROM_DT = "2026-04-13T00:00:00.000Z"
const TO_DT   = "2026-05-13T00:00:00.000Z"

const provider = new PactV3({
  consumer: "ChatAiAgent",
  provider: "SLMPlatform",
  dir: PACT_DIR,
  port: MOCK_PORT,
})

// ── helpers ───────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

function perfUrl(baseUrl: string, agentId: string, endpoint: string, extra: Record<string, string> = {}) {
  const p = new URLSearchParams({ from_dt: FROM_DT, to_dt: TO_DT, ...extra })
  return `${baseUrl}/agent-perf/${agentId}/${endpoint}?${p}`
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("ChatAiAgent → SLMPlatform pact", () => {
  const AGENT_ID = "chat-ai-agent"

  it("GET /agent-perf/{id}/roi returns RoiSummary", () =>
    provider.addInteraction({
      states: [{ description: "run metrics exist for agent chat-ai-agent" }],
      uponReceiving: "a ROI summary request for chat-ai-agent",
      withRequest: {
        method: "GET",
        path: `/agent-perf/${AGENT_ID}/roi`,
        query: { from_dt: FROM_DT, to_dt: TO_DT },
      },
      willRespondWith: {
        status: 200,
        headers: { "Content-Type": like("application/json") },
        body: {
          mttr_seconds:               like(320.5),
          mttr_delta_pct:             like(-18.2),
          autonomous_resolution_rate: like(0.82),
          escalation_rate:            like(0.05),
          engineer_hours_saved:       like(4.2),
          false_action_rate:          like(0.01),
          run_count:                  like(37),
        },
      },
    }).executeTest(async (mockServer) => {
      const roi = await fetchJson<Record<string, number>>(
        perfUrl(mockServer.url, AGENT_ID, "roi"),
      )
      expect(typeof roi.mttr_seconds).toBe("number")
      expect(typeof roi.autonomous_resolution_rate).toBe("number")
      expect(typeof roi.run_count).toBe("number")
    }))

  it("GET /agent-perf/{id}/perf returns PerfSummary", () =>
    provider.addInteraction({
      states: [{ description: "run metrics exist for agent chat-ai-agent" }],
      uponReceiving: "a performance summary request for chat-ai-agent",
      withRequest: {
        method: "GET",
        path: `/agent-perf/${AGENT_ID}/perf`,
        query: { from_dt: FROM_DT, to_dt: TO_DT },
      },
      willRespondWith: {
        status: 200,
        headers: { "Content-Type": like("application/json") },
        body: {
          plan_accuracy:          like(0.91),
          step_efficiency:        like(0.88),
          avg_latency_ms:         like({ intent: 210.0, plan: 540.0, execution: 1800.0 }),
          confidence_calibration: like(0.79),
          retry_rate:             like(0.04),
          run_count:              like(37),
        },
      },
    }).executeTest(async (mockServer) => {
      const perf = await fetchJson<Record<string, unknown>>(
        perfUrl(mockServer.url, AGENT_ID, "perf"),
      )
      expect(typeof perf.plan_accuracy).toBe("number")
      expect(typeof perf.step_efficiency).toBe("number")
      expect(perf.avg_latency_ms).toBeDefined()
    }))

  it("GET /agent-perf/{id}/runs returns RunPage with RunRecords", () =>
    provider.addInteraction({
      states: [{ description: "run metrics exist for agent chat-ai-agent" }],
      uponReceiving: "a paginated run history request for chat-ai-agent",
      withRequest: {
        method: "GET",
        path: `/agent-perf/${AGENT_ID}/runs`,
        query: { from_dt: FROM_DT, to_dt: TO_DT, page: "1", size: "50" },
      },
      willRespondWith: {
        status: 200,
        headers: { "Content-Type": like("application/json") },
        body: {
          runs: eachLike({
            run_id:          like("run-abc123"),
            timestamp:       like("2026-05-13T02:11:51+00:00"),
            mttr_seconds:    like(312.0),
            resolution_type: like("autonomous"),
            plan_accurate:   like(true),
            step_efficiency: like(0.86),
            outcome:         like("resolved"),
          }),
          total: like(37),
          page:  like(1),
          size:  like(50),
        },
      },
    }).executeTest(async (mockServer) => {
      const page = await fetchJson<{ runs: unknown[]; total: number; page: number }>(
        perfUrl(mockServer.url, AGENT_ID, "runs", { page: "1", size: "50" }),
      )
      expect(Array.isArray(page.runs)).toBe(true)
      expect(page.runs.length).toBeGreaterThan(0)
      const run = page.runs[0] as Record<string, unknown>
      expect(typeof run.run_id).toBe("string")
      expect(typeof run.mttr_seconds).toBe("number")
      expect(typeof run.outcome).toBe("string")
      expect(typeof page.total).toBe("number")
    }))

  it("GET /agent-perf/{id}/roi returns empty summary when no runs exist", () =>
    provider.addInteraction({
      states: [{ description: "no run metrics exist for agent chat-ai-agent" }],
      uponReceiving: "a ROI summary request for chat-ai-agent with no data",
      withRequest: {
        method: "GET",
        path: `/agent-perf/${AGENT_ID}/roi`,
        query: { from_dt: FROM_DT, to_dt: TO_DT },
      },
      willRespondWith: {
        status: 200,
        body: {
          mttr_seconds:               like(0),
          mttr_delta_pct:             like(0),
          autonomous_resolution_rate: like(0),
          escalation_rate:            like(0),
          engineer_hours_saved:       like(0),
          false_action_rate:          like(0),
          run_count:                  like(0),
        },
      },
    }).executeTest(async (mockServer) => {
      const roi = await fetchJson<Record<string, number>>(
        perfUrl(mockServer.url, AGENT_ID, "roi"),
      )
      // zero values are valid — the hook must not crash on empty data
      expect(typeof roi.run_count).toBe("number")
    }))
})
