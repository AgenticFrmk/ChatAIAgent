import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'

interface Props {
  budgetUsed: number
}

export default function WarningBanner({ budgetUsed }: Props) {
  const visible = budgetUsed >= 0.70
  const isCritical = budgetUsed >= 0.90

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 44, opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className={`w-full flex items-center justify-center gap-2 text-xs font-medium overflow-hidden flex-shrink-0
                      ${isCritical
                        ? 'bg-red-50 border-b border-red-200 text-red-700'
                        : 'bg-amber-50 border-b border-amber-200 text-amber-700'
                      }`}
        >
          <motion.span
            animate={isCritical ? { scale: [1, 1.15, 1] } : {}}
            transition={{ repeat: Infinity, duration: 1.2 }}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
          </motion.span>
          {isCritical
            ? '⚠ Context critical — compaction imminent'
            : '⚠ Context high — compaction threshold approaching'}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
