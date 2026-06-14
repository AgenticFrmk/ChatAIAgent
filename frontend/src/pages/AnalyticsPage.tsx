import { useState, useMemo } from 'react'
import { BarChart2 } from 'lucide-react'
import { useAnalytics, type TimeRange } from '../hooks/useAnalytics'
import { useSession } from '../hooks/useSession'
import RoiPanel from '../components/analytics/RoiPanel'
import AgentPerfPanel from '../components/analytics/AgentPerfPanel'
import RunHistoryTable from '../components/analytics/RunHistoryTable'
import RunDetailModal from '../components/analytics/RunDetailModal'

const RANGES: { label: string; days: number }[] = [
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
]

function makeRange(days: number): TimeRange {
  const to   = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
  return { from, to }
}

export default function AnalyticsPage() {
  const [rangeDays, setRangeDays] = useState(30)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const range             = useMemo(() => makeRange(rangeDays), [rangeDays])
  const { session }       = useSession()
  const { roi, perf, runs, loading, error } = useAnalytics('chat-ai-agent', range, session?.token ?? null)

  return (
    <>
    <div className="min-h-screen bg-gray-50 flex flex-col text-gray-900">
      {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-gray-200 shadow-sm px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-700 to-amber-600 flex items-center justify-center">
            <BarChart2 className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-bold text-gray-900">
            ChatAI Agent
            <span className="text-orange-500 mx-1">·</span>
            <span className="text-gray-600 font-normal">Analytics</span>
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Range selector */}
          <div className="flex items-center gap-1 bg-gray-100 border border-gray-200 rounded-lg p-1">
            {RANGES.map(r => (
              <button
                key={r.days}
                onClick={() => setRangeDays(r.days)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  rangeDays === r.days
                    ? 'bg-orange-700 text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 p-6 flex flex-col gap-4 overflow-auto">
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            Failed to load analytics: {error}
          </div>
        )}
        {loading && (
          <div className="text-sm text-gray-600 text-center py-8">Loading…</div>
        )}
        {!loading && (
          <>
            <div className="flex gap-4 flex-wrap">
              <RoiPanel roi={roi} />
              <AgentPerfPanel perf={perf} />
            </div>
            <RunHistoryTable runs={runs} onSelect={setSelectedRunId} />
          </>
        )}
      </div>
    </div>

    {selectedRunId && (
      <RunDetailModal
        runId={selectedRunId}
        agentId="chat-ai-agent"
        token={session?.token ?? null}
        onClose={() => setSelectedRunId(null)}
      />
    )}
    </>
  )
}
