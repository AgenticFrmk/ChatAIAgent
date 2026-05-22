import { Terminal } from 'lucide-react'
import { motion } from 'framer-motion'

export default function ThinkingBubble() {
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
