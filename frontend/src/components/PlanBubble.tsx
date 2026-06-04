import { Terminal } from 'lucide-react'
import type { PlanStep, PolicyDecision } from '../lib/types'

interface Props {
  steps: PlanStep[]
  timestamp: number
}

const DECISION_BADGE: Record<NonNullable<PolicyDecision>, string> = {
  block:            'bg-red-50 border border-red-300 text-red-700',
  require_approval: 'bg-amber-50 border border-amber-300 text-amber-700',
  allow:            'bg-green-50 border border-green-300 text-green-700',
}

const DECISION_ICON: Record<NonNullable<PolicyDecision>, string> = {
  block:            '🛡',
  require_approval: '⚠',
  allow:            '✓',
}

const DECISION_LABEL: Record<NonNullable<PolicyDecision>, string> = {
  block:            'Blocked by policy',
  require_approval: 'Requires approval',
  allow:            'Allowed',
}

function PolicyBadge({ decision, rule }: { decision: PolicyDecision; rule?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${DECISION_BADGE[decision]}`}
      title={rule ?? DECISION_LABEL[decision]}
    >
      {DECISION_ICON[decision]} {DECISION_LABEL[decision]}
    </span>
  )
}

export default function PlanBubble({ steps, timestamp }: Props) {
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  const approvalCount = steps.filter(s => s.policy === 'require_approval').length
  const blockedCount  = steps.filter(s => s.policy === 'block').length

  return (
    <div className="flex gap-3 items-start">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-700 to-amber-600 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Terminal className="w-3.5 h-3.5 text-white" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
          {/* Header */}
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            🗂 Execution Plan
          </p>

          {/* Step list */}
          <div className="space-y-2">
            {steps.map(step => {
              const isBlocked = step.policy === 'block'
              return (
                <div
                  key={step.step_number}
                  className={`flex items-start gap-3 ${isBlocked ? 'opacity-50' : ''}`}
                >
                  <span className="text-xs text-gray-400 w-4 flex-shrink-0 mt-0.5 font-mono">
                    {step.step_number}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-mono font-medium ${isBlocked ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                        {step.tool_name}
                      </span>
                      {step.policy && step.policy !== 'allow' && (
                        <PolicyBadge decision={step.policy} rule={step.policy_rule} />
                      )}
                    </div>
                    {step.reason && (
                      <p className="text-xs text-gray-500 mt-0.5">{step.reason}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer summary */}
          {(approvalCount > 0 || blockedCount > 0) && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
              {approvalCount > 0 && (
                <p className="text-xs text-amber-700">
                  ⚠ {approvalCount} step{approvalCount !== 1 ? 's' : ''} require{approvalCount === 1 ? 's' : ''} your approval before execution starts.
                </p>
              )}
              {blockedCount > 0 && (
                <p className="text-xs text-red-600">
                  🛡 {blockedCount} step{blockedCount !== 1 ? 's' : ''} blocked by policy and will not execute.
                </p>
              )}
              {approvalCount > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Type <span className="font-mono bg-gray-100 px-1 rounded">approve</span> to proceed or <span className="font-mono bg-gray-100 px-1 rounded">reject</span> to cancel.
                </p>
              )}
            </div>
          )}
        </div>
        <p className="text-[10px] text-gray-600 mt-1 ml-1">{time}</p>
      </div>
    </div>
  )
}
