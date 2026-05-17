import type { TranscriptEntry } from '../lib/api.js'

export function Transcript({
  entries,
  participants,
}: {
  entries: TranscriptEntry[]
  participants: Array<{ agent_id: string; role_label: string }>
}) {
  if (entries.length === 0) {
    return <div className="p-6 text-gray-500">No messages yet.</div>
  }
  const labelFor = (agentId: string) =>
    participants.find((p) => p.agent_id === agentId)?.role_label ?? agentId.slice(0, 8)

  const byRound = new Map<number, TranscriptEntry[]>()
  for (const e of entries) {
    const list = byRound.get(e.round_index) ?? []
    list.push(e)
    byRound.set(e.round_index, list)
  }

  return (
    <div className="space-y-6 p-6">
      {[...byRound.entries()].map(([round, msgs]) => (
        <div key={round}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Round {round + 1}
          </h3>
          <ul className="space-y-2">
            {msgs.map((m) => (
              <li key={m.turn_index} className="rounded border border-gray-200 bg-white p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-800">{labelFor(m.agent_id)}</span>
                  <span className="text-xs text-gray-400">turn {m.turn_index}</span>
                </div>
                <p className="text-sm text-gray-700">{m.content}</p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
