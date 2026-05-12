import { Terminal, LogOut, RotateCcw, BarChart2, BookOpen, Info, DollarSign, Zap } from 'lucide-react'
import BudgetGauge from './BudgetGauge'
import type { BudgetState } from '../lib/types'

interface Props {
  username: string
  isRunning: boolean
  awaitingReply: boolean
  hasMessages: boolean
  budget: BudgetState | null
  budgetHistory: { tokens: number; ts: number }[]
  autoApprove: boolean
  onAutoApproveToggle: (v: boolean) => void
  onReset: () => void
  onLogout: () => void
}

export default function ChatHeader({ username, isRunning, awaitingReply, hasMessages, budget, budgetHistory, autoApprove, onAutoApproveToggle, onReset, onLogout }: Props) {
  const statusLabel = awaitingReply
    ? 'Awaiting reply'
    : isRunning
    ? 'Running'
    : 'Ready'

  const statusColor = awaitingReply
    ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
    : isRunning
    ? 'text-purple-400 bg-purple-500/10 border-purple-500/20'
    : 'text-[#484f58] bg-[#161b22] border-[#1c2333]'

  return (
    <header className="flex-shrink-0 bg-[#0d1117] border-b border-[#1c2333] px-4 py-3 flex items-center gap-3">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center">
          <Terminal className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-sm font-bold text-white">
          ChatAI Agent
          <span className="text-[#8b949e] font-normal text-xs ml-1.5">by AgentCore</span>
        </span>
      </div>

      {/* Username */}
      <div className="hidden sm:flex items-center gap-2 bg-[#161b22] border border-[#1c2333] rounded-full px-3 py-1">
        <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
        <span className="text-xs text-[#8b949e] font-mono">{username}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Auto-approve toggle */}
        <button
          onClick={() => onAutoApproveToggle(!autoApprove)}
          title={autoApprove ? 'Auto-approve ON — takes effect on next session' : 'Auto-approve OFF — takes effect on next session'}
          className={`flex items-center gap-1.5 text-[10px] uppercase tracking-widest rounded-full px-3 py-1 border font-medium transition-colors ${
            autoApprove
              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20'
              : 'text-[#484f58] bg-[#161b22] border-[#1c2333] hover:text-[#8b949e]'
          }`}
        >
          <Zap className="w-3 h-3" />
          Auto
        </button>

        {/* Status pill */}
        <span className={`text-[10px] uppercase tracking-widest rounded-full px-3 py-1 border font-medium ${statusColor}`}>
          {statusLabel}
        </span>

        <BudgetGauge budget={budget} history={budgetHistory} />

        {/* New chat — only when idle and has history */}
        {!isRunning && hasMessages && (
          <button
            onClick={onReset}
            title="New chat"
            className="p-2 rounded-lg text-[#8b949e] hover:text-white hover:bg-[#161b22] transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}

        <button
          onClick={() => window.open('/analytics', '_blank')}
          title="Analytics"
          className="p-2 rounded-lg text-[#8b949e] hover:text-purple-400 hover:bg-[#161b22] transition-colors"
        >
          <BarChart2 className="w-4 h-4" />
        </button>

        <button
          onClick={() => window.open('/billing', '_blank')}
          title="Billing"
          className="p-2 rounded-lg text-[#8b949e] hover:text-emerald-400 hover:bg-[#161b22] transition-colors"
        >
          <DollarSign className="w-4 h-4" />
        </button>

        <a
          href="/registry/portal/"
          target="_blank"
          rel="noopener noreferrer"
          title="Knowledge Base — RegistryService portal"
          className="p-2 rounded-lg text-[#8b949e] hover:text-blue-400 hover:bg-[#161b22] transition-colors"
        >
          <BookOpen className="w-4 h-4" />
        </a>

        <button
          onClick={() => window.open('/about', '_blank')}
          title="About the platform"
          className="p-2 rounded-lg text-[#8b949e] hover:text-blue-400 hover:bg-[#161b22] transition-colors"
        >
          <Info className="w-4 h-4" />
        </button>

        <button
          onClick={onLogout}
          title="Logout"
          className="p-2 rounded-lg text-[#8b949e] hover:text-white hover:bg-[#161b22] transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}
