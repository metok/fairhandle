import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'
import type { Pubkey } from '../../src/index.js'

const ROOM = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const MEDIATOR_PUBKEY = 'mediator-pubkey-hex-task4' as Pubkey

function stubOutput() {
  return {
    artifact: {
      markdown: 'mediator doc',
      version: 1,
      overlay: [],
      open_issues: [],
      changelog: 'mediator changelog',
    },
    open_issues: [],
    changelog: 'mediator changelog',
  }
}

async function makeMediatorRoom() {
  const sig = new StubSignatureAdapter()
  const clock = new FixedClock(new Date('2026-05-17T00:00:00Z'))
  const llm = new ScriptedLLMAdapter({ consolidatorOutputs: [stubOutput()], verifierAlways: { equivalent: true } })
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
  await room.handleMediatorJoin({ pubkey: MEDIATOR_PUBKEY, signature: 'sm' as never })

  return { room, sig, llm }
}

async function driveToConsolidating(room: Room) {
  const aId = room.participants.find((p) => p.role_label === 'A')!.agent_id
  const bId = room.participants.find((p) => p.role_label === 'B')!.agent_id
  await room.handleSend({ agent_id: aId, content_ciphertext: 'hello', signature: 's' as never })
  await room.handleSend({ agent_id: bId, content_ciphertext: 'world', signature: 's' as never })
}

describe('Room — runMediatorConsolidation (Task 4)', () => {
  it('appends exactly one consolidation_proposal signed by the mediator and sets pending_consolidation', async () => {
    const { room, llm } = await makeMediatorRoom()
    await driveToConsolidating(room)
    expect(room.state).toBe('consolidating')

    const logLenBefore = room.log.length

    const event = await room.runMediatorConsolidation({ llm, signature: 'sig-mediator' as never })

    expect(room.log.length).toBe(logLenBefore + 1)
    expect(event.payload.type).toBe('consolidation_proposal')

    const mediator = room.participants.find((p) => p.role === 'mediator')!
    expect(event.payload.agent_id).toBe(mediator.agent_id)

    expect(room.pending_consolidation).not.toBeNull()
    expect(room.pending_consolidation!.artifact.markdown).toBe('mediator doc')
  })

  it('throws when there is no mediator participant (plain two-peer room)', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-17T00:00:00Z'))
    const llm = new ScriptedLLMAdapter({ consolidatorOutputs: [stubOutput()], verifierAlways: { equivalent: true } })
    const room = await Room.create({
      room_id: ROOM as never,
      config: { ...defaultRoomConfig(), mediator_pubkey: null },
      signature: sig,
      clock,
    })
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 'sb' as never })
    await driveToConsolidating(room)
    expect(room.state).toBe('consolidating')

    await expect(
      room.runMediatorConsolidation({ llm, signature: 's' as never }),
    ).rejects.toThrow(/no mediator/i)
  })

  it('throws when state is not consolidating', async () => {
    const { room, llm } = await makeMediatorRoom()
    expect(room.state).toBe('active')

    await expect(
      room.runMediatorConsolidation({ llm, signature: 's' as never }),
    ).rejects.toThrow(/consolidat/i)
  })

  it('advanceStateFromEnvelope sets pending_consolidation when the mediator authored the proposal', async () => {
    const { room, llm } = await makeMediatorRoom()
    await driveToConsolidating(room)

    const event = await room.runMediatorConsolidation({ llm, signature: 'sig-mediator' as never })

    // Simulate a second room receiving the envelope on the wire.
    const sig2 = new StubSignatureAdapter()
    const clock2 = new FixedClock(new Date('2026-05-17T00:00:00Z'))
    const room2 = await Room.create({
      room_id: ROOM as never,
      config: { ...defaultRoomConfig(), mediator_pubkey: MEDIATOR_PUBKEY },
      signature: sig2,
      clock: clock2,
    })

    // Replay all events except the consolidation_proposal, then apply it via handleRemoteEnvelope.
    for (const ev of room.log.getEvents().slice(0, -1)) {
      await room2.applyRemote(ev)
    }

    expect(room2.pending_consolidation).toBeNull()
    await room2.handleRemoteEnvelope(event.payload)
    expect(room2.pending_consolidation).not.toBeNull()
    expect(room2.pending_consolidation!.artifact.markdown).toBe('mediator doc')
  })
})
