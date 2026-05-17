import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'
import type { Pubkey } from '../../src/index.js'

const ROOM = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const MEDIATOR_PUBKEY = 'mediator-pubkey-hex-task5' as Pubkey

function stubConsolidatorOutput() {
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

  return { room, sig }
}

async function driveToConsolidatingWithProposal(room: Room) {
  const aId = room.participants.find((p) => p.role_label === 'A')!.agent_id
  const bId = room.participants.find((p) => p.role_label === 'B')!.agent_id
  await room.handleSend({ agent_id: aId, content_ciphertext: 'hello', signature: 's' as never })
  await room.handleSend({ agent_id: bId, content_ciphertext: 'world', signature: 's' as never })
  // state is now 'consolidating'

  const llm = new ScriptedLLMAdapter({
    consolidatorOutputs: [stubConsolidatorOutput()],
    verifierAlways: { equivalent: true },
  })
  await room.runMediatorConsolidation({ llm, signature: 'sig-mediator' as never })
  // pending_consolidation is now set
}

describe('Room — reviewConsolidation (Task 5)', () => {
  it('appends consolidation_accept when audit is faithful', async () => {
    const { room } = await makeMediatorRoom()
    await driveToConsolidatingWithProposal(room)

    const aId = room.participants.find((p) => p.role_label === 'A')!.agent_id
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
      auditConsolidation: { faithful: true, issues: [] },
    })

    const logLenBefore = room.log.length
    const event = await room.reviewConsolidation({
      agent_id: aId,
      llm,
      signature: 'sig-peer-a' as never,
    })

    expect(room.log.length).toBe(logLenBefore + 1)
    expect(event.payload.type).toBe('consolidation_accept')
    expect(event.payload.agent_id).toBe(aId)

    const payload = event.payload.payload as { type: 'consolidation_accept'; round_index: number; proposal_hash: string }
    expect(payload.type).toBe('consolidation_accept')
    expect(payload.round_index).toBe(0)
    expect(typeof payload.proposal_hash).toBe('string')
    expect(payload.proposal_hash.length).toBeGreaterThan(0)
  })

  it('records accepting agent in round_accepts when audit is faithful', async () => {
    const { room } = await makeMediatorRoom()
    await driveToConsolidatingWithProposal(room)

    const aId = room.participants.find((p) => p.role_label === 'A')!.agent_id
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
      auditConsolidation: { faithful: true, issues: [] },
    })

    await room.reviewConsolidation({
      agent_id: aId,
      llm,
      signature: 'sig-peer-a' as never,
    })

    expect(room.roundAccepts).toContain(aId)
    expect(room.roundAccepts).toHaveLength(1)
  })

  it('appends consolidation_dispute when audit is not faithful', async () => {
    const { room } = await makeMediatorRoom()
    await driveToConsolidatingWithProposal(room)

    const bId = room.participants.find((p) => p.role_label === 'B')!.agent_id
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
      auditConsolidation: { faithful: false, issues: ['mediator omitted the price'] },
    })

    const logLenBefore = room.log.length
    const event = await room.reviewConsolidation({
      agent_id: bId,
      llm,
      signature: 'sig-peer-b' as never,
    })

    expect(room.log.length).toBe(logLenBefore + 1)
    expect(event.payload.type).toBe('consolidation_dispute')

    const payload = event.payload.payload as {
      type: 'consolidation_dispute'
      round_index: number
      disagreement_summary_ciphertext: string
    }
    expect(payload.type).toBe('consolidation_dispute')
    expect(payload.round_index).toBe(0)

    const parsed = JSON.parse(payload.disagreement_summary_ciphertext) as { issues: string[] }
    expect(parsed.issues).toEqual(['mediator omitted the price'])
  })

  it('throws when called by the mediator agent_id', async () => {
    const { room } = await makeMediatorRoom()
    await driveToConsolidatingWithProposal(room)

    const mediatorId = room.participants.find((p) => p.role === 'mediator')!.agent_id
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
      auditConsolidation: { faithful: true, issues: [] },
    })

    await expect(
      room.reviewConsolidation({ agent_id: mediatorId, llm, signature: 's' as never }),
    ).rejects.toThrow(/peer/i)
  })

  it('throws when pending_consolidation is null', async () => {
    const { room } = await makeMediatorRoom()
    const aId = room.participants.find((p) => p.role_label === 'A')!.agent_id
    await room.handleSend({ agent_id: aId, content_ciphertext: 'hello', signature: 's' as never })
    const bId = room.participants.find((p) => p.role_label === 'B')!.agent_id
    await room.handleSend({ agent_id: bId, content_ciphertext: 'world', signature: 's' as never })
    // consolidating but no mediator proposal yet

    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
    })

    await expect(
      room.reviewConsolidation({ agent_id: aId, llm, signature: 's' as never }),
    ).rejects.toThrow(/pending_consolidation|no.*proposal|nothing to review/i)
  })

  it('throws when state is not consolidating', async () => {
    const { room } = await makeMediatorRoom()
    // state is 'active' — no messages sent yet
    const aId = room.participants.find((p) => p.role_label === 'A')!.agent_id
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
    })

    await expect(
      room.reviewConsolidation({ agent_id: aId, llm, signature: 's' as never }),
    ).rejects.toThrow(/consolidat/i)
  })

  it('advanceStateFromEnvelope records consolidation_accept into round_accepts on the remote room', async () => {
    const { room } = await makeMediatorRoom()
    await driveToConsolidatingWithProposal(room)

    const aId = room.participants.find((p) => p.role_label === 'A')!.agent_id
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
      auditConsolidation: { faithful: true, issues: [] },
    })

    const event = await room.reviewConsolidation({
      agent_id: aId,
      llm,
      signature: 'sig-peer-a' as never,
    })

    // Build a second room and replay all events up to (not including) the accept,
    // then apply the accept via handleRemoteEnvelope.
    const sig2 = new StubSignatureAdapter()
    const clock2 = new FixedClock(new Date('2026-05-17T00:00:00Z'))
    const room2 = await Room.create({
      room_id: ROOM as never,
      config: { ...defaultRoomConfig(), mediator_pubkey: MEDIATOR_PUBKEY },
      signature: sig2,
      clock: clock2,
    })

    for (const ev of room.log.getEvents().slice(0, -1)) {
      await room2.applyRemote(ev)
    }
    expect(room2.roundAccepts).toHaveLength(0)

    await room2.handleRemoteEnvelope(event.payload)
    expect(room2.roundAccepts).toContain(aId)
    expect(room2.roundAccepts).toHaveLength(1)
  })
})
