import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../hooks/useSession'
import { useChatThread } from '../hooks/useChatThread'
import ChatHeader from '../components/ChatHeader'
import ChatThread from '../components/ChatThread'
import ChatInputBar from '../components/ChatInputBar'
import WarningBanner from '../components/WarningBanner'
import CompactionBanner from '../components/CompactionBanner'

export default function ChatPage() {
  const navigate = useNavigate()
  const { session, clearSession } = useSession()
  const { messages, awaitingReply, placeholder, isRunning, budget, budgetHistory, send, reset } = useChatThread(
    session?.token ?? null,
  )

  const [showCompaction, setShowCompaction] = useState(false)
  const [compactionData, setCompactionData] = useState({ evicted: 0, headroom: 0 })
  const prevCompacted = useRef(false)

  useEffect(() => {
    if (!session) navigate('/login', { replace: true })
  }, [session, navigate])

  useEffect(() => {
    if (!budget) return
    const { compacted, messages_evicted, estimated_tokens } = budget
    if (compacted && !prevCompacted.current) {
      const headroomPct = Math.round((messages_evicted / Math.max(1, messages_evicted + estimated_tokens / 4)) * 100)
      setCompactionData({ evicted: messages_evicted, headroom: Math.min(headroomPct, 99) })
      setShowCompaction(true)
      const t = setTimeout(() => setShowCompaction(false), 4000)
      prevCompacted.current = true
      return () => clearTimeout(t)
    }
    if (!compacted) prevCompacted.current = false
  }, [budget])

  const handleLogout = () => {
    reset()
    clearSession()
    navigate('/login')
  }

  if (!session) return null

  return (
    <div className="h-screen flex flex-col bg-[#080b10]">
      <ChatHeader
        username={session.username}
        isRunning={isRunning}
        awaitingReply={awaitingReply}
        hasMessages={messages.length > 0}
        budget={budget}
        budgetHistory={budgetHistory}
        onReset={reset}
        onLogout={handleLogout}
      />

      <CompactionBanner
        visible={showCompaction}
        messagesEvicted={compactionData.evicted}
        headroomPct={compactionData.headroom}
      />
      <WarningBanner budgetUsed={budget?.budget_used ?? 0} />

      <div className="flex-1 overflow-hidden flex flex-col">
        <ChatThread messages={messages} />
        <ChatInputBar
          onSend={send}
          disabled={isRunning && !awaitingReply}
          placeholder={placeholder}
        />
      </div>
    </div>
  )
}
