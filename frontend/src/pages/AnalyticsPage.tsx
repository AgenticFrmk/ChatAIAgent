import { useState, useMemo } from 'react'
import { BarChart2 } from 'lucide-react'
import { useAnalytics, type TimeRange } from '../hooks/useAnalytics'
import { useEvalContract } from '../hooks/useEvalContract'
import RoiPanel from '../components/analytics/RoiPanel'
import AgentPerfPanel from '../components/analytics/AgentPerfPanel'
import RunHistoryTable from '../components/analytics/RunHistoryTable'

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
  const range    = useMemo(() => makeRange(rangeDays), [rangeDays])
  const { roi, perf, runs, loading, error, demo } = useAnalytics('chat-ai-agent', range)
  const contract = useEvalContract('connectivity')

  return (
    <div className="min-h-screen bg-[#080b10] flex flex-col text-[#e6edf3]">
      {/* Header */}
      <header className="flex-shrink-0 bg-[#0d1117] border-b border-[#1c2333] px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center">
            <BarChart2 className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-bold text-white">
            ChatAI Agent
            <span className="text-purple-400 mx-1">·</span>
            <span className="text-[#8b949e] font-normal">Analytics</span>
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {demo && (
            <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-3 py-1">
              Demo data — no real runs yet
            </span>
          )}
          {/* Range selector */}
          <div className="flex items-center gap-1 bg-[#161b22] border border-[#1c2333] rounded-lg p-1">
            {RANGES.map(r => (
              <button
                key={r.days}
                onClick={() => setRangeDays(r.days)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  rangeDays === r.days
                    ? 'bg-purple-600 text-white'
                    : 'text-[#8b949e] hover:text-white'
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
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
            Failed to load analytics: {error}
          </div>
        )}
        {loading && (
          <div className="text-sm text-[#484f58] text-center py-8">Loading…</div>
        )}
        {!loading && (
          <>
            <div className="flex gap-4 flex-wrap">
              <RoiPanel roi={roi} contract={contract} />
              <AgentPerfPanel perf={perf} contract={contract} />
            </div>
            <RunHistoryTable runs={runs} />
          </>
        )}
      </div>
    </div>
  )
}
