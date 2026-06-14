import type { PerfSummary } from '../../hooks/useAnalytics'
import MetricTooltip from './MetricTooltip'

interface Props {
  perf: PerfSummary | null
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`
}

function efficiencyColor(value: number, max?: number) {
  if (max === undefined) return 'text-gray-900'
  if (value <= 1.2) return 'text-green-600'
  if (value <= max) return 'text-amber-500'
  return 'text-red-500'
}

function PerfRow({ label, value, sub, tooltip }: { label: string; value: React.ReactNode; sub?: string; tooltip?: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-200 last:border-0">
      <span className="text-sm text-gray-600 flex items-center">
        {label}
        {tooltip && <MetricTooltip text={tooltip} />}
      </span>
      <div className="text-right">
        <span className="font-mono text-gray-900 text-sm">{value}</span>
        {sub && <div className="text-xs text-gray-600 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function BarGauge({ value, threshold }: { value: number; threshold?: number }) {
  const pctFill = Math.min(value * 100, 100)
  const color = threshold !== undefined && value >= threshold ? 'bg-green-500' : 'bg-amber-400'
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-gray-200 rounded overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${pctFill}%` }} />
      </div>
      <span className="font-mono text-gray-900 text-sm">{pct(value)}</span>
      {threshold !== undefined && (
        <span className="text-xs text-gray-600">min {pct(threshold)}</span>
      )}
    </div>
  )
}

export default function AgentPerfPanel({ perf }: Props) {
  if (!perf || perf.run_count === 0) {
    return (
      <div className="flex-1 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-widest mb-4">Agent Performance</h2>
        <p className="text-gray-600 text-sm">No runs in this time range.</p>
      </div>
    )
  }

  const lat = perf.avg_latency_ms
  const totalLatMs = (lat.intent ?? 0) + (lat.plan ?? 0) + (lat.execution ?? 0)

  return (
    <div className="flex-1 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-widest mb-4">
        Agent Performance
        <span className="ml-2 text-gray-600 normal-case font-normal">{perf.run_count} runs</span>
      </h2>
      <div className="flex flex-col">
        <PerfRow
          label="Plan Accuracy"
          value={<BarGauge value={perf.plan_accuracy} />}
          tooltip="% of runs where the agent executed its proposed plan without deviation. Reported by AgentCore at run completion — a run is marked accurate when the executed tool sequence matched what was proposed in the plan step."
        />
        <PerfRow
          label="Step Efficiency"
          value={
            <span className={efficiencyColor(perf.step_efficiency)}>
              {perf.step_efficiency.toFixed(2)}×
            </span>
          }
          tooltip="actual_steps ÷ proposed_steps. 1.0× means the agent executed exactly the steps it planned. Higher means extra steps were taken. Green ≤1.2×, amber above that."
        />
        <PerfRow
          label="Avg Latency (total)"
          value={`${(totalLatMs / 1000).toFixed(1)}s`}
          sub={`intent ${(lat.intent / 1000).toFixed(1)}s · plan ${(lat.plan / 1000).toFixed(1)}s · exec ${(lat.execution / 1000).toFixed(1)}s`}
          tooltip="Total wall-clock time split across three LLM phases: intent (classify the request), plan (build the tool DAG), and execution (all tool calls combined). Breakdown shows each phase independently."
        />
        <PerfRow
          label="Confidence Calibration"
          value={<BarGauge value={perf.confidence_calibration} />}
          tooltip="Of runs where the agent self-reported high confidence (mean > 0.8), what % actually resolved? Measures whether high confidence is warranted — 100% means every high-confidence run succeeded."
        />
        <PerfRow
          label="Avg Retry Rate"
          value={perf.retry_rate.toFixed(2)}
          tooltip="Average number of tool call retries per run. A retry fires when a tool fails and is re-attempted. Lower is better — high retry rates indicate flaky tools or unstable infrastructure."
        />
      </div>
    </div>
  )
}
