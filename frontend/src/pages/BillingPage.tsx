import { DollarSign, Cpu, Database, Zap, Cloud, TrendingUp } from 'lucide-react'
import { useBilling, type BillingCurrent, type BillingPeriod } from '../hooks/useBilling'

const PLAN_STYLES: Record<string, { label: string; color: string; bg: string; border: string }> = {
  starter:      { label: 'Starter',      color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200' },
  professional: { label: 'Professional', color: 'text-blue-700',    bg: 'bg-blue-50',    border: 'border-blue-200' },
  enterprise:   { label: 'Enterprise',   color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function usd(n: number) {
  return `$${fmt(n)}`
}

function UsageBar({ value, limit, unit }: { value: number; limit: number | null; unit: string }) {
  if (!limit) return <span className="text-xs text-gray-600">PAYG — no limit</span>
  const pct = Math.min(100, (value / limit) * 100)
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-600">
        <span>{value.toLocaleString()} {unit}</span>
        <span>{Math.round(pct)}% of {limit.toLocaleString()}</span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function CostTile({
  icon, label, metric, cost,
}: {
  icon: React.ReactNode
  label: string
  metric: string
  cost: string
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-gray-600">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-lg font-mono font-semibold text-gray-900">{metric}</p>
      <p className="text-sm font-mono text-orange-700">{cost}</p>
    </div>
  )
}

function OverageBanner({ current }: { current: BillingCurrent }) {
  const { overage, limits } = current
  if (!overage.tokens && !overage.storage && !overage.api_calls) return null
  const dims = [
    overage.tokens   && `tokens (${Math.round((current.usage.tokens      / (limits?.token_limit      ?? 1)) * 100)}% used)`,
    overage.storage  && `storage (${Math.round((current.usage.storage_gb / (limits?.storage_gb_limit ?? 1)) * 100)}% used)`,
    overage.api_calls && `API calls (${Math.round((current.usage.api_calls / (limits?.api_call_limit  ?? 1)) * 100)}% used)`,
  ].filter(Boolean)
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
      <TrendingUp className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
      <p className="text-sm text-amber-700">
        Approaching plan limit: <span className="font-medium">{dims.join(', ')}</span>.{' '}
        Consider upgrading your plan to avoid overage charges.
      </p>
    </div>
  )
}

function CurrentPeriod({ current }: { current: BillingCurrent }) {
  const plan = PLAN_STYLES[current.plan] ?? PLAN_STYLES.starter
  const { usage, cost, limits } = current

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full border ${plan.color} ${plan.bg} ${plan.border}`}>
          {plan.label}
        </span>
        <span className="text-xs text-gray-600">
          {MONTH_NAMES[current.period.month - 1]} {current.period.year} billing period
        </span>
        <span className="ml-auto text-xs text-gray-600 border border-gray-200 px-2 py-0.5 rounded-full">
          demo data
        </span>
      </div>

      <OverageBanner current={current} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CostTile
          icon={<Cpu className="w-3.5 h-3.5" />}
          label="LLM Tokens"
          metric={`${(usage.tokens / 1000).toFixed(0)}K tokens`}
          cost={usd(cost.token_cost_usd)}
        />
        <CostTile
          icon={<Database className="w-3.5 h-3.5" />}
          label="Storage"
          metric={`${fmt(usage.storage_gb, 1)} GB`}
          cost={usd(cost.storage_cost_usd)}
        />
        <CostTile
          icon={<Zap className="w-3.5 h-3.5" />}
          label="API Calls"
          metric={usage.api_calls.toLocaleString()}
          cost={usd(cost.api_call_cost_usd)}
        />
        <CostTile
          icon={<Cloud className="w-3.5 h-3.5" />}
          label="Cloud Infra"
          metric="GCP allocation"
          cost={usd(cost.cloud_cost_usd)}
        />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center justify-between">
        <div className="space-y-0.5">
          {cost.base_fee_usd > 0 && (
            <p className="text-xs text-gray-600 font-mono">Base fee: {usd(cost.base_fee_usd)}</p>
          )}
          <p className="text-xs text-gray-600 font-mono">Estimated period total</p>
        </div>
        <p className="text-2xl font-mono font-bold text-gray-900">{usd(cost.total_usd)}</p>
      </div>

      {limits && (limits.token_limit || limits.storage_gb_limit || limits.api_call_limit) && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
          <p className="text-xs text-gray-600 uppercase tracking-wider font-medium">Plan Usage</p>
          <div className="space-y-3">
            <UsageBar value={usage.tokens}     limit={limits.token_limit}      unit="tokens" />
            <UsageBar value={usage.storage_gb} limit={limits.storage_gb_limit} unit="GB" />
            <UsageBar value={usage.api_calls}  limit={limits.api_call_limit}   unit="calls" />
          </div>
        </div>
      )}
    </div>
  )
}

function HistoryTable({ history }: { history: BillingPeriod[] }) {
  if (history.length === 0) {
    return (
      <p className="text-sm text-gray-600 text-center py-8">No finalized billing periods yet.</p>
    )
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left text-xs text-gray-600 uppercase tracking-wider px-4 py-3">Period</th>
            <th className="text-left text-xs text-gray-600 uppercase tracking-wider px-4 py-3">Plan</th>
            <th className="text-right text-xs text-gray-600 uppercase tracking-wider px-4 py-3">Total</th>
            <th className="text-right text-xs text-gray-600 uppercase tracking-wider px-4 py-3">Finalized</th>
          </tr>
        </thead>
        <tbody>
          {history.map((p, i) => {
            const plan = PLAN_STYLES[p.plan] ?? PLAN_STYLES.starter
            return (
              <tr key={`${p.year}-${p.month}`} className={i < history.length - 1 ? 'border-b border-gray-100' : ''}>
                <td className="px-4 py-3 font-mono text-gray-900">
                  {MONTH_NAMES[p.month - 1]} {p.year}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${plan.color} ${plan.bg} ${plan.border}`}>
                    {plan.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-gray-900">
                  {usd(p.total_usd)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-gray-600">
                  {p.finalized_at ? new Date(p.finalized_at).toLocaleDateString() : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function BillingPage() {
  const { current, history, loading } = useBilling()

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col text-gray-900">
      <header className="flex-shrink-0 bg-white border-b border-gray-200 shadow-sm px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-700 to-amber-600 flex items-center justify-center">
            <DollarSign className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-bold text-gray-900">
            ChatAI Agent
            <span className="text-orange-500 mx-1">·</span>
            <span className="text-gray-600 font-normal">Billing</span>
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6 max-w-5xl mx-auto w-full space-y-8">

        <section>
          <h2 className="text-xs text-gray-600 uppercase tracking-widest font-medium mb-4 flex items-center gap-2">
            <DollarSign className="w-3.5 h-3.5" /> Current Period
          </h2>
          {loading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => (
                <div key={i} className="bg-white border border-gray-200 rounded-xl h-16 animate-pulse" />
              ))}
            </div>
          ) : current ? (
            <CurrentPeriod current={current} />
          ) : (
            <p className="text-sm text-gray-600">No billing data available.</p>
          )}
        </section>

        <section>
          <h2 className="text-xs text-gray-600 uppercase tracking-widest font-medium mb-4 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5" /> Billing History
          </h2>
          {loading ? (
            <div className="bg-white border border-gray-200 rounded-xl h-32 animate-pulse" />
          ) : (
            <HistoryTable history={history} />
          )}
        </section>

      </main>
    </div>
  )
}
