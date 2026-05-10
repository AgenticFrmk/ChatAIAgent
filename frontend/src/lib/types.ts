export interface Session {
  token: string
  username: string
}

export interface PlanStep {
  id: string
  tool: string
  name: string
  description: string
  parameters: Record<string, unknown>
  expected_output: string
  dependencies: string[]
  phase?: 'analysis' | 'remediation'
  status?: string
}

export interface StepResult {
  step_id: string
  tool: string
  status: string
  output: unknown
  input?: Record<string, unknown>
  api_url?: string | null
}

export interface EntityMap {
  [domain: string]: Record<string, unknown>
}

export interface ReportData {
  text: string
  metrics: Record<string, number | undefined>
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
