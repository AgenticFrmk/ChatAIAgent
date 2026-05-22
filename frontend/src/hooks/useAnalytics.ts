import { useEffect, useState } from 'react'

export interface RoiSummary {
  mttr_seconds: number
  mttr_delta_pct: number
  autonomous_resolution_rate: number
  escalation_rate: number
  engineer_hours_saved: number
  false_action_rate: number
  run_count: number
}

export interface PerfSummary {
  plan_accuracy: number
  step_efficiency: number
  avg_latency_ms: { intent: number; plan: number; execution: number }
  confidence_calibration: number
  retry_rate: number
  run_count: number
}

export interface RunRecord {
  run_id: string
  timestamp: string
  mttr_seconds: number
  resolution_type: string
  plan_accurate: boolean
  step_efficiency: number
  outcome: string
}

export interface RunPage {
  runs: RunRecord[]
  total: number
  page: number
  size: number
}

export interface RAGASScores {
  faithfulness: number
  context_precision: number
  answer_relevancy: number
  evaluated_at: string
}

export interface RunDetail extends RunRecord {
  agent_id: string
  domain: string
  started_at: string
  finished_at: string
  step_count: number
  alert_state_final: string
  ragas_scores: RAGASScores | null
}

export interface TimeRange {
  from: Date
  to: Date
}

export function last30Days(): TimeRange {
  const to = new Date()
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  return { from, to }
}

const SLM_BASE = (import.meta.env.VITE_SLM_PLATFORM_URL as string | undefined) ?? '/api'

function perfUrl(agentId: string, endpoint: string, range: TimeRange, extra?: Record<string, string | number>) {
  const p = new URLSearchParams({
    from_dt: range.from.toISOString(),
    to_dt: range.to.toISOString(),
    ...Object.fromEntries(Object.entries(extra ?? {}).map(([k, v]) => [k, String(v)])),
  })
  return `${SLM_BASE}/agent-perf/${encodeURIComponent(agentId)}/${endpoint}?${p}`
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

const RAGAS_POLL_INTERVAL_MS = 5_000
const RAGAS_POLL_MAX_MS = 3 * 60 * 1_000  // stop polling after 3 minutes

function isRecentRun(finishedAt: string): boolean {
  return Date.now() - new Date(finishedAt).getTime() < RAGAS_POLL_MAX_MS
}

export function useRunDetail(
  agentId: string,
  runId: string | null,
  token: string | null,
) {
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!runId || !token) { setDetail(null); return }
    const resolvedRunId = runId
    let cancelled = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null

    async function fetch() {
      if (cancelled) return
      try {
        const data = await fetchJson<RunDetail>(
          `${SLM_BASE}/agent-perf/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(resolvedRunId)}`
        )
        if (!cancelled) {
          setDetail(data)
          setLoading(false)
          // Keep polling while scores are absent and the run is recent enough
          if (!data.ragas_scores && isRecentRun(data.finished_at)) {
            pollTimer = setTimeout(fetch, RAGAS_POLL_INTERVAL_MS)
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e))
          setLoading(false)
        }
      }
    }

    setLoading(true)
    setError(null)
    fetch()

    return () => {
      cancelled = true
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [agentId, runId, token])

  return { detail, loading, error }
}

export function useAnalytics(agentId: string, range: TimeRange, token: string | null = null) {
  const [roi, setRoi]   = useState<RoiSummary | null>(null)
  const [perf, setPerf] = useState<PerfSummary | null>(null)
  const [runs, setRuns] = useState<RunPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    setLoading(true)
    setError(null)

    Promise.all([
      fetchJson<RoiSummary>(perfUrl(agentId, 'roi', range)),
      fetchJson<PerfSummary>(perfUrl(agentId, 'perf', range)),
      fetchJson<RunPage>(perfUrl(agentId, 'runs', range, { page: 1, size: 50 })),
    ])
      .then(([roiData, perfData, runsData]) => {
        setRoi(roiData)
        setPerf(perfData)
        setRuns(runsData)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [agentId, range.from.toISOString(), range.to.toISOString(), token])

  return { roi, perf, runs, loading, error }
}
