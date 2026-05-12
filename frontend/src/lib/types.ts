export interface Session {
  token: string
  username: string
}

export interface Tao {
  step_number: number
  reasoning: string
  tool_name: string
  inputs: Record<string, unknown>
  tool_output: string
  finding: string
}

export interface EntityMap {
  [domain: string]: Record<string, unknown>
}

export interface ReportData {
  text: string
  metrics: Record<string, number | undefined>
}

export interface BudgetState {
  budget_used: number
  estimated_tokens: number
  context_limit: number
  compacted: boolean
  messages_evicted: number
  strategy: string
}

// ── Chat message model ────────────────────────────────────────────────────
// All content is plain text (markdown). No special card types.

export type MessageRole = 'user' | 'agent'
export type MessageKind = 'text' | 'thinking' | 'error'

export interface ChatMessage {
  id: string
  role: MessageRole
  kind: MessageKind
  timestamp: number
  text?: string
}

export type AgentPhase =
  | 'idle'
  | 'streaming'
  | 'hitl_pending'
  | 'clarifying'
  | 'executing'
  | 'complete'
  | 'error'

export type HitlKind = 'entity' | 'clarification' | 'step_review' | 'analysis_summary' | 'propose_fix' | null
