import { useCallback, useRef, useState } from 'react'
import { createConversation, invokeStream, resumeStream, openEventStream } from '../lib/gateway'
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
  messages:         ChatMessage[]
  awaitingReply:    boolean
  placeholder:      string
  isRunning:        boolean
  chainLabel:       string | null
  budget:           BudgetState | null
  budgetHistory:    { tokens: number; ts: number }[]
  initConversation: () => Promise<void>
  send:             (text: string) => Promise<void>
  reset:            () => void
  autoApprove:      boolean
  setAutoApprove:   (v: boolean) => void
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

export function useChatThread(userToken: string | null): UseChatThreadReturn {
  const [messages, setMessages]         = useState<ChatMessage[]>([])
  const [isRunning, setIsRunning]       = useState(false)
  const [hitlKind, setHitlKind]         = useState<HitlKind>(null)
  const [budget, setBudget]             = useState<BudgetState | null>(null)
  const [budgetHistory, setBudgetHistory] = useState<{ tokens: number; ts: number }[]>([])
  const [autoApprove, setAutoApprove]   = useState(false)

  const conversationTokenRef = useRef<string | null>(null)
  const abortRef         = useRef<AbortController | null>(null)
  const userTokenRef         = useRef(userToken)
  const autoApproveRef   = useRef(autoApprove)
  const thinkingIdRef    = useRef<string | null>(null)
  const executingIdRef   = useRef<string | null>(null)
  const prevCompactedRef = useRef<boolean>(false)
  const chainActiveRef   = useRef(false)
  const pendingReportRef = useRef<ReportData | null>(null)
  const chainOpaRef      = useRef<string>('UNKNOWN')

  const [chainLabel, setChainLabel] = useState<string | null>(null)
  userTokenRef.current       = userToken
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

      case 'chain_result':
        chainOpaRef.current = (data.opa_decision as string) ?? 'UNKNOWN'
        break

      case 'report':
        executingIdRef.current = null
        // Hold report text until chain completes — show dispatch indicator first
        pendingReportRef.current = data as unknown as ReportData
        chainActiveRef.current = true
        chainOpaRef.current = 'UNKNOWN'
        setChainLabel('Dispatching to remediation-agent via OBO chain…')
        setHitlKind(null)
        break

      case 'error':
        chainActiveRef.current = false
        setChainLabel(null)
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
        if (chainActiveRef.current) {
          chainActiveRef.current = false
          setChainLabel(null)
          const pending = pendingReportRef.current
          pendingReportRef.current = null
          const opaDecision = chainOpaRef.current
          const chainMsg = opaDecision === 'ALLOW'
            ? '✓ Remediation plan dispatched — [view results →](/remediation)'
            : `⛔ Remediation blocked by OPA (${opaDecision}) — [view policy details →](/remediation)`
          setMessages(prev => {
            const next = [...prev]
            if (pending) next.push(make('agent', 'text', formatReport(pending, opaDecision)))
            next.push(make('agent', opaDecision === 'ALLOW' ? 'text' : 'error', chainMsg))
            return next
          })
        }
        setIsRunning(false)
        break
    }
  }, [replaceThinking, appendStepLine, replaceOrAppendStepLine])

  // ── startStreaming ──────────────────────────────────────────────────────
  // ── startStreaming ──────────────────────────────────────────────────────
  // Opens a long-lived SSE connection to GET /stream (via nginx → Envoy → sre-agent).
  // The same connection receives events for all invocations within the conversation —
  // it stays open through HITL interrupts and only closes on 'done' or 'error'.
  const startStreaming = useCallback(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    openEventStream(
      conversationTokenRef.current!,
      userTokenRef.current!,
      (event) => {
        for (const mapped of mapGatewayEvent(event)) {
          handle(mapped.name, mapped.data)
        }
      },
      () => handle('done', {}),
      (err) => handle('error', { message: err.message }),
      ctrl.signal,
    ).catch(() => {}) // errors already routed to onError callback above
  }, [handle])

  // ── initConversation ───────────────────────────────────────────────────
  // Called once when the chat UI mounts (or on new chat). Creates the conversation
  // on the backend, then opens the SSE connection so it is ready before any graph
  // invocation starts — eliminating the race between invoke and SSE subscribe.
  const initConversation = useCallback(async () => {
    if (!userTokenRef.current) return
    const conversationToken = await createConversation(userTokenRef.current)
    conversationTokenRef.current = conversationToken
    startStreaming()
  }, [startStreaming])

  // ── send ────────────────────────────────────────────────────────────────
  // hitlKind !== null  →  resumeStream (agent paused at HITL, waiting for reply)
  // hitlKind === null  →  invokeStream (new graph invocation on existing conversation)
  // SSE connection is already open from initConversation — not managed here.
  const send = useCallback(async (text: string) => {
    if (!userTokenRef.current || !conversationTokenRef.current || !text.trim()) return

    const userMsg = make('user', 'text', text)
    thinkingIdRef.current = null
    executingIdRef.current = null
    setHitlKind(null)
    setIsRunning(true)

    if (hitlKind !== null) {
      setMessages(prev => [...prev, userMsg])
      await resumeStream(conversationTokenRef.current!, text, userTokenRef.current!, autoApproveRef.current)
    } else {
      setMessages([userMsg])
      await invokeStream(conversationTokenRef.current!, text, userTokenRef.current!, autoApproveRef.current)
    }
  }, [hitlKind])

  // ── reset ───────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    conversationTokenRef.current = null
    thinkingIdRef.current = null
    executingIdRef.current = null
    prevCompactedRef.current = false
    chainActiveRef.current = false
    pendingReportRef.current = null
    chainOpaRef.current = 'UNKNOWN'
    setMessages([])
    setIsRunning(false)
    setHitlKind(null)
    setChainLabel(null)
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

  return { messages, awaitingReply, placeholder, isRunning, chainLabel, budget, budgetHistory, initConversation, send, reset, autoApprove, setAutoApprove }
}
