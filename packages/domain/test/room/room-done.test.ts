import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'

const ROOM = '88888888-8888-4888-8888-888888888888'

describe('Room — propose/accept done', () => {
  it('records propose_done and accept_done events and transitions to closing', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const room = await Room.create({ room_id: ROOM as never, config: defaultRoomConfig(), signature: sig, clock })
    const a = await sig.generateEphemeralKeyPair(); const b = await sig.generateEphemeralKeyPair()
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 's' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 's' as never })

    const aId = room.participants[0]!.agent_id
    const bId = room.participants[1]!.agent_id

    const [propose] = await room.handleProposeDone({ agent_id: aId, reason: 'we are aligned', signature: 's' as never })
    expect(propose!.payload.type).toBe('propose_done')

    const [accept] = await room.handleAcceptDone({ agent_id: bId, signature: 's' as never })
    expect(accept!.payload.type).toBe('accept_done')
    expect(room.state).toBe('closing')
  })
  it('rejects accept_done if no propose_done was made', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const room = await Room.create({ room_id: ROOM as never, config: defaultRoomConfig(), signature: sig, clock })
    const a = await sig.generateEphemeralKeyPair(); const b = await sig.generateEphemeralKeyPair()
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 's' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 's' as never })
    await expect(
      room.handleAcceptDone({ agent_id: room.participants[1]!.agent_id, signature: 's' as never }),
    ).rejects.toThrow(/no.*propose/i)
  })
})
