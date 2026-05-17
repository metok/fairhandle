import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig, type RoomId, type Pubkey } from '@fairhandle/domain'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { createBroadcastChannels } from '@fairhandle/channel-memory'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'
import { FixedClock } from '@fairhandle/clock-system'

const ROOM = '66666666-7777-4888-8999-aaaaaaaaaaaa' as RoomId

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

describe('E2E mediator dispute — one round disputes, then resolves', () => {
  it('dispute increments consecutive_disputes on all three rooms, then a later round succeeds', async () => {
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

    chA.onReceive((env) => { void roomA.handleRemoteEnvelope(env) })
    chB.onReceive((env) => { void roomB.handleRemoteEnvelope(env) })
    chM.onReceive((env) => { void roomM.handleRemoteEnvelope(env) })

    // mediator needs 2 consolidation outputs: round 0 (disputed, retried) + round 1 (accepted)
    const mediatorLlm = new ScriptedLLMAdapter({
      consolidatorOutputs: [mediatorOutput(1), mediatorOutput(2)],
      verifierAlways: { equivalent: true },
    })

    // peerA's audit: first call returns unfaithful (round 0 dispute), then faithful (round 1)
    const peerLlmA = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
      auditConsolidation: [
        { faithful: false, issues: ['mediator omitted peerA term'] },
        { faithful: true, issues: [] },
      ],
    })

    const peerLlmB = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
      auditConsolidation: { faithful: true, issues: [] },
    })

    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()

    // Joins
    for (const ev of await roomA.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })) {
      await chA.send(ev.payload)
    }
    await flush()

    for (const ev of await roomB.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 'sb' as never })) {
      await chB.send(ev.payload)
    }
    await flush()

    for (const ev of await roomM.handleMediatorJoin({ pubkey: mediatorPubkey, signature: 'sm' as never })) {
      await chM.send(ev.payload)
    }
    await flush()

    expect(roomA.state).toBe('active')
    expect(roomB.state).toBe('active')
    expect(roomM.state).toBe('active')

    const aId = roomA.participants.find((p) => p.role_label === 'A')!.agent_id
    const bId = roomA.participants.find((p) => p.role_label === 'B')!.agent_id

    // === Round 0: will produce a dispute ===

    for (const ev of await roomA.handleSend({ agent_id: aId, content_ciphertext: 'A opening', signature: 's' as never })) {
      await chA.send(ev.payload)
    }
    await flush()

    for (const ev of await roomB.handleSend({ agent_id: bId, content_ciphertext: 'B response', signature: 's' as never })) {
      await chB.send(ev.payload)
    }
    await flush()

    expect(roomA.state).toBe('consolidating')
    expect(roomB.state).toBe('consolidating')
    expect(roomM.state).toBe('consolidating')

    const consolidationR0 = await roomM.runMediatorConsolidation({ llm: mediatorLlm, signature: 'sm' as never })
    await chM.send(consolidationR0.payload)
    await flush()

    expect(roomA.pending_consolidation).not.toBeNull()
    expect(roomB.pending_consolidation).not.toBeNull()

    // peerA disputes (auditConsolidation[0] = faithful: false)
    const disputeEvent = await roomA.reviewConsolidation({ agent_id: aId, llm: peerLlmA, signature: 'sa' as never })
    await chA.send(disputeEvent.payload)
    await flush()

    expect(disputeEvent.payload.type).toBe('consolidation_dispute')

    // All three rooms should see consecutive_disputes = 1 and return to active
    expect(roomA.consecutive_disputes).toBe(1)
    expect(roomB.consecutive_disputes).toBe(1)
    expect(roomM.consecutive_disputes).toBe(1)

    expect(roomA.state).toBe('active')
    expect(roomB.state).toBe('active')
    expect(roomM.state).toBe('active')

    // No merge happened; current_artifact is still null
    expect(roomA.current_artifact).toBeNull()
    expect(roomB.current_artifact).toBeNull()
    expect(roomM.current_artifact).toBeNull()

    // === Round 1 (retry): both peers accept ===

    for (const ev of await roomA.handleSend({ agent_id: aId, content_ciphertext: 'A revised', signature: 's' as never })) {
      await chA.send(ev.payload)
    }
    await flush()

    for (const ev of await roomB.handleSend({ agent_id: bId, content_ciphertext: 'B revised', signature: 's' as never })) {
      await chB.send(ev.payload)
    }
    await flush()

    expect(roomA.state).toBe('consolidating')
    expect(roomB.state).toBe('consolidating')
    expect(roomM.state).toBe('consolidating')

    const consolidationR1 = await roomM.runMediatorConsolidation({ llm: mediatorLlm, signature: 'sm' as never })
    await chM.send(consolidationR1.payload)
    await flush()

    // peerA now accepts (auditConsolidation[1] = faithful: true)
    const acceptA = await roomA.reviewConsolidation({ agent_id: aId, llm: peerLlmA, signature: 'sa' as never })
    await chA.send(acceptA.payload)
    await flush()

    // peerB also accepts
    const acceptB = await roomB.reviewConsolidation({ agent_id: bId, llm: peerLlmB, signature: 'sb' as never })
    await chB.send(acceptB.payload)
    await flush()

    expect(acceptA.payload.type).toBe('consolidation_accept')
    expect(acceptB.payload.type).toBe('consolidation_accept')

    const mergeEvent = await roomM.runMediatorMerge({ signature: 'sm' as never })
    await chM.send(mergeEvent.payload)
    await flush()

    expect(mergeEvent.payload.type).toBe('consolidation_merge')

    // After successful merge, consecutive_disputes resets to 0
    expect(roomA.consecutive_disputes).toBe(0)
    expect(roomB.consecutive_disputes).toBe(0)
    expect(roomM.consecutive_disputes).toBe(0)

    expect(roomA.state).toBe('active')
    expect(roomB.state).toBe('active')
    expect(roomM.state).toBe('active')

    expect(roomA.current_artifact).not.toBeNull()
    expect(roomB.current_artifact).not.toBeNull()
    expect(roomM.current_artifact).not.toBeNull()

    // All three log heads must match — the chain converged despite the dispute
    const headA = roomA.log.getHeadHash()
    const headB = roomB.log.getHeadHash()
    const headM = roomM.log.getHeadHash()
    expect(headA).toBe(headB)
    expect(headA).toBe(headM)
  })
})
