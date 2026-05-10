import type { RunPage } from '../../hooks/useAnalytics'

interface Props {
  runs: RunPage | null
}

function ResolutionChip({ type }: { type: string }) {
  const styles: Record<string, string> = {
    autonomous:     'bg-green-500/10 text-green-400 border-green-500/20',
    hitl_corrected: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    escalated:      'bg-red-500/10 text-red-400 border-red-500/20',
    failed:         'bg-[#161b22] text-[#484f58] border-[#30363d]',
  }
  const labels: Record<string, string> = {
    autonomous:     'Autonomous',
    hitl_corrected: 'HITL Corrected',
    escalated:      'Escalated',
    failed:         'Failed',
  }
  const cls = styles[type] ?? styles.failed
  return (
    <span className={`text-xs px-2 py-0.5 rounded-md border font-mono ${cls}`}>
      {labels[type] ?? type}
    </span>
  )
}

function OutcomeChip({ outcome }: { outcome: string }) {
  const styles: Record<string, string> = {
    resolved:     'text-green-400',
    failed:       'text-red-400',
    false_action: 'text-orange-400',
  }
  return (
    <span className={`text-sm font-mono ${styles[outcome] ?? 'text-[#8b949e]'}`}>
      {outcome}
    </span>
  )
}

function fmt(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

export default function RunHistoryTable({ runs }: Props) {
  if (!runs || runs.total === 0) {
    return (
      <div className="bg-[#0d1117] border border-[#1c2333] rounded-xl p-6">
        <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-widest mb-4">Run History</h2>
        <p className="text-[#484f58] text-sm">No runs in this time range.</p>
      </div>
    )
  }

  return (
    <div className="bg-[#0d1117] border border-[#1c2333] rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-widest">
          Run History
        </h2>
        <span className="text-xs text-[#484f58]">{runs.total} total</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-[#484f58] uppercase border-b border-[#1c2333]">
              <th className="text-left py-2 pr-4 font-medium tracking-widest">Run ID</th>
              <th className="text-left py-2 pr-4 font-medium tracking-widest">Time</th>
              <th className="text-left py-2 pr-4 font-medium tracking-widest">MTTR</th>
              <th className="text-left py-2 pr-4 font-medium tracking-widest">Resolution</th>
              <th className="text-left py-2 pr-4 font-medium tracking-widest">Plan</th>
              <th className="text-left py-2 pr-4 font-medium tracking-widest">Efficiency</th>
              <th className="text-left py-2 font-medium tracking-widest">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {runs.runs.map(run => (
              <tr key={run.run_id} className="border-b border-[#1c2333] hover:bg-[#161b22] transition-colors">
                <td className="py-2.5 pr-4 font-mono text-xs text-[#8b949e]">
                  {run.run_id.slice(0, 8)}…
                </td>
                <td className="py-2.5 pr-4 text-[#8b949e] text-xs">
                  {new Date(run.timestamp).toLocaleString()}
                </td>
                <td className="py-2.5 pr-4 font-mono text-[#e6edf3]">
                  {fmt(run.mttr_seconds)}
                </td>
                <td className="py-2.5 pr-4">
                  <ResolutionChip type={run.resolution_type} />
                </td>
                <td className="py-2.5 pr-4">
                  {run.plan_accurate
                    ? <span className="text-green-400 text-sm">✓ matched</span>
                    : <span className="text-red-400 text-sm">✗ deviated</span>}
                </td>
                <td className="py-2.5 pr-4 font-mono text-[#e6edf3]">
                  {run.step_efficiency.toFixed(2)}×
                </td>
                <td className="py-2.5">
                  <OutcomeChip outcome={run.outcome} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
