import { useRef, useState } from 'react'
import { Send } from 'lucide-react'

interface Props {
  onSend: (text: string) => Promise<void>
  disabled: boolean
  placeholder: string
}

export default function ChatInputBar({ onSend, disabled, placeholder }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const canSend = !disabled && !sending && text.trim().length > 0

  const handleSend = async () => {
    if (!canSend) return
    const message = text.trim()
    setText('')
    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setSending(true)
    try {
      await onSend(message)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  return (
    <div className="flex-shrink-0 border-t border-[#1c2333] bg-[#0d1117] px-4 py-3">
      <div className="max-w-3xl mx-auto flex gap-3 items-end">
        <div className={`flex-1 bg-[#161b22] border rounded-2xl transition-colors ${
          disabled
            ? 'border-[#1c2333] opacity-50 cursor-not-allowed'
            : 'border-[#30363d] focus-within:border-purple-500/50 focus-within:ring-1 focus-within:ring-purple-500/20'
        }`}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            disabled={disabled || sending}
            placeholder={disabled ? 'Agent is working…' : placeholder}
            rows={1}
            className="w-full bg-transparent px-4 py-3 text-sm text-[#e6edf3] placeholder-[#484f58]
                       outline-none resize-none disabled:cursor-not-allowed"
            style={{ maxHeight: '160px' }}
          />
        </div>

        <button
          onClick={() => void handleSend()}
          disabled={!canSend}
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all
                     bg-purple-600 hover:bg-purple-500 disabled:opacity-30 disabled:cursor-not-allowed
                     disabled:hover:bg-purple-600"
        >
          <Send className="w-4 h-4 text-white" />
        </button>
      </div>

      <p className="text-[10px] text-[#484f58] text-center mt-2">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  )
}
