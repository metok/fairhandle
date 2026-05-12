import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig, type RoomId } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'

const ROOM = '11111111-2222-4333-8444-555555555555' as RoomId

describe('Room.handleLeave', () => {
  it('transitions to closing with walk_away marker', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const room = await Room.create({ room_id: ROOM, config: defaultRoomConfig(), signature: sig, clock })
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 's' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 's' as never })

    const aId = room.participants[0]!.agent_id
    const [ev] = await room.handleLeave({ agent_id: aId, reason: 'walking away', signature: 's' as never })
    expect(ev!.payload.type).toBe('leave_room')
    expect(room.state).toBe('closing')
    expect(room.walk_away_by).toBe(aId)
  })
  it('rejects leave from state created', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const room = await Room.create({ room_id: ROOM, config: defaultRoomConfig(), signature: sig, clock })
    await expect(
      room.handleLeave({ agent_id: 'fake' as never, reason: 'x', signature: 's' as never }),
    ).rejects.toThrow(/cannot leave/)
  })
})
