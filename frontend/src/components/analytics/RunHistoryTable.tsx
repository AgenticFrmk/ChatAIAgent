import type { RunPage } from '../../hooks/useAnalytics'

interface Props {
  runs: RunPage | null
  onSelect: (runId: string) => void
}

function ResolutionChip({ type }: { type: string }) {
  const styles: Record<string, string> = {
    autonomous:     'bg-green-50 text-green-700 border-green-200',
    hitl_corrected: 'bg-amber-50 text-amber-700 border-amber-200',
    escalated:      'bg-red-50 text-red-700 border-red-200',
    failed:         'bg-gray-100 text-gray-600 border-gray-300',
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
    resolved:     'text-green-600',
    failed:       'text-red-600',
    false_action: 'text-orange-500',
  }
  return (
    <span className={`text-sm font-mono ${styles[outcome] ?? 'text-gray-600'}`}>
      {outcome}
    </span>
  )
}

function fmt(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

export default function RunHistoryTable({ runs, onSelect }: Props) {
  if (!runs || runs.total === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-widest mb-4">Run History</h2>
        <p className="text-gray-600 text-sm">No runs in this time range.</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-widest">
          Run History
        </h2>
        <span className="text-xs text-gray-600">{runs.total} total</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-600 uppercase border-b border-gray-200">
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
              <tr
                key={run.run_id}
                className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
                onClick={() => onSelect(run.run_id)}
              >
                <td className="py-2.5 pr-4 font-mono text-xs text-gray-600">
                  {run.run_id.slice(0, 8)}…
                </td>
                <td className="py-2.5 pr-4 text-gray-600 text-xs">
                  {new Date(run.timestamp).toLocaleString()}
                </td>
                <td className="py-2.5 pr-4 font-mono text-gray-900">
                  {fmt(run.mttr_seconds)}
                </td>
                <td className="py-2.5 pr-4">
                  <ResolutionChip type={run.resolution_type} />
                </td>
                <td className="py-2.5 pr-4">
                  {run.plan_accurate
                    ? <span className="text-green-600 text-sm">✓ matched</span>
                    : <span className="text-red-500 text-sm">✗ deviated</span>}
                </td>
                <td className="py-2.5 pr-4 font-mono text-gray-900">
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
