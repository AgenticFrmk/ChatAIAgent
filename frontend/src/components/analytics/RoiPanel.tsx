import type { RoiSummary } from '../../hooks/useAnalytics'
import type { EvalContract } from '../../hooks/useEvalContract'

interface Props {
  roi: RoiSummary | null
  contract: EvalContract | null
}

function fmt(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function DeltaBadge({ delta }: { delta: number }) {
  const improved = delta < 0
  const color = improved ? 'text-green-400' : 'text-red-400'
  const sign = improved ? '↓' : '↑'
  return (
    <span className={`text-xs font-mono ml-2 ${color}`}>
      {sign} {Math.abs(delta).toFixed(1)}%
    </span>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="bg-[#161b22] border border-[#1c2333] rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs text-[#484f58] uppercase tracking-widest">{label}</span>
      <span className="text-2xl font-mono font-bold text-[#e6edf3]">{value}</span>
      {sub && <span className="text-xs text-[#6e7681]">{sub}</span>}
    </div>
  )
}

export default function RoiPanel({ roi, contract }: Props) {
  if (!roi || roi.run_count === 0) {
    return (
      <div className="flex-1 bg-[#0d1117] border border-[#1c2333] rounded-xl p-6">
        <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-widest mb-4">ROI Metrics</h2>
        <p className="text-[#484f58] text-sm">No runs in this time range.</p>
      </div>
    )
  }

  const falseActColor =
    contract && roi.false_action_rate > contract.false_action_threshold
      ? 'text-red-400'
      : 'text-[#e6edf3]'

  return (
    <div className="flex-1 bg-[#0d1117] border border-[#1c2333] rounded-xl p-6">
      <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-widest mb-4">
        ROI Metrics
        <span className="ml-2 text-[#484f58] normal-case font-normal">{roi.run_count} runs</span>
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="MTTR"
          value={
            <>
              {fmt(roi.mttr_seconds)}
              <DeltaBadge delta={roi.mttr_delta_pct} />
            </>
          }
          sub={contract ? `baseline ${fmt(contract.mttr_baseline_seconds)}` : undefined}
        />
        <MetricCard
          label="Autonomous Resolution"
          value={pct(roi.autonomous_resolution_rate)}
          sub={`${pct(roi.escalation_rate)} escalated`}
        />
        <MetricCard
          label="Eng-Hours Saved"
          value={roi.engineer_hours_saved.toFixed(1)}
          sub="hours (cumulative)"
        />
        <MetricCard
          label="False Action Rate"
          value={<span className={falseActColor}>{pct(roi.false_action_rate)}</span>}
          sub={contract ? `threshold ${pct(contract.false_action_threshold)}` : undefined}
        />
      </div>
    </div>
  )
}
