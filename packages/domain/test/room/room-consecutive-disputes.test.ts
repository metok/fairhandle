import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig, type RoomId } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'

const ROOM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as RoomId

function divergentOutput(version: number, status: 'agreed' | 'open') {
  return {
    artifact: {
      markdown: 'doc v' + version,
      version,
      overlay: [{
        span: { start: 0, end: 5 },
        clause_type: 'header',
        status,
        criticality_default: 'low' as const,
        last_changed_at_version: version,
      }],
      open_issues: [],
      changelog: 'r' + version,
    },
    open_issues: [],
    changelog: 'r' + version,
  }
}

describe('Room — consecutive disputes counter', () => {
  it('starts at 0', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const room = await Room.create({ room_id: ROOM, config: defaultRoomConfig(), signature: sig, clock })
    expect(room.consecutive_disputes).toBe(0)
  })

  it('increments on each ConsolidationDisputed and resets on ConsolidationMerged', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [
        divergentOutput(1, 'agreed'),
        divergentOutput(1, 'open'),    // first dispute (status differs)
        divergentOutput(2, 'agreed'),
        divergentOutput(2, 'open'),    // second dispute
        divergentOutput(3, 'agreed'),
        divergentOutput(3, 'agreed'),  // merge (resets counter)
      ],
      verifierAlways: { equivalent: true },
    })
    const room = await Room.create({ room_id: ROOM, config: defaultRoomConfig(), signature: sig, clock })
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 's' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 's' as never })

    async function oneRound(expectedAfterMerge: number) {
      const aId = room.participants[0]!.agent_id
      const bId = room.participants[1]!.agent_id
      await room.handleSend({ agent_id: aId, content_ciphertext: 'a', signature: 's' as never })
      await room.handleSend({ agent_id: bId, content_ciphertext: 'b', signature: 's' as never })
      await room.runOwnConsolidation({ llm, our_node_id: 'A', signature: 's' as never })
      // Stuff peer's proposal manually since this is single-room test.
      const peerProp = await llm.runConsolidator({} as never)
      ;(room as unknown as { peer_proposal: unknown }).peer_proposal = peerProp
      await room.attemptMerge({ llm, low_node_id: 'A', signature: 's' as never })
      expect(room.consecutive_disputes).toBe(expectedAfterMerge)
    }

    await oneRound(1)  // first round: dispute → counter = 1
    await oneRound(2)  // second round: dispute → counter = 2
    await oneRound(0)  // third round: merge → counter resets
  })
})
