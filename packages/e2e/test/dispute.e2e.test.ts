import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig, type RoomId } from '@fairhandle/domain'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { createPairedChannels } from '@fairhandle/channel-memory'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'
import { FixedClock } from '@fairhandle/clock-system'

const ROOM = '22222222-3333-4444-8555-666666666666' as RoomId

function divergent(v: number, s: 'agreed' | 'open') {
  return {
    artifact: { markdown: 'd' + v, version: v, overlay: [{ span: { start: 0, end: 2 }, clause_type: 'x', status: s, criticality_default: 'low' as const, last_changed_at_version: v }], open_issues: [], changelog: 'r' + v },
    open_issues: [],
    changelog: 'r' + v,
  }
}

function agreed(v: number) {
  return {
    artifact: { markdown: 'a' + v, version: v, overlay: [{ span: { start: 0, end: 2 }, clause_type: 'x', status: 'agreed' as const, criticality_default: 'low' as const, last_changed_at_version: v }], open_issues: [], changelog: 'r' + v },
    open_issues: [],
    changelog: 'r' + v,
  }
}

describe('E2E dispute', () => {
  it('logs ConsolidationDisputed on both peers and continues with next round', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const dispute = { equivalent: false, divergences: ['scripted dispute'] }
    const llmA = new ScriptedLLMAdapter({ consolidatorOutputs: [divergent(1, 'agreed'), agreed(2)], verifierAlways: { equivalent: true }, artifactEquivalence: dispute })
    const llmB = new ScriptedLLMAdapter({ consolidatorOutputs: [divergent(1, 'open'), agreed(2)], verifierAlways: { equivalent: true }, artifactEquivalence: dispute })

    const roomA = await Room.create({ room_id: ROOM, config: defaultRoomConfig(), signature: sig, clock })
    const roomB = await Room.create({ room_id: ROOM, config: defaultRoomConfig(), signature: sig, clock })
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

    // Round 1 — will dispute
    for (const ev of await roomA.handleSend({ agent_id: aId, content_ciphertext: 'a1', signature: 's' as never })) await chA.send(ev.payload)
    await new Promise((r) => setTimeout(r, 0))
    for (const ev of await roomB.handleSend({ agent_id: bId, content_ciphertext: 'b1', signature: 's' as never })) await chB.send(ev.payload)
    await new Promise((r) => setTimeout(r, 0))

    const propA = await roomA.runOwnConsolidation({ llm: llmA, our_node_id: 'A', signature: 's' as never })
    await chA.send(propA.payload)
    const propB = await roomB.runOwnConsolidation({ llm: llmB, our_node_id: 'B', signature: 's' as never })
    await chB.send(propB.payload)
    await new Promise((r) => setTimeout(r, 0))

    const disputeEv = await roomA.attemptMerge({ llm: llmA, low_node_id: 'A', signature: 's' as never })
    await chA.send(disputeEv.payload)
    await new Promise((r) => setTimeout(r, 0))

    expect(disputeEv.payload.type).toBe('consolidation_dispute')
    expect(roomA.state).toBe('active')
    expect(roomB.state).toBe('active')
    expect(roomA.consecutive_disputes).toBe(1)
    expect(roomB.consecutive_disputes).toBe(1)
  })
})
