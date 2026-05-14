import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { LineChart, Line, ResponsiveContainer } from 'recharts'
import type { BudgetState } from '../lib/types'

interface Props {
  budget: BudgetState | null
  history: { tokens: number; ts: number }[]
}

const SIZE = 80
const STROKE = 8
const R = (SIZE - STROKE) / 2
const CX = SIZE / 2
const CY = SIZE / 2
const ARC_DEG = 270
const CIRCUMFERENCE = 2 * Math.PI * R
const ARC_LEN = (ARC_DEG / 360) * CIRCUMFERENCE

function arcPath(pct: number): string {
  return String(Math.max(0, Math.min(1, pct)) * ARC_LEN)
}

function getColor(pct: number): string {
  if (pct >= 0.9) return '#ef4444'
  if (pct >= 0.7) return '#e3b341'
  return '#3fb950'
}

export default function BudgetGauge({ budget, history }: Props) {
  const [displayPct, setDisplayPct] = useState(0)
  const [animating, setAnimating] = useState(false)
  const prevCompacted = useRef(false)

  const pct = budget ? budget.budget_used : 0
  const color = getColor(pct)
  const isWarning = pct >= 0.7 && pct < 0.9
  const isCritical = pct >= 0.9

  useEffect(() => {
    if (!budget) return
    if (budget.compacted && !prevCompacted.current) {
      setAnimating(true)
      setDisplayPct(0)
      const t = setTimeout(() => {
        setDisplayPct(pct)
        setAnimating(false)
      }, 900)
      prevCompacted.current = true
      return () => clearTimeout(t)
    } else {
      setDisplayPct(pct)
      if (!budget.compacted) prevCompacted.current = false
    }
  }, [budget, pct])

  const filled = parseFloat(arcPath(displayPct))

  return (
    <div className="flex flex-col items-center gap-1 select-none" style={{ width: 100 }}>
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        {(isWarning || isCritical) && (
          <div
            className={`absolute rounded-full border-2 ${isCritical ? 'border-red-500 pulse-ring-fast' : 'border-amber-500 pulse-ring'}`}
            style={{ inset: -4 }}
          />
        )}

        <svg width={SIZE} height={SIZE} style={{ transform: 'rotate(135deg)' }}>
          <circle
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke="#1c2333"
            strokeWidth={STROKE}
            strokeDasharray={`${ARC_LEN} ${CIRCUMFERENCE}`}
            strokeLinecap="round"
          />
          <motion.circle
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
            strokeLinecap="round"
            animate={{ strokeDasharray: `${filled} ${CIRCUMFERENCE}`, stroke: color }}
            transition={{ duration: animating ? 0.8 : 0.5, ease: 'easeInOut' }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            key={Math.round(displayPct * 100)}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-base font-bold leading-none"
            style={{ color }}
          >
            {Math.round(displayPct * 100)}%
          </motion.span>
        </div>
      </div>

      <div className="text-center">
        <motion.p
          key={budget?.estimated_tokens}
          initial={{ opacity: 0.4 }}
          animate={{ opacity: 1 }}
          className="text-[10px] font-mono leading-none"
          style={{ color }}
        >
          {budget
            ? `${budget.estimated_tokens.toLocaleString()} / ${budget.context_limit.toLocaleString()}`
            : `0 / ${(15000).toLocaleString()}`}
        </motion.p>
        <span className="text-[9px] text-[#484f58] font-mono">tokens</span>
        <span className="text-[9px] text-[#484f58] uppercase tracking-widest">
          {isCritical ? 'critical' : isWarning ? 'warning' : 'normal'}
        </span>
      </div>

      {history.length > 1 && (
        <div style={{ width: 80, height: 24 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history.map(h => ({ v: h.tokens }))}>
              <Line
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <AnimatePresence>
        {budget?.compacted && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            className="text-[9px] text-purple-400 bg-purple-500/10 border border-purple-500/20 rounded px-1.5 py-0.5 text-center leading-tight"
          >
            ↳ Compacted · −{budget.messages_evicted} msgs
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
