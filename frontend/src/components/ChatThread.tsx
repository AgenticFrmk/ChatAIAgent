import { useEffect, useRef } from 'react'
import type { ChatMessage as ChatMessageType } from '../lib/types'
import ChatMessage from './ChatMessage'
import ThinkingBubble from './ThinkingBubble'

interface Props {
  messages: ChatMessageType[]
  isRunning: boolean
  awaitingReply: boolean
}

export default function ChatThread({ messages, isRunning, awaitingReply }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isRunning])

  const showThinking = isRunning && !awaitingReply

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
            <p className="text-[#484f58] text-sm">
              Describe an incident and the agent will investigate, plan, and remediate.
            </p>
            <p className="text-[#30363d] text-xs">
              e.g. "Our VPN tunnels to Boston and Chicago keep dropping. Phase 2 renegotiating."
            </p>
          </div>
        )}
        {messages.map(msg => (
          <ChatMessage key={msg.id} msg={msg} />
        ))}
        {showThinking && <ThinkingBubble />}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
