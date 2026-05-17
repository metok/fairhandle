import { describe, it, expect } from 'vitest'
import { Room } from '../../src/room/room.js'
import { defaultRoomConfig } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'
import type { Pubkey } from '../../src/index.js'

const ROOM = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const MEDIATOR_PUBKEY = 'mediator-pubkey-hex-task2' as Pubkey
const WRONG_PUBKEY = 'wrong-pubkey-hex' as Pubkey

async function makeRoom(mediator_pubkey: Pubkey | null) {
  const sig = new StubSignatureAdapter()
  const clock = new FixedClock(new Date('2026-05-17T00:00:00Z'))
  const room = await Room.create({
    room_id: ROOM as never,
    config: { ...defaultRoomConfig(), mediator_pubkey },
    signature: sig,
    clock,
  })
  const a = await sig.generateEphemeralKeyPair()
  const b = await sig.generateEphemeralKeyPair()
  return { room, sig, a, b }
}

describe('Room — mediator_join (Task 2)', () => {
  it('regression: room with mediator_pubkey null reaches active after two peers join', async () => {
    const { room, a, b } = await makeRoom(null)
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 'sb' as never })
    expect(room.state).toBe('active')
  })

  it('room with mediator_pubkey stays waiting after both peers join', async () => {
    const { room, a, b } = await makeRoom(MEDIATOR_PUBKEY)
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 'sb' as never })
    expect(room.state).toBe('waiting')
  })

  it('room reaches active after both peers + mediator join (mediator last)', async () => {
    const { room, a, b } = await makeRoom(MEDIATOR_PUBKEY)
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 'sb' as never })
    expect(room.state).toBe('waiting')
    const events = await room.handleMediatorJoin({ pubkey: MEDIATOR_PUBKEY, signature: 'sm' as never })
    expect(events.length).toBe(1)
    expect(events[0]!.payload.type).toBe('mediator_join')
    expect(room.state).toBe('active')
  })

  it('room reaches active after mediator joins first, then both peers join', async () => {
    const { room, a, b } = await makeRoom(MEDIATOR_PUBKEY)
    await room.handleMediatorJoin({ pubkey: MEDIATOR_PUBKEY, signature: 'sm' as never })
    expect(room.state).toBe('waiting')
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })
    expect(room.state).toBe('waiting')
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 'sb' as never })
    expect(room.state).toBe('active')
  })

  it('mediator participant has role mediator and role_label Mediator after joining', async () => {
    const { room, a, b } = await makeRoom(MEDIATOR_PUBKEY)
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 'sb' as never })
    await room.handleMediatorJoin({ pubkey: MEDIATOR_PUBKEY, signature: 'sm' as never })
    const mediator = room.participants.find((p) => p.role === 'mediator')
    expect(mediator).toBeDefined()
    expect(mediator!.role_label).toBe('Mediator')
    expect(mediator!.pubkey).toBe(MEDIATOR_PUBKEY)
  })

  it('handleMediatorJoin with wrong pubkey throws pubkey mismatch', async () => {
    const { room, a, b } = await makeRoom(MEDIATOR_PUBKEY)
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 'sb' as never })
    await expect(
      room.handleMediatorJoin({ pubkey: WRONG_PUBKEY, signature: 'sm' as never }),
    ).rejects.toThrow(/pubkey mismatch/i)
  })

  it('handleMediatorJoin on room with mediator_pubkey null throws', async () => {
    // Only one peer joins so the room stays waiting — the null-mediator guard fires.
    const { room, a } = await makeRoom(null)
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })
    expect(room.state).toBe('waiting')
    await expect(
      room.handleMediatorJoin({ pubkey: MEDIATOR_PUBKEY, signature: 'sm' as never }),
    ).rejects.toThrow(/no mediator expected for this room/i)
  })

  it('second handleMediatorJoin throws mediator already joined', async () => {
    // Only one peer joins so the room stays waiting — ensures the duplicate-mediator
    // guard fires rather than the state guard.
    const { room, a } = await makeRoom(MEDIATOR_PUBKEY)
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })
    await room.handleMediatorJoin({ pubkey: MEDIATOR_PUBKEY, signature: 'sm' as never })
    expect(room.state).toBe('waiting')
    await expect(
      room.handleMediatorJoin({ pubkey: MEDIATOR_PUBKEY, signature: 'sm2' as never }),
    ).rejects.toThrow(/mediator already joined/i)
  })

  it('handleMediatorJoin in non-waiting state throws', async () => {
    const { room, a, b } = await makeRoom(MEDIATOR_PUBKEY)
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 'sb' as never })
    await room.handleMediatorJoin({ pubkey: MEDIATOR_PUBKEY, signature: 'sm' as never })
    // now active — calling again should throw on state check
    await expect(
      room.handleMediatorJoin({ pubkey: MEDIATOR_PUBKEY, signature: 'sm2' as never }),
    ).rejects.toThrow(/state/)
  })
})
