import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig, type RoomId } from '@fairhandle/domain'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { createPairedChannels } from '@fairhandle/channel-memory'
import { FixedClock } from '@fairhandle/clock-system'

const ROOM = '33333333-4444-4555-8666-777777777777' as RoomId

describe('E2E walk-away', () => {
  it('mirrors leave_room across peers and both transition to closing', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
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

    expect(roomA.state).toBe('active')
    expect(roomB.state).toBe('active')

    const aId = roomA.participants[0]!.agent_id
    const leave = await roomA.handleLeave({ agent_id: aId, reason: 'too far apart', signature: 's' as never })
    for (const ev of leave) await chA.send(ev.payload)
    await new Promise((r) => setTimeout(r, 0))

    expect(roomA.state).toBe('closing')
    expect(roomB.state).toBe('closing')
    expect(roomA.walk_away_by).toBe(aId)
    expect(roomB.walk_away_by).toBe(aId)
  })
})
