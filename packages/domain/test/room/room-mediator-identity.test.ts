import { describe, it, expect } from 'vitest'
import { Room, type AgentParticipant, type ParticipantRole } from '../../src/index.js'
import { defaultRoomConfig } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'
import type { Pubkey } from '../../src/index.js'

const ROOM = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MEDIATOR_PUBKEY = 'mediator-pubkey-hex' as Pubkey

async function activeRoomWithMediatorConfig() {
  const sig = new StubSignatureAdapter()
  const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
  const room = await Room.create({
    room_id: ROOM as never,
    config: { ...defaultRoomConfig(), mediator_pubkey: MEDIATOR_PUBKEY },
    signature: sig,
    clock,
  })
  const a = await sig.generateEphemeralKeyPair()
  const b = await sig.generateEphemeralKeyPair()
  await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })
  await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 'sb' as never })
  return {
    room,
    aId: room.participants[0]!.agent_id,
    bId: room.participants[1]!.agent_id,
  }
}

describe('Room — mediator identity (Task 1)', () => {
  it('reports mediator_pubkey from room config when set', async () => {
    const { room } = await activeRoomWithMediatorConfig()
    expect(room.config.mediator_pubkey).toBe(MEDIATOR_PUBKEY)
  })

  it('defaultRoomConfig has mediator_pubkey null', async () => {
    const cfg = defaultRoomConfig()
    expect(cfg.mediator_pubkey).toBeNull()
  })

  it('peers have role peer after joining via handleJoin', async () => {
    const { room } = await activeRoomWithMediatorConfig()
    expect(room.participants[0]!.role).toBe('peer')
    expect(room.participants[1]!.role).toBe('peer')
  })

  it('handleSend turn alternation is unaffected when a mediator participant is injected at index 0', async () => {
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
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 'sb' as never })

    const peerA = room.participants[0]!
    const peerB = room.participants[1]!

    // Inject a mediator participant at the front of the array (adversarial position)
    // to ensure naive participants[0] would return the mediator instead of the first peer.
    const mediatorParticipant: AgentParticipant = {
      agent_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as never,
      role_label: 'Mediator',
      pubkey: MEDIATOR_PUBKEY,
      joined_at_event: 0,
      role: 'mediator' as ParticipantRole,
    }
    ;(room as unknown as { participants: AgentParticipant[] }).participants.unshift(mediatorParticipant)

    // participants array is now: [mediator, peerA, peerB]
    // turn 0 must still go to peerA (first peer), not the mediator
    await expect(
      room.handleSend({ agent_id: peerA.agent_id, content_ciphertext: 'turn-0', signature: 's' as never }),
    ).resolves.toBeDefined()

    // turn 1 must go to peerB (second peer)
    await expect(
      room.handleSend({ agent_id: peerB.agent_id, content_ciphertext: 'turn-1', signature: 's' as never }),
    ).resolves.toBeDefined()

    expect(room.current_turn_index).toBe(2)
  })
})
