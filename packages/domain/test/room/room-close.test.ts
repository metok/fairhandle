import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'

const ROOM = '99999999-9999-4999-8999-999999999999'

describe('Room.finalize', () => {
  it('transitions closing -> closed', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const room = await Room.create({ room_id: ROOM as never, config: defaultRoomConfig(), signature: sig, clock })
    const a = await sig.generateEphemeralKeyPair(); const b = await sig.generateEphemeralKeyPair()
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 's' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 's' as never })
    await room.handleProposeDone({ agent_id: room.participants[0]!.agent_id, reason: 'done', signature: 's' as never })
    await room.handleAcceptDone({ agent_id: room.participants[1]!.agent_id, signature: 's' as never })
    expect(room.state).toBe('closing')
    await room.finalize()
    expect(room.state).toBe('closed')
  })
  it('rejects finalize() before closing', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const room = await Room.create({ room_id: ROOM as never, config: defaultRoomConfig(), signature: sig, clock })
    await expect(room.finalize()).rejects.toThrow(/closing/)
  })
})
