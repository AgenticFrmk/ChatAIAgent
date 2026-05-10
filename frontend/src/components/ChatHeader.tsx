import { Terminal, LogOut, RotateCcw, BarChart2, BookOpen, Info } from 'lucide-react'

interface Props {
  username: string
  isRunning: boolean
  awaitingReply: boolean
  hasMessages: boolean
  onReset: () => void
  onLogout: () => void
}

export default function ChatHeader({ username, isRunning, awaitingReply, hasMessages, onReset, onLogout }: Props) {
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
        {/* Status pill */}
        <span className={`text-[10px] uppercase tracking-widest rounded-full px-3 py-1 border font-medium ${statusColor}`}>
          {statusLabel}
        </span>

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
