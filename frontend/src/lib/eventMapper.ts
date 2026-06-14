import type { GatewayEvent } from './gateway'

export interface MappedEvent {
  name: string
  data: Record<string, unknown>
}

/**
 * Translates raw AgentBE events into semantic ChatAIAgent events.
 *
 * sre-agent emits two shapes:
 *   • Node events  — {node, event: "on_chain_start"|"on_chain_end", data: {output: {...}}}
 *   • Control      — {type: "interrupt"|"done"|"error"|"usage", ...}
 */
export function mapGatewayEvent(ev: GatewayEvent): MappedEvent[] {
  // ── Control events ────────────────────────────────────────────────────────
  if (ev.type === 'done') {
    return [{ name: 'done', data: {} }]
  }
  if (ev.type === 'error') {
    return [{ name: 'error', data: { message: ev.detail ?? 'Unknown error' } }]
  }
  if (ev.type === 'budget') {
    return [{ name: 'budget', data: ev as unknown as Record<string, unknown> }]
  }

  if (ev.type === 'interrupt') {
    const interrupts = ev.interrupts ?? []
    const next = ev.next ?? []
    const payload = interrupts[0] ?? {}

    // entity_confirm — payload has {entities: {...}}
    if (next.includes('entity_confirm')) {
      return [{ name: 'entity_confirm', data: { entities: payload['entities'] ?? {} } }]
    }

    // clarify — payload has {question: "..."}
    const clarification = interrupts.find(i => typeof i['question'] === 'string')
    if (clarification) {
      return [{ name: 'clarification_needed', data: { question: clarification['question'] as string } }]
    }

    // policy_review — payload has {steps: PlanStep[]}
    if (next.includes('policy_review')) {
      const steps = (payload['steps'] ?? []) as Record<string, unknown>[]
      const needsApproval = steps.some(s => s['policy'] === 'require_approval')
      return [{
        name: 'plan_ready',
        data: { steps, needs_approval: needsApproval },
      }]
    }

    // hitl_step_review — payload has {step_number, signal, proposed_action, message}
    if (next.includes('hitl_step_review')) {
      return [{
        name: 'step_review',
        data: {
          step_number:    payload['step_number'] ?? 1,
          signal:         payload['signal'] ?? null,
          proposed_action: payload['proposed_action'] ?? null,
          message:        payload['message'] ?? '',
        },
      }]
    }

    // analysis_summary — payload has {summary, findings, message}
    if (next.includes('analysis_summary')) {
      return [{
        name: 'analysis_summary',
        data: {
          summary:  payload['summary'] ?? '',
          findings: payload['findings'] ?? [],
          message:  payload['message'] ?? '',
        },
      }]
    }

    // propose_fix — payload has {fix_proposal, based_on_findings, message}
    if (next.includes('propose_fix')) {
      return [{
        name: 'propose_fix',
        data: {
          fix_proposal:     payload['fix_proposal'] ?? '',
          based_on_findings: payload['based_on_findings'] ?? [],
          message:          payload['message'] ?? '',
        },
      }]
    }

    return []
  }

  // ── Node lifecycle events ─────────────────────────────────────────────────
  if (!ev.node || !ev.event) return []

  const node = ev.node
  const rawData = ev.data as Record<string, unknown> | undefined
  const output = rawData?.['output'] as Record<string, unknown> | undefined

  // plan on_chain_end — no approval required, just display
  if (ev.event === 'on_chain_end' && node === 'plan') {
    const steps = (output?.['steps'] ?? []) as Record<string, unknown>[]
    if (steps.length > 0) {
      const needsApproval = steps.some(s => s['policy'] === 'require_approval')
      return [{ name: 'plan_ready', data: { steps, needs_approval: needsApproval } }]
    }
    return []
  }

  // act on_chain_start — extract tool name from state to show running indicator
  if (ev.event === 'on_chain_start' && node === 'act') {
    const input = rawData?.['input'] as Record<string, unknown> | undefined
    const thought = input?.['current_thought'] as Record<string, unknown> | undefined
    const toolName = thought?.['tool_name'] as string | undefined
    if (toolName) return [{ name: 'step_start', data: { tool: toolName } }]
    return []
  }

  if (ev.event !== 'on_chain_end') return []

  const out: MappedEvent[] = [{ name: 'node_done', data: { node } }]
  if (!output) return out

  // observe on_chain_end — new TAO entry in step_history
  if (node === 'observe' && Array.isArray(output['step_history'])) {
    const taos = output['step_history'] as Record<string, unknown>[]
    for (const tao of taos) {
      out.push({ name: 'step_observed', data: { tao } })
    }
  }

  // report — unchanged
  if (node === 'report' && output['report']) {
    out.push({
      name: 'report',
      data: { text: output['report'], metrics: output['metrics'] ?? {} },
    })
  }

  return out
}
