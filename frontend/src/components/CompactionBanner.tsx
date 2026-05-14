import { motion, AnimatePresence } from 'framer-motion'
import { Zap } from 'lucide-react'

interface Props {
  visible: boolean
  messagesEvicted: number
  headroomPct: number
}

export default function CompactionBanner({ visible, messagesEvicted, headroomPct }: Props) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="w-full bg-purple-500/20 border-b border-purple-500/40
                     flex items-center justify-center gap-3 py-3 text-sm flex-shrink-0 z-40 relative"
        >
          <motion.span
            animate={{ rotate: [0, 15, -15, 0] }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            <Zap className="w-4 h-4 text-purple-300" />
          </motion.span>
          <span className="text-purple-300 font-semibold">Context compacted</span>
          <span className="text-[#8b949e] text-xs">
            {messagesEvicted} messages evicted
            {headroomPct > 0 && ` · ${headroomPct}% headroom recovered`}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
