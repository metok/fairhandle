import { useEffect, useState } from 'react'
import {
  fetchRoomState,
  fetchTranscript,
  fetchChain,
  type RoomStateResponse,
  type TranscriptEntry,
  type ChainEvent,
} from './api.js'

export interface RoomSnapshot {
  state: RoomStateResponse | null
  transcript: TranscriptEntry[]
  chain: ChainEvent[]
  error: Error | null
}

/** Polls a single MCP server's HTTP endpoint for one room every 750ms. */
export function useRoomState(roomId: string | null, base = ''): RoomSnapshot {
  const [snap, setSnap] = useState<RoomSnapshot>({
    state: null,
    transcript: [],
    chain: [],
    error: null,
  })

  useEffect(() => {
    if (!roomId) {
      setSnap({ state: null, transcript: [], chain: [], error: null })
      return
    }
    let alive = true
    const tick = async () => {
      try {
        const [state, transcript, chain] = await Promise.all([
          fetchRoomState(roomId, base),
          fetchTranscript(roomId, base),
          fetchChain(roomId, base),
        ])
        if (alive) setSnap({ state, transcript, chain: chain.events, error: null })
      } catch (e) {
        if (alive) setSnap((prev) => ({ ...prev, error: e as Error }))
      }
    }
    const id = setInterval(() => void tick(), 750)
    void tick()
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [roomId, base])

  return snap
}
