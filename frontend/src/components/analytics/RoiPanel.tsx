import type { RoiSummary } from '../../hooks/useAnalytics'
import MetricTooltip from './MetricTooltip'

interface Props {
  roi: RoiSummary | null
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
  const color = improved ? 'text-green-600' : 'text-red-500'
  const sign = improved ? '↓' : '↑'
  return (
    <span className={`text-xs font-mono ml-2 ${color}`}>
      {sign} {Math.abs(delta).toFixed(1)}%
    </span>
  )
}

function MetricCard({ label, value, sub, tooltip }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tooltip?: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs text-gray-600 uppercase tracking-widest flex items-center">
        {label}
        {tooltip && <MetricTooltip text={tooltip} />}
      </span>
      <span className="text-2xl font-mono font-bold text-gray-900">{value}</span>
      {sub && <span className="text-xs text-gray-600">{sub}</span>}
    </div>
  )
}

export default function RoiPanel({ roi }: Props) {
  if (!roi || roi.run_count === 0) {
    return (
      <div className="flex-1 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-widest mb-4">ROI Metrics</h2>
        <p className="text-gray-600 text-sm">No runs in this time range.</p>
      </div>
    )
  }

  const falseActColor = roi.false_action_rate > 0 ? 'text-red-500' : 'text-gray-900'

  return (
    <div className="flex-1 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-widest mb-4">
        ROI Metrics
        <span className="ml-2 text-gray-600 normal-case font-normal">{roi.run_count} runs</span>
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
          sub={`${roi.mttr_delta_pct > 0 ? '↑' : '↓'} ${Math.abs(roi.mttr_delta_pct).toFixed(1)}% vs human baseline`}
          tooltip="Mean Time To Resolve — wall-clock time from run start to finish. Delta % compares against the human baseline. Green ↓ means the agent is faster than a human would be."
        />
        <MetricCard
          label="Autonomous Resolution"
          value={pct(roi.autonomous_resolution_rate)}
          sub={`${pct(roi.escalation_rate)} escalated`}
          tooltip="% of runs where the human approved the plan as-is. 'Modify' counts as hitl_corrected; 'Reject' as escalated. Only approved runs contribute to hours saved."
        />
        <MetricCard
          label="Eng-Hours Saved"
          value={roi.engineer_hours_saved.toFixed(1)}
          sub="hours (cumulative)"
          tooltip="autonomous_runs × max(baseline_mttr − avg_mttr, 0) ÷ 3600. Only autonomous runs where the agent was faster than the human baseline contribute. Floors at 0 if the agent is slower."
        />
        <MetricCard
          label="False Action Rate"
          value={<span className={falseActColor}>{pct(roi.false_action_rate)}</span>}
          tooltip="% of runs where the agent's remediation worsened the alert state — outcome reported as 'false_action' by AgentCore. Requires post-execution alert state comparison to be wired in AgentCore."
        />
      </div>
    </div>
  )
}
