import { useCallback, useRef, useState } from 'react'
import { invokeStream, resumeStream, getEvents } from '../lib/gateway'
import { mapGatewayEvent } from '../lib/eventMapper'
import { formatEntities, formatPlan, formatReport, stepLine } from '../lib/formatter'
import type { ChatMessage, EntityMap, PlanStep, ReportData, StepResult } from '../lib/types'

type HitlKind = 'entity' | 'clarification' | 'plan' | 'analysis' | null

export interface UseChatThreadReturn {
  messages:      ChatMessage[]
  awaitingReply: boolean
  placeholder:   string
  isRunning:     boolean
  send:          (text: string) => Promise<void>
  reset:         () => void
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
  const [messages, setMessages]   = useState<ChatMessage[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [hitlKind, setHitlKind]   = useState<HitlKind>(null)

  const threadIdRef     = useRef<string | null>(null)
  const lastSeenRef     = useRef(0)
  const abortRef        = useRef<AbortController | null>(null)
  const tokenRef        = useRef(token)
  const thinkingIdRef   = useRef<string | null>(null)
  const executingIdRef  = useRef<string | null>(null)
  tokenRef.current = token

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

  // ── handle ─────────────────────────────────────────────────────────────
  const handle = useCallback((type: string, data: Record<string, unknown>) => {
    switch (type) {
      case 'entity_confirm':
        replaceThinking(formatEntities(data.entities as EntityMap))
        setHitlKind('entity')
        break

      case 'clarification_needed':
        replaceThinking(data.question as string)
        setHitlKind('clarification')
        break

      case 'plan_ready':
        replaceThinking(formatPlan(data.steps as PlanStep[]))
        setHitlKind('plan')
        break

      case 'analysis_review':
        executingIdRef.current = null
        setMessages(prev => [...prev, make('agent', 'text', data.message as string)])
        setHitlKind('analysis')
        break

      case 'step_result':
        appendStepLine(stepLine(data as unknown as StepResult))
        break

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

      case 'done':
        setIsRunning(false)
        break
    }
  }, [replaceThinking, appendStepLine])

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

    // Build the user + thinking pair
    const userMsg  = make('user', 'text', text)
    const thinkMsg = make('agent', 'thinking')
    thinkingIdRef.current = thinkMsg.id
    executingIdRef.current = null

    setHitlKind(null)
    setIsRunning(true)
    // Resume: append to thread. New session: start fresh.
    setMessages(isResuming ? prev => [...prev, userMsg, thinkMsg] : [userMsg, thinkMsg])

    if (isResuming) {
      await resumeStream(threadIdRef.current!, text, tokenRef.current)
    } else {
      const threadId = await invokeStream(text, tokenRef.current)
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
    lastSeenRef.current = 0
    setMessages([])
    setIsRunning(false)
    setHitlKind(null)
  }, [])

  // ── derived state ────────────────────────────────────────────────────────
  const awaitingReply = hitlKind !== null

  const placeholder = (isRunning && !awaitingReply)
    ? ''
    : hitlKind === 'entity'        ? 'Confirm or correct the extracted details…'
    : hitlKind === 'clarification' ? 'Type your answer…'
    : hitlKind === 'plan'          ? "Reply 'yes' to execute, or describe changes…"
    : hitlKind === 'analysis'      ? "Reply 'yes' to apply fixes, or 'no' to stop…"
    : 'Describe the incident…'

  return { messages, awaitingReply, placeholder, isRunning, send, reset }
}
