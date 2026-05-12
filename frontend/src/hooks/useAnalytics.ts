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

export interface TimeRange {
  from: Date
  to: Date
}

export function last30Days(): TimeRange {
  const to = new Date()
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  return { from, to }
}

function buildParams(range: TimeRange, extra?: Record<string, string | number>) {
  const p = new URLSearchParams({
    from_dt: range.from.toISOString(),
    to_dt: range.to.toISOString(),
    ...Object.fromEntries(
      Object.entries(extra ?? {}).map(([k, v]) => [k, String(v)])
    ),
  })
  return p.toString()
}

export function useAnalytics(agentId: string, range: TimeRange) {
  const [roi, setRoi] = useState<RoiSummary | null>(null)
  const [perf, setPerf] = useState<PerfSummary | null>(null)
  const [runs, setRuns] = useState<RunPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = buildParams(range)
    const runsParams = buildParams(range, { page: 1, size: 10 })

    Promise.all([
      fetch(`/api/agent-perf/${agentId}/roi?${params}`).then(r => {
        if (r.status === 503) return null
        if (!r.ok) throw new Error(`roi ${r.status}`)
        return r.json() as Promise<RoiSummary>
      }),
      fetch(`/api/agent-perf/${agentId}/perf?${params}`).then(r => {
        if (r.status === 503) return null
        if (!r.ok) throw new Error(`perf ${r.status}`)
        return r.json() as Promise<PerfSummary>
      }),
      fetch(`/api/agent-perf/${agentId}/runs?${runsParams}`).then(r => {
        if (r.status === 503) return null
        if (!r.ok) throw new Error(`runs ${r.status}`)
        return r.json() as Promise<RunPage>
      }),
    ])
      .then(([roiData, perfData, runsData]) => {
        setRoi(roiData)
        setPerf(perfData)
        setRuns(runsData)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [agentId, range.from.toISOString(), range.to.toISOString()])

  return { roi, perf, runs, loading, error }
}
