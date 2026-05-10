// Converts raw agent event payloads into markdown text for chat bubbles.

import type { EntityMap, PlanStep, ReportData, StepResult } from './types'

export function formatEntities(entities: EntityMap): string {
  const rows: string[] = []

  for (const [, fields] of Object.entries(entities)) {
    for (const [key, value] of Object.entries(fields)) {
      if (value === null || value === undefined) continue
      const display = Array.isArray(value) ? value.join(', ') : String(value)
      rows.push(`| ${key.replace(/_/g, ' ')} | ${display} |`)
    }
  }

  if (rows.length === 0) return 'No entities extracted.'

  return [
    'I extracted these from your incident:\n',
    '| Field | Value |',
    '|---|---|',
    ...rows,
    '\nDoes this look right? Confirm or tell me what to correct.',
  ].join('\n')
}

export function formatPlan(steps: PlanStep[]): string {
  // Group steps by wave (steps with no dependencies = wave 1, etc.)
  const waves = groupIntoWaves(steps)

  const lines: string[] = ['Here\'s my plan — analysis first, then remediation:\n']

  waves.forEach((wave, i) => {
    lines.push(`**Wave ${i + 1}${wave.length > 1 ? ' (parallel)' : ''}**`)
    for (const s of wave) {
      const phaseTag = s.phase === 'remediation' ? ' *(fix)*' : ' *(diagnose)*'
      lines.push(`- **${s.tool}**${phaseTag} — ${s.description}`)
    }
    lines.push('')
  })

  lines.push("Ready to execute? Reply 'yes' to proceed, or describe any changes.")
  return lines.join('\n')
}

export function stepLine(result: StepResult): string {
  const icon = result.status === 'success' ? '✓' : result.status === 'error' ? '✗' : '⏳'
  const detail = summariseOutput(result.output)
  return `${icon} **${result.tool}**${detail ? ` — ${detail}` : ''}`
}

export function formatReport(report: ReportData): string {
  const lines: string[] = ['**Incident resolved.**\n', report.text]

  const metrics = Object.entries(report.metrics).filter(([, v]) => v !== undefined)
  if (metrics.length > 0) {
    lines.push('\n| Metric | Value |', '|---|---|')
    for (const [k, v] of metrics) {
      lines.push(`| ${k.replace(/_/g, ' ')} | ${v} |`)
    }
  }

  return lines.join('\n')
}

// ── helpers ───────────────────────────────────────────────────────────────

function groupIntoWaves(steps: PlanStep[]): PlanStep[][] {
  const waves: PlanStep[][] = []
  const placed = new Set<string>()

  let remaining = [...steps]
  while (remaining.length > 0) {
    const wave = remaining.filter(s =>
      s.dependencies.every(d => placed.has(d)),
    )
    if (wave.length === 0) {
      // Circular or unresolvable — dump the rest in one wave
      waves.push(remaining)
      break
    }
    waves.push(wave)
    wave.forEach(s => placed.add(s.id))
    remaining = remaining.filter(s => !placed.has(s.id))
  }

  return waves
}

function summariseOutput(output: unknown): string {
  if (!output || typeof output !== 'object') return ''
  const o = output as Record<string, unknown>
  // Surface the most useful single field
  for (const key of ['message', 'status', 'id', 'result']) {
    if (typeof o[key] === 'string') return o[key] as string
  }
  return ''
}
