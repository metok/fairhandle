import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig, type RoomId } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'

const ROOM = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' as RoomId

describe('Deadlock — best_effort policy', () => {
  it('transitions to closing with hard_limit_hit after 3 consecutive disputes', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    function divergent(v: number, s: 'agreed' | 'open') {
      return {
        artifact: {
          markdown: 'doc' + v,
          version: v,
          overlay: [{ span: { start: 0, end: 4 }, clause_type: 'x', status: s, criticality_default: 'low' as const, last_changed_at_version: v }],
          open_issues: [],
          changelog: 'r' + v,
        },
        open_issues: [],
        changelog: 'r' + v,
      }
    }
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [
        divergent(1, 'agreed'), divergent(1, 'open'),
        divergent(2, 'agreed'), divergent(2, 'open'),
        divergent(3, 'agreed'), divergent(3, 'open'),
      ],
      verifierAlways: { equivalent: true },
      artifactEquivalence: { equivalent: false, divergences: ['scripted dispute'] },
    })
    const room = await Room.create({
      room_id: ROOM,
      config: { ...defaultRoomConfig(), deadlock_policy: 'best_effort' },
      signature: sig,
      clock,
    })
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 's' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 's' as never })

    for (let r = 0; r < 3; r++) {
      const aId = room.participants[0]!.agent_id
      const bId = room.participants[1]!.agent_id
      await room.handleSend({ agent_id: aId, content_ciphertext: 'a', signature: 's' as never })
      await room.handleSend({ agent_id: bId, content_ciphertext: 'b', signature: 's' as never })
      await room.runOwnConsolidation({ llm, our_node_id: 'A', signature: 's' as never })
      const peerProp = await llm.runConsolidator({} as never)
      ;(room as unknown as { peer_proposal: unknown }).peer_proposal = peerProp
      await room.attemptMerge({ llm, low_node_id: 'A', signature: 's' as never })
    }

    expect(room.consecutive_disputes).toBe(3)
    expect(room.state).toBe('closing')
    expect(room.hard_limit_hit).toBe('deadlock')
  })
})
