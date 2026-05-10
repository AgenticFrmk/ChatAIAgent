// ── AgentGateway client ───────────────────────────────────────────────────
// Same endpoints as SREDemo. VITE_GATEWAY_URL defaults to '/gateway' for
// nginx reverse-proxy (or set to http://localhost:8000 for local dev without nginx).

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

async function _request<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
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

export async function invokeStream(message: string, token: string): Promise<string> {
  const data = await _request<{ thread_id: string }>(
    '/invoke/stream',
    { method: 'POST', body: JSON.stringify({ message }) },
    token,
  )
  return data.thread_id
}

export async function resumeStream(threadId: string, response: string, token: string): Promise<void> {
  await _request(
    '/resume/stream',
    { method: 'POST', body: JSON.stringify({ thread_id: threadId, response }) },
    token,
  )
}

export async function getEvents(
  threadId: string,
  fromIndex: number,
  token: string,
): Promise<EventsResponse> {
  return _request<EventsResponse>(
    `/events/${encodeURIComponent(threadId)}?from=${fromIndex}`,
    { method: 'GET' },
    token,
  )
}
