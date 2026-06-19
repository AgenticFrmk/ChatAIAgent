// ── Envoy sidecar client ──────────────────────────────────────────────────
// VITE_GATEWAY_URL defaults to '/gateway' (nginx → Envoy proxy).
// For local dev without nginx: set to http://localhost:10000.

const GATEWAY_URL = (import.meta.env.VITE_GATEWAY_URL as string | undefined) ?? '/gateway'

export class GatewayError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

export interface GatewayEvent {
  node?: string
  event?: string
  data?: unknown
  type?: string
  detail?: string
  next?: string[]
  interrupts?: Array<Record<string, unknown>>
  estimated_tokens?: number
  context_limit?: number
  budget_used?: number
  compacted?: boolean
  messages_evicted?: number
  strategy?: string
}

export interface EventsResponse {
  events: { index: number; payload: GatewayEvent }[]
  total: number
}

async function _request<T>(
  path: string,
  init: RequestInit,
  userToken?: string,
  conversationToken?: string,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (userToken)         headers['Authorization']       = `Bearer ${userToken}`
  if (conversationToken) headers['X-Conversation-Token'] = conversationToken
  const res = await fetch(`${GATEWAY_URL}${path}`, { ...init, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new GatewayError(res.status, text)
  }
  return res.json() as Promise<T>
}

export async function login(username: string, password: string): Promise<string> {
  const body = new URLSearchParams({ username, password, grant_type: 'password' })
  const res = await fetch(`${GATEWAY_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new GatewayError(res.status, text)
  }
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}

export async function createConversation(userToken: string): Promise<string> {
  const data = await _request<{ conversation_token: string }>(
    '/conversation',
    { method: 'POST' },
    userToken,
  )
  return data.conversation_token
}

export async function invokeStream(
  conversationToken: string,
  message: string,
  userToken: string,
  autoApprove = false,
): Promise<void> {
  await _request(
    '/graph/invoke/stream',
    { method: 'POST', body: JSON.stringify({ message, auto_approve: autoApprove }) },
    userToken,
    conversationToken,
  )
}

export async function resumeStream(
  conversationToken: string,
  response: string,
  userToken: string,
  autoApprove = false,
): Promise<void> {
  await _request(
    '/graph/resume/stream',
    { method: 'POST', body: JSON.stringify({ response, auto_approve: autoApprove }) },
    userToken,
    conversationToken,
  )
}

export async function openEventStream(
  conversationToken: string,
  userToken: string,
  onEvent: (event: GatewayEvent) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  signal: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${GATEWAY_URL}/stream`, {
      method: 'GET',
      headers: {
        'Authorization':       `Bearer ${userToken}`,
        'X-Conversation-Token': conversationToken,
      },
      signal,
    })
  } catch (err) {
    if ((err as Error).name !== 'AbortError') onError(err as Error)
    return
  }

  if (!res.ok) {
    onError(new GatewayError(res.status, await res.text().catch(() => res.statusText)))
    return
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (!raw) continue
        try {
          const event = JSON.parse(raw) as GatewayEvent
          if (event.type === 'done') { onDone(); return }
          if (event.type === 'error') { onError(new Error((event as any).detail ?? 'stream error')); return }
          onEvent(event)
        } catch { /* skip malformed lines */ }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') onError(err as Error)
  } finally {
    reader.releaseLock()
  }
}

export async function getHistory(userToken: string, limit = 100): Promise<Record<string, unknown>[]> {
  return _request<Record<string, unknown>[]>(
    `/history?limit=${limit}`,
    { method: 'GET' },
    userToken,
  )
}
