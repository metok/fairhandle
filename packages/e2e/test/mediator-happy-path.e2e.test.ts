import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig, type RoomId, type Pubkey } from '@fairhandle/domain'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { createBroadcastChannels } from '@fairhandle/channel-memory'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'
import { FixedClock } from '@fairhandle/clock-system'

const ROOM = '11111111-2222-4333-8444-555555555555' as RoomId

function mediatorOutput(version: number) {
  return {
    artifact: {
      markdown: '# Round ' + version + '\n\nMediator consolidated terms.',
      version,
      overlay: [
        {
          span: { start: 0, end: 9 },
          clause_type: 'header',
          status: 'agreed' as const,
          criticality_default: 'low' as const,
          last_changed_at_version: version,
        },
      ],
      open_issues: [],
      changelog: 'mediator-r' + version,
    },
    open_issues: [],
    changelog: 'mediator-r' + version,
  }
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0))
}

describe('E2E mediator happy path — two peers + mediator, two rounds, signed off', () => {
  it('three rooms converge to identical log heads after two mediated rounds and a final deal', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-17T00:00:00Z'))

    const mediatorKp = await sig.generateEphemeralKeyPair()
    const mediatorPubkey = mediatorKp.pubkey as Pubkey

    const config = { ...defaultRoomConfig(), mediator_pubkey: mediatorPubkey }

    const roomA = await Room.create({ room_id: ROOM, config, signature: sig, clock })
    const roomB = await Room.create({ room_id: ROOM, config, signature: sig, clock })
    const roomM = await Room.create({ room_id: ROOM, config, signature: sig, clock })

    // channels[0] -> peerA, channels[1] -> peerB, channels[2] -> mediator
    const channels = createBroadcastChannels(3)
    const chA = channels[0]!
    const chB = channels[1]!
    const chM = channels[2]!

    // Wire: chX.send() delivers to the other two channels' handlers.
    // chA.onReceive receives messages sent by roomB or roomM, so roomA ingests them.
    // chB.onReceive receives messages sent by roomA or roomM, so roomB ingests them.
    // chM.onReceive receives messages sent by roomA or roomB, so roomM ingests them.
    chA.onReceive((env) => { void roomA.handleRemoteEnvelope(env) })
    chB.onReceive((env) => { void roomB.handleRemoteEnvelope(env) })
    chM.onReceive((env) => { void roomM.handleRemoteEnvelope(env) })

    const mediatorLlm = new ScriptedLLMAdapter({
      consolidatorOutputs: [mediatorOutput(1), mediatorOutput(2)],
      verifierAlways: { equivalent: true },
    })
    const peerLlm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
      auditConsolidation: { faithful: true, issues: [] },
    })

    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()

    // Step 1: peerA joins -> broadcast
    for (const ev of await roomA.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })) {
      await chA.send(ev.payload)
    }
    await flush()

    // Step 2: peerB joins -> broadcast
    for (const ev of await roomB.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 'sb' as never })) {
      await chB.send(ev.payload)
    }
    await flush()

    // Step 3: mediator joins -> broadcast
    for (const ev of await roomM.handleMediatorJoin({ pubkey: mediatorPubkey, signature: 'sm' as never })) {
      await chM.send(ev.payload)
    }
    await flush()

    expect(roomA.state).toBe('active')
    expect(roomB.state).toBe('active')
    expect(roomM.state).toBe('active')

    const aId = roomA.participants.find((p) => p.role_label === 'A')!.agent_id
    const bId = roomA.participants.find((p) => p.role_label === 'B')!.agent_id

    for (let round = 0; round < 2; round++) {
      // Step 5: peerA sends
      for (const ev of await roomA.handleSend({ agent_id: aId, content_ciphertext: `A round ${round}`, signature: 's' as never })) {
        await chA.send(ev.payload)
      }
      await flush()

      // Step 6: peerB sends -> both peers now in consolidating
      for (const ev of await roomB.handleSend({ agent_id: bId, content_ciphertext: `B round ${round}`, signature: 's' as never })) {
        await chB.send(ev.payload)
      }
      await flush()

      expect(roomA.state).toBe('consolidating')
      expect(roomB.state).toBe('consolidating')
      expect(roomM.state).toBe('consolidating')

      // Step 7: mediator consolidates
      const consolidationEvent = await roomM.runMediatorConsolidation({ llm: mediatorLlm, signature: 'sm' as never })
      await chM.send(consolidationEvent.payload)
      await flush()

      expect(roomA.pending_consolidation).not.toBeNull()
      expect(roomB.pending_consolidation).not.toBeNull()

      // Step 8: peerA reviews (accepts)
      const acceptA = await roomA.reviewConsolidation({ agent_id: aId, llm: peerLlm, signature: 'sa' as never })
      await chA.send(acceptA.payload)
      await flush()

      // Step 9: peerB reviews (accepts)
      const acceptB = await roomB.reviewConsolidation({ agent_id: bId, llm: peerLlm, signature: 'sb' as never })
      await chB.send(acceptB.payload)
      await flush()

      expect(acceptA.payload.type).toBe('consolidation_accept')
      expect(acceptB.payload.type).toBe('consolidation_accept')

      // Step 10: mediator merges
      const mergeEvent = await roomM.runMediatorMerge({ signature: 'sm' as never })
      await chM.send(mergeEvent.payload)
      await flush()

      expect(mergeEvent.payload.type).toBe('consolidation_merge')
      expect(roomA.state).toBe('active')
      expect(roomB.state).toBe('active')
      expect(roomM.state).toBe('active')
      expect(roomA.current_round).toBe(round + 1)
      expect(roomB.current_round).toBe(round + 1)
      expect(roomM.current_round).toBe(round + 1)
    }

    expect(roomA.current_artifact).not.toBeNull()
    expect(roomB.current_artifact).not.toBeNull()
    expect(roomM.current_artifact).not.toBeNull()

    // Step 11: peerA proposes done -> broadcast
    for (const ev of await roomA.handleProposeDone({ agent_id: aId, reason: 'aligned', signature: 's' as never })) {
      await chA.send(ev.payload)
    }
    await flush()

    // peerB accepts done -> broadcast
    for (const ev of await roomB.handleAcceptDone({ agent_id: bId, signature: 's' as never })) {
      await chB.send(ev.payload)
    }
    await flush()

    expect(roomA.state).toBe('closing')
    expect(roomB.state).toBe('closing')

    await roomA.finalize()
    await roomB.finalize()
    await roomM.finalize()

    expect(roomA.state).toBe('closed')
    expect(roomB.state).toBe('closed')
    expect(roomM.state).toBe('closed')

    // All three Rooms must have converged to the same log head.
    const headA = roomA.log.getHeadHash()
    const headB = roomB.log.getHeadHash()
    const headM = roomM.log.getHeadHash()
    expect(headA).toBe(headB)
    expect(headA).toBe(headM)

    // All three see the same artifact.
    expect(roomA.current_artifact).toEqual(roomB.current_artifact)
    expect(roomA.current_artifact).toEqual(roomM.current_artifact)

    expect(roomA.current_round).toBe(2)
  })
})
