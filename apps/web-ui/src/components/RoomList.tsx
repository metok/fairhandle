import type { RoomSummary } from '../lib/api.js'

export function RoomList({
  rooms,
  selected,
  onSelect,
}: {
  rooms: RoomSummary[]
  selected: string | null
  onSelect: (roomId: string) => void
}) {
  if (rooms.length === 0) {
    return <p className="text-sm text-gray-400">No rooms yet.</p>
  }
  return (
    <ul className="space-y-1">
      {rooms.map((r) => (
        <li key={r.room_id}>
          <button
            type="button"
            onClick={() => onSelect(r.room_id)}
            className={`w-full rounded px-3 py-2 text-left text-sm ${
              selected === r.room_id ? 'bg-gray-900 text-white' : 'hover:bg-gray-100'
            }`}
          >
            <div className="font-mono text-xs">{r.room_id.slice(0, 13)}…</div>
            <div className={selected === r.room_id ? 'text-gray-300' : 'text-gray-500'}>
              {r.state}
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}
