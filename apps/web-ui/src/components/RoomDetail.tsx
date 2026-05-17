import { useState } from 'react'
import { useRoomState } from '../lib/useRoomState.js'
import { StateBadge } from './StateBadge.js'
import { ArtifactView } from './ArtifactView.js'
import { Transcript } from './Transcript.js'
import { ChainView } from './ChainView.js'

type Tab = 'artifact' | 'transcript' | 'chain'

export function RoomDetail({ roomId, base = '' }: { roomId: string; base?: string }) {
  const [tab, setTab] = useState<Tab>('artifact')
  const { state, transcript, chain, error } = useRoomState(roomId, base)

  if (error && !state) {
    return <div className="p-8 text-red-600">Cannot reach server: {error.message}</div>
  }
  if (!state) {
    return <div className="p-8 text-gray-500">Loading room…</div>
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-xs text-gray-400">{roomId}</div>
            <div className="text-sm text-gray-600">
              {state.my_role_label} · round {state.current_round} · turn {state.current_turn_index}
            </div>
          </div>
          <StateBadge state={state.state} hardLimit={state.hard_limit_hit} />
        </div>
        <nav className="mt-3 flex gap-1">
          {(['artifact', 'transcript', 'chain'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 text-sm capitalize ${
                tab === t ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>
      <div className="flex-1 overflow-auto">
        {tab === 'artifact' && <ArtifactView artifact={state.artifact} />}
        {tab === 'transcript' && (
          <Transcript entries={transcript} participants={state.participants} />
        )}
        {tab === 'chain' && <ChainView events={chain} />}
      </div>
    </div>
  )
}
