import type { PerfSummary } from '../../hooks/useAnalytics'
import type { EvalContract } from '../../hooks/useEvalContract'

interface Props {
  perf: PerfSummary | null
  contract: EvalContract | null
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`
}

function efficiencyColor(value: number, max?: number) {
  if (max === undefined) return 'text-[#e6edf3]'
  if (value <= 1.2) return 'text-green-400'
  if (value <= max) return 'text-yellow-400'
  return 'text-red-400'
}

function PerfRow({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-[#1c2333] last:border-0">
      <span className="text-sm text-[#8b949e]">{label}</span>
      <div className="text-right">
        <span className="font-mono text-[#e6edf3] text-sm">{value}</span>
        {sub && <div className="text-xs text-[#484f58] mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function BarGauge({ value, threshold }: { value: number; threshold?: number }) {
  const pctFill = Math.min(value * 100, 100)
  const color = threshold !== undefined && value >= threshold ? 'bg-green-500' : 'bg-yellow-500'
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-[#161b22] rounded overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${pctFill}%` }} />
      </div>
      <span className="font-mono text-[#e6edf3] text-sm">{pct(value)}</span>
      {threshold !== undefined && (
        <span className="text-xs text-[#484f58]">min {pct(threshold)}</span>
      )}
    </div>
  )
}

export default function AgentPerfPanel({ perf, contract }: Props) {
  if (!perf || perf.run_count === 0) {
    return (
      <div className="flex-1 bg-[#0d1117] border border-[#1c2333] rounded-xl p-6">
        <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-widest mb-4">Agent Performance</h2>
        <p className="text-[#484f58] text-sm">No runs in this time range.</p>
      </div>
    )
  }

  const lat = perf.avg_latency_ms
  const totalLatMs = (lat.intent ?? 0) + (lat.plan ?? 0) + (lat.execution ?? 0)

  return (
    <div className="flex-1 bg-[#0d1117] border border-[#1c2333] rounded-xl p-6">
      <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-widest mb-4">
        Agent Performance
        <span className="ml-2 text-[#484f58] normal-case font-normal">{perf.run_count} runs</span>
      </h2>
      <div className="flex flex-col">
        <PerfRow
          label="Plan Accuracy"
          value={
            <BarGauge
              value={perf.plan_accuracy}
              threshold={contract?.min_plan_accuracy}
            />
          }
        />
        <PerfRow
          label="Step Efficiency"
          value={
            <span className={efficiencyColor(perf.step_efficiency, contract?.max_step_efficiency)}>
              {perf.step_efficiency.toFixed(2)}×
            </span>
          }
          sub={contract ? `max ${contract.max_step_efficiency}×` : undefined}
        />
        <PerfRow
          label="Avg Latency (total)"
          value={`${(totalLatMs / 1000).toFixed(1)}s`}
          sub={`intent ${(lat.intent / 1000).toFixed(1)}s · plan ${(lat.plan / 1000).toFixed(1)}s · exec ${(lat.execution / 1000).toFixed(1)}s`}
        />
        <PerfRow
          label="Confidence Calibration"
          value={
            <BarGauge
              value={perf.confidence_calibration}
              threshold={contract?.min_confidence_calibration}
            />
          }
        />
        <PerfRow
          label="Avg Retry Rate"
          value={perf.retry_rate.toFixed(2)}
          sub={contract ? `max ${contract.max_retry_rate}` : undefined}
        />
      </div>
    </div>
  )
}
