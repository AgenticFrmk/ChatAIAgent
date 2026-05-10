import type { GatewayEvent } from './gateway'

export interface MappedEvent {
  name: string
  data: Record<string, unknown>
}

/**
 * Translates raw AgentBE events into semantic ChatAIAgent events.
 *
 * AgentBE emits two shapes:
 *   • Node events  — {node, event: "on_chain_start"|"on_chain_end", data: {output: {...}}}
 *   • Control      — {type: "interrupt"|"done"|"error"|"usage", ...}
 *
 * AgentGateway rewrites "usage" → "budget" before the frontend sees it.
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

    // entity_confirm interrupt (new HITL gate #2)
    // Payload: {entities: {...}}  set by entity_confirm.py interrupt()
    if (next.includes('entity_confirm')) {
      const payload = interrupts[0] ?? {}
      return [{ name: 'entity_confirm', data: { entities: payload['entities'] ?? {} } }]
    }

    // clarify interrupt (HITL gate #1)
    // Payload: {question: "..."} set by clarify.py interrupt()
    const clarification = interrupts.find(i => typeof i['question'] === 'string')
    if (clarification) {
      return [{ name: 'clarification_needed', data: { question: clarification['question'] as string } }]
    }

    // analysis_review interrupt (HITL gate between analysis and remediation)
    if (next.includes('analysis_review')) {
      const payload = interrupts[0] ?? {}
      return [{ name: 'analysis_review', data: { message: payload['message'] ?? '' } }]
    }

    // hitl_review interrupt (HITL gate #3 — plan approval)
    // plan_ready is already emitted from the plan node's on_chain_end — ignore here.
    return []
  }

  // ── Node lifecycle events ─────────────────────────────────────────────────
  if (!ev.node || !ev.event) return []

  const node = ev.node
  const rawData = ev.data as Record<string, unknown> | undefined
  const output = rawData?.['output'] as Record<string, unknown> | undefined

  if (ev.event === 'on_chain_start') {
    return [{ name: 'node_start', data: { node } }]
  }
  if (ev.event !== 'on_chain_end') return []

  const out: MappedEvent[] = [{ name: 'node_done', data: { node } }]
  if (!output) return out

  // extract_entities on_chain_end is skipped — entity_confirm interrupt is the HITL gate
  // that shows the entity table. Emitting both caused a duplicate message.

  // plan_ready — from plan node output; triggers awaitingReply for plan approval
  if (node === 'plan' && output['plan']) {
    const plan = output['plan'] as Record<string, unknown>
    const rawSteps = plan['steps'] as Record<string, unknown>[] | undefined
    if (rawSteps && rawSteps.length > 0) {
      const steps = rawSteps.map(s => ({
        ...s,
        tool: s['tool'] ?? s['tool_name'],
        parameters: s['parameters'] ?? s['inputs'] ?? {},
        phase: s['phase'] ?? 'analysis',
      }))
      out.push({ name: 'plan_ready', data: { steps } })
    }
  }

  // step_result — execute_step node
  if (node === 'execute_step' && output['step_results']) {
    const results = output['step_results'] as Record<string, Record<string, unknown>>
    for (const [step_id, result] of Object.entries(results)) {
      out.push({
        name: 'step_result',
        data: {
          step_id,
          tool:    result['tool'] ?? '',
          status:  result['status'] ?? 'done',
          output:  result['output'] ?? result,
          input:   result['inputs'] ?? result['input'] ?? {},
          api_url: result['api_url'] ?? null,
        },
      })
    }
  }

  // report — report node
  if (node === 'report' && output['report']) {
    out.push({
      name: 'report',
      data: { text: output['report'], metrics: output['metrics'] ?? {} },
    })
  }

  return out
}
