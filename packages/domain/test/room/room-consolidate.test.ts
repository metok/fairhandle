import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'

const ROOM = '77777777-7777-4777-8777-777777777777'

function sameOutput() {
  return {
    artifact: {
      markdown: 'doc',
      version: 1,
      overlay: [],
      open_issues: [],
      changelog: 'c',
    },
    open_issues: [],
    changelog: 'c',
  }
}

describe('Room — consolidation', () => {
  it('returns to active after both peers agree on the round consolidation', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const llmA = new ScriptedLLMAdapter({ consolidatorOutputs: [sameOutput()], verifierAlways: { equivalent: true } })
    const llmB = new ScriptedLLMAdapter({ consolidatorOutputs: [sameOutput()], verifierAlways: { equivalent: true } })
    const roomA = await Room.create({ room_id: ROOM as never, config: defaultRoomConfig(), signature: sig, clock })
    const roomB = await Room.create({ room_id: ROOM as never, config: defaultRoomConfig(), signature: sig, clock })

    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    const [ea] = await roomA.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 's' as never }); await roomB.applyRemote(ea!)
    const [eb] = await roomB.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 's' as never }); await roomA.applyRemote(eb!)

    const aId = roomA.participants[0]!.agent_id
    const bId = roomA.participants[1]!.agent_id
    const [m1] = await roomA.handleSend({ agent_id: aId, content_ciphertext: 'a1', signature: 's' as never }); await roomB.applyRemote(m1!)
    const [m2] = await roomB.handleSend({ agent_id: bId, content_ciphertext: 'b1', signature: 's' as never }); await roomA.applyRemote(m2!)

    expect(roomA.state).toBe('consolidating')
    expect(roomB.state).toBe('consolidating')

    const propA = await roomA.runOwnConsolidation({ llm: llmA, our_node_id: 'A', signature: 's' as never })
    await roomB.applyRemote(propA)
    const propB = await roomB.runOwnConsolidation({ llm: llmB, our_node_id: 'B', signature: 's' as never })
    await roomA.applyRemote(propB)

    const mergeA = await roomA.attemptMerge({ llm: llmA, low_node_id: 'A', signature: 's' as never })
    await roomB.applyRemote(mergeA)

    expect(roomA.state).toBe('active')
    expect(roomB.state).toBe('active')
    expect(roomA.current_round).toBe(1)
    expect(roomB.current_round).toBe(1)
  })
})
