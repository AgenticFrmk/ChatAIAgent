import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Terminal } from 'lucide-react'

interface Props {
  text: string
  timestamp: number
}

export default function AgentBubble({ text, timestamp }: Props) {
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex gap-3 items-start">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Terminal className="w-3.5 h-3.5 text-white" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="bg-[#0d1117] border border-[#1c2333] rounded-2xl rounded-tl-sm px-4 py-3">
          <div className="prose text-sm text-[#e6edf3] leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {text}
            </ReactMarkdown>
          </div>
        </div>
        <p className="text-[10px] text-[#484f58] mt-1 ml-1">{time}</p>
      </div>
    </div>
  )
}
