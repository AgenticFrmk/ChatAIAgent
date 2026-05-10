import { useState } from 'react'
import type { Session } from '../lib/types'

const KEY = 'chat_ai_session'

function load(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(load)

  const saveSession = (s: Session) => {
    sessionStorage.setItem(KEY, JSON.stringify(s))
    setSession(s)
  }

  const clearSession = () => {
    sessionStorage.removeItem(KEY)
    setSession(null)
  }

  return { session, saveSession, clearSession }
}
