import { describe, it, expect } from 'vitest'
import { Room, type RoomId } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'

const ROOM = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' as RoomId

describe('Hard limit — turn_cap', () => {
  it('transitions to closing when turn_cap is reached', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [
        { artifact: { markdown: '', version: 1, overlay: [], open_issues: [], changelog: '' }, open_issues: [], changelog: '' },
        { artifact: { markdown: '', version: 1, overlay: [], open_issues: [], changelog: '' }, open_issues: [], changelog: '' },
      ],
      verifierAlways: { equivalent: true },
    })
    const room = await Room.create({
      room_id: ROOM,
      config: { turn_cap: 2, time_cap_ms: 60_000, deadlock_policy: 'best_effort', opening_artifact: null, expected_peer_pubkey: null },
      signature: sig,
      clock,
    })
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 's' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 's' as never })

    const aId = room.participants[0]!.agent_id
    const bId = room.participants[1]!.agent_id
    await room.handleSend({ agent_id: aId, content_ciphertext: 'a', signature: 's' as never })
    await room.handleSend({ agent_id: bId, content_ciphertext: 'b', signature: 's' as never })

    // After turn_cap=2 messages: consolidate, then state should be closing.
    await room.runOwnConsolidation({ llm, our_node_id: 'A', signature: 's' as never })
    const peerProp = await llm.runConsolidator({} as never)
    ;(room as unknown as { peer_proposal: unknown }).peer_proposal = peerProp
    await room.attemptMerge({ llm, low_node_id: 'A', signature: 's' as never })

    expect(room.state).toBe('closing')
    expect(room.hard_limit_hit).toBe('turn_cap')
  })
})
