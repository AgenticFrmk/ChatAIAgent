import type { ChatMessage as ChatMessageType } from '../lib/types'
import UserBubble from './UserBubble'
import AgentBubble from './AgentBubble'
import ThinkingBubble from './ThinkingBubble'
import ErrorBubble from './ErrorBubble'
import PlanBubble from './PlanBubble'

interface Props {
  msg: ChatMessageType
}

export default function ChatMessage({ msg }: Props) {
  if (msg.role === 'user') {
    return <UserBubble text={msg.text ?? ''} timestamp={msg.timestamp} />
  }

  if (msg.kind === 'thinking') return <ThinkingBubble />
  if (msg.kind === 'error') return <ErrorBubble text={msg.text ?? ''} />
  if (msg.kind === 'plan') return <PlanBubble steps={msg.planSteps ?? []} timestamp={msg.timestamp} />
  return <AgentBubble text={msg.text ?? ''} timestamp={msg.timestamp} />
}
