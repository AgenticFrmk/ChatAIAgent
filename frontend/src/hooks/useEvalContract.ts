import { useEffect, useState } from 'react'

export interface EvalContract {
  success_signals: string[]
  expected_tool_flow: string[]
  mttr_threshold_seconds: number
  mttr_baseline_seconds: number
  min_plan_accuracy: number
  max_step_efficiency: number
  max_retry_rate: number
  false_action_threshold: number
  min_confidence_calibration: number
}

export function useEvalContract(domain: string) {
  const [contract, setContract] = useState<EvalContract | null>(null)

  useEffect(() => {
    fetch(`/api/registry/domains/${domain}/eval-contract`)
      .then(r => {
        if (!r.ok) return null
        return r.json() as Promise<EvalContract>
      })
      .then(data => { if (data) setContract(data) })
      .catch(() => { /* threshold bands are optional — fail silently */ })
  }, [domain])

  return contract
}
