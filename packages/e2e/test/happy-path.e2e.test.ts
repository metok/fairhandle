import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig, type RoomId } from '@fairhandle/domain'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { createPairedChannels } from '@fairhandle/channel-memory'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'
import { FixedClock } from '@fairhandle/clock-system'

const ROOM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as RoomId

function cannedRound(version: number) {
  return {
    artifact: {
      markdown: '# Round ' + version + '\n\nAgreed terms.',
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
      changelog: 'r' + version,
    },
    open_issues: [],
    changelog: 'r' + version,
  }
}

describe('E2E happy path — two-round negotiation, both peers sign off', () => {
  it('runs end-to-end without errors and closes', async () => {
    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const llmA = new ScriptedLLMAdapter({
      consolidatorOutputs: [cannedRound(1), cannedRound(2)],
      verifierAlways: { equivalent: true },
    })
    const llmB = new ScriptedLLMAdapter({
      consolidatorOutputs: [cannedRound(1), cannedRound(2)],
      verifierAlways: { equivalent: true },
    })

    const roomA = await Room.create({ room_id: ROOM, config: defaultRoomConfig(), signature: sig, clock })
    const roomB = await Room.create({ room_id: ROOM, config: defaultRoomConfig(), signature: sig, clock })

    const [chA, chB] = createPairedChannels()

    // Wiring: chA is Alice's end of the pipe (her sends are read by chB's handlers).
    //         chB is Bob's end of the pipe (his sends are read by chA's handlers).
    // So envelopes received at chB are FROM Alice and should be applied to roomB;
    // envelopes received at chA are FROM Bob and should be applied to roomA.
    chB.onReceive((env) => {
      void roomB.handleRemoteEnvelope(env)
    })
    chA.onReceive((env) => {
      void roomA.handleRemoteEnvelope(env)
    })

    // === scenario ===
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    const aJoin = await roomA.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 'sa' as never })
    for (const ev of aJoin) await chA.send(ev.payload)
    const bJoin = await roomB.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 'sb' as never })
    for (const ev of bJoin) await chB.send(ev.payload)

    // Wait for delivery to drain.
    await new Promise((r) => setTimeout(r, 0))

    expect(roomA.state).toBe('active')
    expect(roomB.state).toBe('active')

    const aId = roomA.participants[0]!.agent_id
    const bId = roomA.participants[1]!.agent_id

    // Round 1
    const m1 = await roomA.handleSend({ agent_id: aId, content_ciphertext: 'opening from A', signature: 's' as never })
    for (const ev of m1) await chA.send(ev.payload)
    await new Promise((r) => setTimeout(r, 0))
    const m2 = await roomB.handleSend({ agent_id: bId, content_ciphertext: 'response from B', signature: 's' as never })
    for (const ev of m2) await chB.send(ev.payload)
    await new Promise((r) => setTimeout(r, 0))

    expect(roomA.state).toBe('consolidating')
    expect(roomB.state).toBe('consolidating')

    const propA = await roomA.runOwnConsolidation({ llm: llmA, our_node_id: 'A', signature: 's' as never })
    await chA.send(propA.payload)
    const propB = await roomB.runOwnConsolidation({ llm: llmB, our_node_id: 'B', signature: 's' as never })
    await chB.send(propB.payload)
    await new Promise((r) => setTimeout(r, 0))

    const mergeA = await roomA.attemptMerge({ llm: llmA, low_node_id: 'A', signature: 's' as never })
    await chA.send(mergeA.payload)
    await new Promise((r) => setTimeout(r, 0))

    expect(roomA.state).toBe('active')
    expect(roomB.state).toBe('active')
    expect(roomA.current_round).toBe(1)

    // propose_done + accept_done + finalize
    const propDone = await roomA.handleProposeDone({ agent_id: aId, reason: 'aligned', signature: 's' as never })
    for (const ev of propDone) await chA.send(ev.payload)
    await new Promise((r) => setTimeout(r, 0))
    const accDone = await roomB.handleAcceptDone({ agent_id: bId, signature: 's' as never })
    for (const ev of accDone) await chB.send(ev.payload)
    await new Promise((r) => setTimeout(r, 0))

    await roomA.finalize()
    await roomB.finalize()

    expect(roomA.state).toBe('closed')
    expect(roomB.state).toBe('closed')
    expect(roomA.log.getHeadHash()).toBe(roomB.log.getHeadHash())
  })
})
