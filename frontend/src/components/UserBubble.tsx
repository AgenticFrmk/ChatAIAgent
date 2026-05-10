interface Props {
  text: string
  timestamp: number
}

export default function UserBubble({ text, timestamp }: Props) {
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex justify-end">
      <div className="max-w-[75%]">
        <div className="bg-purple-600/20 border border-purple-500/20 rounded-2xl rounded-tr-sm px-4 py-3">
          <p className="text-sm text-[#e6edf3] whitespace-pre-wrap break-words">{text}</p>
        </div>
        <p className="text-[10px] text-[#484f58] mt-1 text-right">{time}</p>
      </div>
    </div>
  )
}
