import { Terminal, Link2 } from 'lucide-react'
import { motion } from 'framer-motion'

interface Props {
  label?: string
}

export default function ThinkingBubble({ label }: Props) {
  if (label) {
    return (
      <div className="flex gap-3 items-start">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Link2 className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="bg-violet-50 border border-violet-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2">
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-violet-500 flex-shrink-0"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span className="text-xs text-violet-700 font-mono">{label}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-700 to-amber-600 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Terminal className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3.5 shadow-sm">
        <div className="flex gap-1.5 items-center">
          {[0, 0.18, 0.36].map((delay, i) => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-orange-500"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, delay, repeat: Infinity, ease: 'easeInOut' }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
