import { useEffect, useState } from 'react'
import { getHistory } from '../lib/gateway'

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

function toRunPage(rows: Record<string, unknown>[], range: TimeRange): RunPage {
  const from = range.from.getTime()
  const to   = range.to.getTime()

  const filtered = rows.filter(r => {
    const ts = new Date(r['created_at'] as string).getTime()
    return ts >= from && ts <= to
  })

  const runs: RunRecord[] = filtered.map(r => {
    const toolResults = (r['tool_results'] as Record<string, Record<string, unknown>> | null) ?? {}
    const total = Object.keys(toolResults).length
    const succeeded = Object.values(toolResults).filter(v => v['status'] === 'completed').length
    return {
      run_id:          String(r['plan_id'] ?? ''),
      timestamp:       String(r['created_at'] ?? ''),
      mttr_seconds:    0,
      resolution_type: r['outcome'] === 'COMPLETED' ? 'autonomous' : 'failed',
      plan_accurate:   r['outcome'] === 'COMPLETED',
      step_efficiency: total > 0 ? succeeded / total : 0,
      outcome:         r['outcome'] === 'COMPLETED' ? 'resolved' : 'failed',
    }
  })

  return { runs, total: runs.length, page: 1, size: runs.length }
}

export function useAnalytics(_agentId: string, range: TimeRange, token: string | null = null) {
  const [roi, setRoi]   = useState<RoiSummary | null>(null)
  const [perf, setPerf] = useState<PerfSummary | null>(null)
  const [runs, setRuns] = useState<RunPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    setLoading(true)
    setError(null)

    getHistory(token)
      .then(rows => {
        setRuns(toRunPage(rows, range))
        setRoi(null)
        setPerf(null)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [range.from.toISOString(), range.to.toISOString()])

  return { roi, perf, runs, loading, error }
}
