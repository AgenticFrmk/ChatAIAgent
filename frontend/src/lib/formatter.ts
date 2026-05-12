// Converts raw agent event payloads into markdown text for chat bubbles.

import type { EntityMap, ReportData, Tao } from './types'

export function formatEntities(entities: EntityMap): string {
  const rows: string[] = []

  for (const [, fields] of Object.entries(entities)) {
    for (const [key, value] of Object.entries(fields)) {
      if (value === null || value === undefined) continue
      const display = Array.isArray(value) ? value.join(', ') : String(value)
      rows.push(`| ${key.replace(/_/g, ' ')} | ${display} |`)
    }
  }

  if (rows.length === 0) {
    return "I didn't need any specific details for this request. Reply 'yes' to proceed or describe any additional context."
  }

  return [
    'I extracted these from your incident:\n',
    '| Field | Value |',
    '|---|---|',
    ...rows,
    '\nDoes this look right? Confirm or tell me what to correct.',
  ].join('\n')
}

export function formatStepReview(
  stepNumber: number,
  signal: string | null,
  proposedAction: { tool: string; inputs: Record<string, unknown> } | null,
): string {
  if (signal === 'ANALYSIS_DONE') {
    return [
      `**Analysis phase complete** (${stepNumber} step${stepNumber !== 1 ? 's' : ''} run)`,
      '',
      'Approve to review the findings summary, or Reject to stop.',
    ].join('\n')
  }
  if (signal === 'REMEDIATION_DONE') {
    return [
      `**Remediation phase complete** (${stepNumber} step${stepNumber !== 1 ? 's' : ''} run)`,
      '',
      'Approve to generate the final report, or Reject to stop.',
    ].join('\n')
  }

  const tool = proposedAction?.tool ?? '(unknown)'
  const inputs = proposedAction?.inputs ?? {}
  const inputStr = Object.keys(inputs).length > 0
    ? JSON.stringify(inputs)
    : '{}'

  return [
    `**Step ${stepNumber}** — \`${tool}(${inputStr})\``,
    '',
    'Approve · Modify `<feedback>` · Reject',
  ].join('\n')
}

export function formatAnalysisSummary(
  summary: string,
  findings: string[],
): string {
  const findingLines = findings.length > 0
    ? findings.map((f, i) => `${i + 1}. ${f}`).join('\n')
    : '(no findings recorded)'

  return [
    '**Root cause analysis**',
    '',
    summary,
    '',
    '**Findings:**',
    findingLines,
    '',
    "Do you want me to propose a fix? Reply 'yes' to proceed or 'no' to stop.",
  ].join('\n')
}

export function formatProposeFix(fixProposal: string): string {
  return [
    '**Proposed remediation plan**',
    '',
    fixProposal,
    '',
    'Approve · Modify `<feedback>` · Reject',
  ].join('\n')
}

export function formatObservation(tao: Tao): string {
  const icon = '✓'
  return `${icon} **${tao.tool_name}** — ${tao.finding}`
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
