import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'

const ROOM = '66666666-6666-4666-8666-666666666666'

describe('Room.applyRemote', () => {
  it('mirrors join events from the peer', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const roomA = await Room.create({ room_id: ROOM as never, config: defaultRoomConfig(), signature: sig, clock })
    const roomB = await Room.create({ room_id: ROOM as never, config: defaultRoomConfig(), signature: sig, clock })
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    const [evA] = await roomA.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 's' as never })
    await roomB.applyRemote(evA!)
    const [evB] = await roomB.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 's' as never })
    await roomA.applyRemote(evB!)
    expect(roomA.state).toBe('active')
    expect(roomB.state).toBe('active')
    expect(roomA.log.length).toBe(2)
    expect(roomB.log.length).toBe(2)
    expect(roomA.log.getHeadHash()).toBe(roomB.log.getHeadHash())
  })
  it('mirrors send_message events and advances turn counter', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const roomA = await Room.create({ room_id: ROOM as never, config: defaultRoomConfig(), signature: sig, clock })
    const roomB = await Room.create({ room_id: ROOM as never, config: defaultRoomConfig(), signature: sig, clock })
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    const [ea] = await roomA.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 's' as never })
    await roomB.applyRemote(ea!)
    const [eb] = await roomB.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 's' as never })
    await roomA.applyRemote(eb!)

    const aId = roomA.participants[0]!.agent_id
    const [m1] = await roomA.handleSend({ agent_id: aId, content_ciphertext: 'a1', signature: 's' as never })
    await roomB.applyRemote(m1!)
    expect(roomB.current_turn_index).toBe(1)
  })
})
