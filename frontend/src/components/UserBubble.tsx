interface Props {
  text: string
  timestamp: number
}

export default function UserBubble({ text, timestamp }: Props) {
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex justify-end">
      <div className="max-w-[75%]">
        <div className="bg-orange-700 rounded-2xl rounded-tr-sm px-4 py-3">
          <p className="text-sm text-white whitespace-pre-wrap break-words">{text}</p>
        </div>
        <p className="text-[10px] text-gray-600 mt-1 text-right">{time}</p>
      </div>
    </div>
  )
}
