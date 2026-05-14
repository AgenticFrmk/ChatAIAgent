import { useState } from 'react'

export interface BillingUsage {
  tokens: number
  storage_gb: number
  api_calls: number
  cloud_cost_usd: number
}

export interface BillingCost {
  token_cost_usd: number
  storage_cost_usd: number
  api_call_cost_usd: number
  cloud_cost_usd: number
  base_fee_usd: number
  total_usd: number
}

export interface BillingOverage {
  tokens: boolean
  storage: boolean
  api_calls: boolean
}

export interface BillingLimits {
  token_limit: number | null
  storage_gb_limit: number | null
  api_call_limit: number | null
}

export interface BillingCurrent {
  tenant_id: string
  plan: string
  period: { year: number; month: number }
  usage: BillingUsage
  cost: BillingCost
  overage: BillingOverage
  limits: BillingLimits | null
}

export interface BillingPeriod {
  year: number
  month: number
  total_usd: number
  plan: string
  finalized_at: string | null
}

const MOCK_CURRENT: BillingCurrent = {
  tenant_id: 'demo',
  plan: 'professional',
  period: { year: 2026, month: 5 },
  usage: { tokens: 750000, storage_gb: 3.2, api_calls: 4500, cloud_cost_usd: 18.4 },
  cost: { token_cost_usd: 0, storage_cost_usd: 0, api_call_cost_usd: 0, cloud_cost_usd: 18.4, base_fee_usd: 50, total_usd: 68.4 },
  overage: { tokens: false, storage: false, api_calls: false },
  limits: { token_limit: 1000000, storage_gb_limit: 5.0, api_call_limit: 10000 },
}

const MOCK_HISTORY: BillingPeriod[] = [
  { year: 2026, month: 4, total_usd: 72.1,  plan: 'professional', finalized_at: '2026-05-01T03:00:00Z' },
  { year: 2026, month: 3, total_usd: 4.8,   plan: 'starter',      finalized_at: '2026-04-01T03:00:00Z' },
  { year: 2026, month: 2, total_usd: 2.3,   plan: 'starter',      finalized_at: '2026-03-01T03:00:00Z' },
]

export function useBilling() {
  const [current] = useState<BillingCurrent>(MOCK_CURRENT)
  const [history] = useState<BillingPeriod[]>(MOCK_HISTORY)

  return { current, history, loading: false }
}
