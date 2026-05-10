import { Terminal } from 'lucide-react'
import { motion } from 'framer-motion'

export default function ThinkingBubble() {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Terminal className="w-3.5 h-3.5 text-white" />
      </div>

      <div className="bg-[#0d1117] border border-[#1c2333] rounded-2xl rounded-tl-sm px-4 py-3.5">
        <div className="flex gap-1.5 items-center">
          {[0, 0.18, 0.36].map((delay, i) => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-purple-400"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, delay, repeat: Infinity, ease: 'easeInOut' }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
