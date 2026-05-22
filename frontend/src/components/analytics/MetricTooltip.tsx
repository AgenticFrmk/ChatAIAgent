export default function MetricTooltip({ text }: { text: string }) {
  return (
    <span className="relative group ml-1.5 cursor-help inline-flex items-center">
      <span className="text-gray-400 text-[10px] border border-gray-300 rounded-full w-3.5 h-3.5 inline-flex items-center justify-center leading-none select-none">?</span>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-20 leading-relaxed shadow-lg">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
      </span>
    </span>
  )
}
