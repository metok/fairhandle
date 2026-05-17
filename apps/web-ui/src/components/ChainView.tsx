import type { ChainEvent } from '../lib/api.js'

export function ChainView({ events }: { events: ChainEvent[] }) {
  if (events.length === 0) {
    return <div className="p-6 text-gray-500">Empty chain.</div>
  }
  return (
    <div className="p-6">
      <ol className="space-y-1">
        {events.map((e) => (
          <li
            key={e.index}
            className="flex items-center gap-3 rounded border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <span className="w-8 text-right font-mono text-gray-400">{e.index}</span>
            <span className="font-mono text-gray-800">{e.payload.type}</span>
            <span className="ml-auto font-mono text-xs text-gray-400">{e.hash.slice(0, 16)}…</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
