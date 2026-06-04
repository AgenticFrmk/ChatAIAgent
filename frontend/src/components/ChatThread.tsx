import { useEffect, useRef } from 'react'
import { Zap } from 'lucide-react'
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
            <p className="text-gray-600 text-sm">
              Describe an incident and the agent will investigate, plan, and remediate.
            </p>
            <p className="text-gray-600 text-xs">
              e.g. "Our VPN tunnels to Boston and Chicago keep dropping. Phase 2 renegotiating."
            </p>
          </div>
        )}
        {messages.map(msg => {
          if (msg.kind === 'compaction') {
            return (
              <div key={msg.id} className="flex items-center gap-3 px-6 py-2 select-none">
                <div className="flex-1 h-px bg-orange-200" />
                <span className="text-[11px] text-orange-600 flex items-center gap-1 whitespace-nowrap">
                  <Zap className="w-3 h-3" />
                  Context compacted
                  {msg.messagesEvicted ? ` — ${msg.messagesEvicted} older messages summarized` : ''}
                </span>
                <div className="flex-1 h-px bg-orange-200" />
              </div>
            )
          }
          return <ChatMessage key={msg.id} msg={msg} />
        })}
        {showThinking && <ThinkingBubble />}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
