import { useCallback, useRef, useState } from 'react'
import { invokeStream, resumeStream, getEvents } from '../lib/gateway'
import { mapGatewayEvent } from '../lib/eventMapper'
import {
  formatEntities,
  formatStepReview,
  formatAnalysisSummary,
  formatProposeFix,
  formatObservation,
  formatReport,
} from '../lib/formatter'
import type { BudgetState, ChatMessage, EntityMap, HitlKind, PlanStep, ReportData, Tao } from '../lib/types'

export interface UseChatThreadReturn {
  messages:      ChatMessage[]
  awaitingReply: boolean
  placeholder:   string
  isRunning:     boolean
  budget:        BudgetState | null
  budgetHistory: { tokens: number; ts: number }[]
  send:          (text: string) => Promise<void>
  reset:         () => void
  autoApprove:   boolean
  setAutoApprove: (v: boolean) => void
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function make(
  role: ChatMessage['role'],
  kind: ChatMessage['kind'],
  text?: string,
): ChatMessage {
  return { id: uid(), role, kind, timestamp: Date.now(), text }
}

export function useChatThread(token: string | null): UseChatThreadReturn {
  const [messages, setMessages]         = useState<ChatMessage[]>([])
  const [isRunning, setIsRunning]       = useState(false)
  const [hitlKind, setHitlKind]         = useState<HitlKind>(null)
  const [budget, setBudget]             = useState<BudgetState | null>(null)
  const [budgetHistory, setBudgetHistory] = useState<{ tokens: number; ts: number }[]>([])
  const [autoApprove, setAutoApprove]   = useState(false)

  const threadIdRef      = useRef<string | null>(null)
  const lastSeenRef      = useRef(0)
  const abortRef         = useRef<AbortController | null>(null)
  const tokenRef         = useRef(token)
  const autoApproveRef   = useRef(autoApprove)
  const thinkingIdRef    = useRef<string | null>(null)
  const executingIdRef   = useRef<string | null>(null)
  const prevCompactedRef = useRef<boolean>(false)
  tokenRef.current       = token
  autoApproveRef.current = autoApprove

  // ── replaceThinking ────────────────────────────────────────────────────
  // Swaps the current thinking bubble with a real message.
  // If no thinking bubble exists, appends a new message.
  const replaceThinking = useCallback((text: string, kind: ChatMessage['kind'] = 'text') => {
    const thId = thinkingIdRef.current
    thinkingIdRef.current = null
    if (thId) {
      setMessages(prev => prev.map(m => m.id === thId ? { ...m, kind, text } : m))
    } else {
      setMessages(prev => [...prev, make('agent', kind, text)])
    }
  }, [])

  // ── appendStepLine ─────────────────────────────────────────────────────
  // Grows a single executing message. Replaces the thinking bubble on first call.
  const appendStepLine = useCallback((line: string) => {
    const execId = executingIdRef.current
    if (execId) {
      setMessages(prev =>
        prev.map(m => m.id === execId ? { ...m, text: (m.text ?? '') + '\n' + line } : m),
      )
      return
    }
    // First step: replace thinking or append fresh
    const thId = thinkingIdRef.current
    thinkingIdRef.current = null
    const m = make('agent', 'text', line)
    executingIdRef.current = m.id
    setMessages(prev => thId ? prev.map(x => x.id === thId ? m : x) : [...prev, m])
  }, [])

  // ── replaceOrAppendStepLine ────────────────────────────────────────────
  // For step results: finds and replaces the running ⏳ line for the same tool,
  // or appends if no running line exists yet.
  const replaceOrAppendStepLine = useCallback((tool: string, resultLine: string) => {
    const execId = executingIdRef.current
    const runningPrefix = `⏳ **${tool}**`
    if (execId) {
      setMessages(prev => prev.map(m => {
        if (m.id !== execId) return m
        const lines = (m.text ?? '').split('\n')
        const idx = lines.findIndex(l => l.startsWith(runningPrefix))
        if (idx >= 0) {
          lines[idx] = resultLine
          return { ...m, text: lines.join('\n') }
        }
        return { ...m, text: (m.text ?? '') + '\n' + resultLine }
      }))
      return
    }
    appendStepLine(resultLine)
  }, [appendStepLine])

  // ── handle ─────────────────────────────────────────────────────────────
  const handle = useCallback((type: string, data: Record<string, unknown>) => {
    switch (type) {
      case 'plan_ready': {
        const steps = data.steps as PlanStep[]
        const needsApproval = data.needs_approval as boolean
        const planMsg: ChatMessage = { ...make('agent', 'plan'), planSteps: steps }
        const thId = thinkingIdRef.current
        thinkingIdRef.current = null
        setMessages(prev => thId ? prev.map(m => m.id === thId ? planMsg : m) : [...prev, planMsg])
        if (needsApproval) setHitlKind('policy_review')
        break
      }

      case 'step_start':
        appendStepLine(`⏳ **${data.tool as string}** — running…`)
        break

      case 'entity_confirm':
        replaceThinking(formatEntities(data.entities as EntityMap))
        setHitlKind('entity')
        break

      case 'clarification_needed':
        replaceThinking(data.question as string)
        setHitlKind('clarification')
        break

      case 'step_review': {
        executingIdRef.current = null
        const text = formatStepReview(
          data.step_number as number,
          data.signal as string | null,
          data.proposed_action as { tool: string; inputs: Record<string, unknown> } | null,
        )
        setMessages(prev => [...prev, make('agent', 'text', text)])
        setHitlKind('step_review')
        break
      }

      case 'analysis_summary':
        executingIdRef.current = null
        setMessages(prev => [...prev, make('agent', 'text',
          formatAnalysisSummary(data.summary as string, data.findings as string[]))])
        setHitlKind('analysis_summary')
        break

      case 'propose_fix':
        setMessages(prev => [...prev, make('agent', 'text',
          formatProposeFix(data.fix_proposal as string))])
        setHitlKind('propose_fix')
        break

      case 'step_observed': {
        const tao = data.tao as Tao
        replaceOrAppendStepLine(tao.tool_name, formatObservation(tao))
        break
      }

      case 'report':
        executingIdRef.current = null
        replaceThinking(formatReport(data as unknown as ReportData))
        setIsRunning(false)
        setHitlKind(null)
        break

      case 'error':
        replaceThinking((data.message as string) ?? 'An error occurred.', 'error')
        setIsRunning(false)
        setHitlKind(null)
        break

      case 'budget': {
        const b = data as unknown as BudgetState
        setBudget(b)
        setBudgetHistory(prev => [...prev, { tokens: b.estimated_tokens, ts: Date.now() }])
        if (b.compacted && !prevCompactedRef.current) {
          setMessages(prev => [...prev, {
            id: uid(),
            role: 'agent',
            kind: 'compaction',
            timestamp: Date.now(),
            messagesEvicted: b.messages_evicted,
          }])
        }
        prevCompactedRef.current = b.compacted
        break
      }

      case 'done':
        setIsRunning(false)
        break
    }
  }, [replaceThinking, appendStepLine, replaceOrAppendStepLine])

  // ── startPolling ────────────────────────────────────────────────────────
  const startPolling = useCallback((threadId: string) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    lastSeenRef.current = 0

    const tick = async () => {
      if (ctrl.signal.aborted) return
      try {
        const { events } = await getEvents(threadId, lastSeenRef.current, tokenRef.current!)
        for (const { payload } of events) {
          for (const mapped of mapGatewayEvent(payload)) {
            if (mapped.name === 'done') { handle('done', {}); ctrl.abort(); return }
            handle(mapped.name, mapped.data)
          }
        }
        if (events.length > 0) lastSeenRef.current += events.length
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
      }
    }

    const id = setInterval(tick, 2000)
    void tick()
    ctrl.signal.addEventListener('abort', () => clearInterval(id))
  }, [handle])

  // ── send ────────────────────────────────────────────────────────────────
  // Handles both cases:
  //   hitlKind !== null → resumeStream (agent is waiting for this reply)
  //   hitlKind === null → invokeStream (new session; resets if one existed)
  const send = useCallback(async (text: string) => {
    if (!tokenRef.current || !text.trim()) return

    const isResuming = threadIdRef.current !== null && hitlKind !== null

    // Tear down a completed session before starting fresh
    if (!isResuming && threadIdRef.current !== null) {
      abortRef.current?.abort()
      abortRef.current = null
      threadIdRef.current = null
      thinkingIdRef.current = null
      executingIdRef.current = null
      lastSeenRef.current = 0
    }

    const userMsg = make('user', 'text', text)
    thinkingIdRef.current = null
    executingIdRef.current = null

    setHitlKind(null)
    setIsRunning(true)
    // Resume: append user message. New session: start fresh with just the user message.
    // ThinkingBubble is rendered by ChatThread while isRunning && !awaitingReply.
    setMessages(isResuming ? prev => [...prev, userMsg] : [userMsg])

    if (isResuming) {
      await resumeStream(threadIdRef.current!, text, tokenRef.current, autoApproveRef.current)
    } else {
      const threadId = await invokeStream(text, tokenRef.current, autoApproveRef.current)
      threadIdRef.current = threadId
      startPolling(threadId)
    }
  }, [hitlKind, startPolling])

  // ── reset ───────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    threadIdRef.current = null
    thinkingIdRef.current = null
    executingIdRef.current = null
    prevCompactedRef.current = false
    lastSeenRef.current = 0
    setMessages([])
    setIsRunning(false)
    setHitlKind(null)
    setBudget(null)
    setBudgetHistory([])
  }, [])

  // ── derived state ────────────────────────────────────────────────────────
  const awaitingReply = hitlKind !== null

  const placeholder = (isRunning && !awaitingReply)
    ? ''
    : hitlKind === 'entity'           ? 'Confirm or correct the extracted details…'
    : hitlKind === 'clarification'    ? 'Type your answer…'
    : hitlKind === 'step_review'      ? "Approve · Modify <feedback> · Reject"
    : hitlKind === 'analysis_summary' ? "Reply 'yes' to propose a fix, or 'no' to stop…"
    : hitlKind === 'propose_fix'      ? "Approve · Modify <feedback> · Reject"
    : hitlKind === 'policy_review'    ? "Type 'approve' to proceed or 'reject' to cancel…"
    : 'Describe the incident…'

  return { messages, awaitingReply, placeholder, isRunning, budget, budgetHistory, send, reset, autoApprove, setAutoApprove }
}
