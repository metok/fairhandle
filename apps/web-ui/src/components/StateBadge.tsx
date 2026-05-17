import type { RoomState } from '../lib/api.js'

const COLORS: Record<RoomState, string> = {
  created: 'bg-gray-100 text-gray-700',
  waiting: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-800',
  consolidating: 'bg-blue-100 text-blue-800',
  paused: 'bg-amber-100 text-amber-800',
  closing: 'bg-gray-200 text-gray-700',
  closed: 'bg-gray-200 text-gray-700',
}

export function StateBadge({ state, hardLimit }: { state: RoomState; hardLimit: string | null }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${COLORS[state]}`}>
        {state}
      </span>
      {hardLimit && (
        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
          {hardLimit}
        </span>
      )}
    </span>
  )
}
