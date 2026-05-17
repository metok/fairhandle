import { useState, useEffect } from 'react'
import { fetchRooms, type RoomSummary } from './lib/api.js'
import { RoomList } from './components/RoomList.js'
import { RoomDetail } from './components/RoomDetail.js'

export function App() {
  const [rooms, setRooms] = useState<RoomSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const { rooms: r } = await fetchRooms()
        if (alive) setRooms(r)
      } catch {
        // server may not be up yet; keep polling
      }
    }
    const id = setInterval(() => void tick(), 2000)
    void tick()
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  // Auto-select the only room if there's exactly one and nothing chosen.
  useEffect(() => {
    if (!selected && rooms.length === 1) setSelected(rooms[0]!.room_id)
  }, [rooms, selected])

  return (
    <div className="flex min-h-screen">
      <aside className="w-72 border-r border-gray-200 bg-white p-4">
        <h1 className="mb-1 text-xl font-semibold">fairhandle</h1>
        <p className="mb-4 text-xs text-gray-400">live negotiation view</p>
        <RoomList rooms={rooms} selected={selected} onSelect={setSelected} />
      </aside>
      <main className="flex-1">
        {selected ? (
          <RoomDetail roomId={selected} />
        ) : (
          <div className="p-8 text-gray-500">Select a room.</div>
        )}
      </main>
    </div>
  )
}
