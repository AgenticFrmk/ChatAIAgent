import { AlertTriangle } from 'lucide-react'

interface Props {
  text: string
}

export default function ErrorBubble({ text }: Props) {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
      </div>

      <div className="bg-red-50 border border-red-200 rounded-2xl rounded-tl-sm px-4 py-3">
        <p className="text-sm text-red-700">{text}</p>
      </div>
    </div>
  )
}
