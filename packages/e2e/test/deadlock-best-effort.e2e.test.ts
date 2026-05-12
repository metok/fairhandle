import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig, type RoomId } from '@fairhandle/domain'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { createPairedChannels } from '@fairhandle/channel-memory'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'
import { FixedClock } from '@fairhandle/clock-system'

const ROOM = '44444444-5555-4666-8777-888888888888' as RoomId

function divA(v: number) { return { artifact: { markdown: 'a' + v, version: v, overlay: [{ span: { start: 0, end: 2 }, clause_type: 'x', status: 'agreed' as const, criticality_default: 'low' as const, last_changed_at_version: v }], open_issues: [], changelog: 'r' + v }, open_issues: [], changelog: 'r' + v } }
function divB(v: number) { return { artifact: { markdown: 'b' + v, version: v, overlay: [{ span: { start: 0, end: 2 }, clause_type: 'x', status: 'open' as const, criticality_default: 'low' as const, last_changed_at_version: v }], open_issues: [], changelog: 'r' + v }, open_issues: [], changelog: 'r' + v } }

describe('E2E deadlock (best_effort)', () => {
  it('transitions both peers to closing after 3 consecutive disputes', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const llmA = new ScriptedLLMAdapter({ consolidatorOutputs: [divA(1), divA(2), divA(3)], verifierAlways: { equivalent: true } })
    const llmB = new ScriptedLLMAdapter({ consolidatorOutputs: [divB(1), divB(2), divB(3)], verifierAlways: { equivalent: true } })
    const cfg = { ...defaultRoomConfig(), deadlock_policy: 'best_effort' as const }
    const roomA = await Room.create({ room_id: ROOM, config: cfg, signature: sig, clock })
    const roomB = await Room.create({ room_id: ROOM, config: cfg, signature: sig, clock })
    const [chA, chB] = createPairedChannels()
    chB.onReceive((env) => { void roomB.handleRemoteEnvelope(env) })
    chA.onReceive((env) => { void roomA.handleRemoteEnvelope(env) })

    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    for (const ev of await roomA.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 's' as never })) await chA.send(ev.payload)
    await new Promise((r) => setTimeout(r, 0))
    for (const ev of await roomB.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 's' as never })) await chB.send(ev.payload)
    await new Promise((r) => setTimeout(r, 0))

    const aId = roomA.participants[0]!.agent_id
    const bId = roomA.participants[1]!.agent_id

    for (let round = 0; round < 3; round++) {
      for (const ev of await roomA.handleSend({ agent_id: aId, content_ciphertext: 'a' + round, signature: 's' as never })) await chA.send(ev.payload)
      await new Promise((r) => setTimeout(r, 0))
      for (const ev of await roomB.handleSend({ agent_id: bId, content_ciphertext: 'b' + round, signature: 's' as never })) await chB.send(ev.payload)
      await new Promise((r) => setTimeout(r, 0))

      const propA = await roomA.runOwnConsolidation({ llm: llmA, our_node_id: 'A', signature: 's' as never })
      await chA.send(propA.payload)
      const propB = await roomB.runOwnConsolidation({ llm: llmB, our_node_id: 'B', signature: 's' as never })
      await chB.send(propB.payload)
      await new Promise((r) => setTimeout(r, 0))

      const merge = await roomA.attemptMerge({ llm: llmA, low_node_id: 'A', signature: 's' as never })
      await chA.send(merge.payload)
      await new Promise((r) => setTimeout(r, 0))
    }

    expect(roomA.state).toBe('closing')
    expect(roomB.state).toBe('closing')
    expect(roomA.hard_limit_hit).toBe('deadlock')
    expect(roomB.hard_limit_hit).toBe('deadlock')
  })
})
