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

const MOCK_ROI: RoiSummary = {
  mttr_seconds: 287,
  mttr_delta_pct: -68,
  autonomous_resolution_rate: 0.82,
  escalation_rate: 0.18,
  engineer_hours_saved: 41.5,
  false_action_rate: 0.03,
  run_count: 24,
}

const MOCK_PERF: PerfSummary = {
  plan_accuracy: 0.91,
  step_efficiency: 0.87,
  avg_latency_ms: { intent: 420, plan: 1840, execution: 3200 },
  confidence_calibration: 0.88,
  retry_rate: 0.06,
  run_count: 24,
}

const MOCK_RUNS: RunPage = {
  total: 4,
  page: 1,
  size: 10,
  runs: [
    { run_id: 'run-001', timestamp: new Date(Date.now() - 3600000).toISOString(),  mttr_seconds: 342, resolution_type: 'AUTONOMOUS', plan_accurate: true,  step_efficiency: 0.90, outcome: 'COMPLETED' },
    { run_id: 'run-002', timestamp: new Date(Date.now() - 86400000).toISOString(), mttr_seconds: 218, resolution_type: 'AUTONOMOUS', plan_accurate: true,  step_efficiency: 0.95, outcome: 'COMPLETED' },
    { run_id: 'run-003', timestamp: new Date(Date.now() - 172800000).toISOString(),mttr_seconds: 287, resolution_type: 'HITL',       plan_accurate: true,  step_efficiency: 0.82, outcome: 'COMPLETED' },
    { run_id: 'run-004', timestamp: new Date(Date.now() - 259200000).toISOString(),mttr_seconds: 95,  resolution_type: 'AUTONOMOUS', plan_accurate: false, step_efficiency: 0.60, outcome: 'FAILED' },
  ],
}

export function useAnalytics(agentId: string, range: TimeRange) {
  const [roi, setRoi] = useState<RoiSummary | null>(null)
  const [perf, setPerf] = useState<PerfSummary | null>(null)
  const [runs, setRuns] = useState<RunPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [demo, setDemo] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setDemo(false)
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
        const noData =
          (!roiData && !perfData && !runsData) ||
          ((roiData?.run_count ?? 0) === 0 && (perfData?.run_count ?? 0) === 0)
        if (noData) {
          setRoi(MOCK_ROI)
          setPerf(MOCK_PERF)
          setRuns(MOCK_RUNS)
          setDemo(true)
        } else {
          setRoi(roiData)
          setPerf(perfData)
          setRuns(runsData)
        }
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [agentId, range.from.toISOString(), range.to.toISOString()])

  return { roi, perf, runs, loading, error, demo }
}
