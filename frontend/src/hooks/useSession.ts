import { useState, useEffect } from 'react'
import type { Session } from '../lib/types'

const KEY = 'chat_ai_session'

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(load)

  // Sync when another tab/window writes to localStorage (e.g. login on chat page
  // while /remediation is open in a separate window)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setSession(load())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const saveSession = (s: Session) => {
    localStorage.setItem(KEY, JSON.stringify(s))
    setSession(s)
  }

  const clearSession = () => {
    localStorage.removeItem(KEY)
    setSession(null)
  }

  return { session, saveSession, clearSession }
}
