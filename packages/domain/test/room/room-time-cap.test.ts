import { describe, it, expect } from 'vitest'
import { Room, type RoomId } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'

const ROOM = 'ffffffff-ffff-4fff-8fff-ffffffffffff' as RoomId

describe('Hard limit — time_cap', () => {
  it('transitions to closing when time_cap_ms elapses before next send', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const room = await Room.create({
      room_id: ROOM,
      config: { turn_cap: 50, time_cap_ms: 5000, deadlock_policy: 'best_effort', opening_artifact: null, expected_peer_pubkey: null },
      signature: sig,
      clock,
    })
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 's' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 's' as never })

    expect(room.state).toBe('active')
    clock.tick(6000)

    const aId = room.participants[0]!.agent_id
    await expect(
      room.handleSend({ agent_id: aId, content_ciphertext: 'late', signature: 's' as never }),
    ).rejects.toThrow(/time_cap/)
    expect(room.state).toBe('closing')
    expect(room.hard_limit_hit).toBe('time_cap')
  })
})
