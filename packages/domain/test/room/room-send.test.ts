import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'

const ROOM = '55555555-5555-4555-8555-555555555555'

async function activeRoom() {
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
  const [evA] = await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })
  const [evB] = await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 'sb' as never })
  return { room, a: { kp: a, agent_id: room.participants[0]!.agent_id }, b: { kp: b, agent_id: room.participants[1]!.agent_id }, evA: evA!, evB: evB! }
}

describe('Room — send_message', () => {
  it('lets the first joiner send the first turn', async () => {
    const { room, a } = await activeRoom()
    const events = await room.handleSend({ agent_id: a.agent_id, content_ciphertext: 'hi', signature: 'x' as never })
    expect(events.length).toBe(1)
    expect(events[0]!.payload.type).toBe('send_message')
    expect(room.current_turn_index).toBe(1)
  })
  it('rejects out-of-turn send', async () => {
    const { room, b } = await activeRoom()
    await expect(
      room.handleSend({ agent_id: b.agent_id, content_ciphertext: 'x', signature: 's' as never }),
    ).rejects.toThrow(/not your turn/)
  })
  it('alternates correctly', async () => {
    const { room, a, b } = await activeRoom()
    await room.handleSend({ agent_id: a.agent_id, content_ciphertext: 'a1', signature: 's' as never })
    await room.handleSend({ agent_id: b.agent_id, content_ciphertext: 'b1', signature: 's' as never })
    expect(room.current_turn_index).toBe(2)
  })
})
