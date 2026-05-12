import { describe, it, expect } from 'vitest'
import { Room } from '../../src/room/room.js'
import { defaultRoomConfig } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'

const ROOM = '44444444-4444-4444-8444-444444444444'

describe('Room — create + join', () => {
  it('starts in waiting after create_room', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const room = await Room.create({
      room_id: ROOM as never,
      config: defaultRoomConfig(),
      signature: sig,
      clock,
    })
    expect(room.state).toBe('waiting')
    expect(room.participants.length).toBe(0)
  })
  it('accepts the first agent join and stays waiting', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const room = await Room.create({
      room_id: ROOM as never,
      config: defaultRoomConfig(),
      signature: sig,
      clock,
    })
    const kp = await sig.generateEphemeralKeyPair()
    const events = await room.handleJoin({ pubkey: kp.pubkey, role_label: 'Alice', signature: 'x' as never })
    expect(events.length).toBe(1)
    expect(events[0]!.payload.type).toBe('join_room')
    expect(room.state).toBe('waiting')
    expect(room.participants.length).toBe(1)
  })
  it('transitions to active after both agents joined', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const room = await Room.create({
      room_id: ROOM as never,
      config: defaultRoomConfig(),
      signature: sig,
      clock,
    })
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'Alice', signature: 'sa' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'Bob', signature: 'sb' as never })
    expect(room.state).toBe('active')
    expect(room.participants.length).toBe(2)
  })
})
