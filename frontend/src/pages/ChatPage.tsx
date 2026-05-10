import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../hooks/useSession'
import { useChatThread } from '../hooks/useChatThread'
import ChatHeader from '../components/ChatHeader'
import ChatThread from '../components/ChatThread'
import ChatInputBar from '../components/ChatInputBar'

export default function ChatPage() {
  const navigate = useNavigate()
  const { session, clearSession } = useSession()
  const { messages, awaitingReply, placeholder, isRunning, send, reset } = useChatThread(
    session?.token ?? null,
  )

  useEffect(() => {
    if (!session) navigate('/login', { replace: true })
  }, [session, navigate])

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
        onReset={reset}
        onLogout={handleLogout}
      />

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
