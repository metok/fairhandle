import { describe, it, expect, vi } from 'vitest'
import { Room, defaultRoomConfig } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'
import type { Pubkey, ArtifactHistoryPort, RoomId } from '../../src/index.js'

const ROOM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const MEDIATOR_PUBKEY = 'mediator-pubkey-hex-task6' as Pubkey

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

async function makeMediatorRoom(overrides?: { deadlock_policy?: 'best_effort' | 'escalate_to_humans'; artifact_history?: ArtifactHistoryPort }) {
  const sig = new StubSignatureAdapter()
  const clock = new FixedClock(new Date('2026-05-17T00:00:00Z'))
  const room = await Room.create({
    room_id: ROOM as RoomId,
    config: { ...defaultRoomConfig(), mediator_pubkey: MEDIATOR_PUBKEY, ...(overrides?.deadlock_policy ? { deadlock_policy: overrides.deadlock_policy } : {}) },
    signature: sig,
    clock,
    ...(overrides?.artifact_history ? { artifact_history: overrides.artifact_history } : {}),
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

  const llm = new ScriptedLLMAdapter({
    consolidatorOutputs: [stubConsolidatorOutput()],
    verifierAlways: { equivalent: true },
  })
  await room.runMediatorConsolidation({ llm, signature: 'sig-mediator' as never })
}

describe('Room — runMediatorMerge (Task 6)', () => {
  it('both peers accept then runMediatorMerge appends consolidation_merge and advances round', async () => {
    const { room } = await makeMediatorRoom()
    await driveToConsolidatingWithProposal(room)

    const aId = room.participants.find((p) => p.role_label === 'A')!.agent_id
    const bId = room.participants.find((p) => p.role_label === 'B')!.agent_id
    const llmAccept = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
      auditConsolidation: { faithful: true, issues: [] },
    })

    await room.reviewConsolidation({ agent_id: aId, llm: llmAccept, signature: 'sa' as never })
    await room.reviewConsolidation({ agent_id: bId, llm: llmAccept, signature: 'sb' as never })

    expect(room.roundAccepts).toHaveLength(2)
    const roundBefore = room.current_round
    const proposalArtifact = room.pending_consolidation!.artifact
    const logLenBefore = room.log.length

    const event = await room.runMediatorMerge({ signature: 'sm' as never })

    expect(room.log.length).toBe(logLenBefore + 1)
    expect(event.payload.type).toBe('consolidation_merge')

    // Mediator is the author of the merge.
    const mediatorId = room.participants.find((p) => p.role === 'mediator')!.agent_id
    expect(event.payload.agent_id).toBe(mediatorId)

    // current_artifact set to the mediator proposal's artifact.
    expect(room.current_artifact).toEqual(proposalArtifact)

    // Round advanced.
    expect(room.current_round).toBe(roundBefore + 1)

    // State back to active.
    expect(room.state).toBe('active')

    // pending_consolidation cleared.
    expect(room.pending_consolidation).toBeNull()
    expect(room.roundAccepts).toHaveLength(0)
  })

  it('runMediatorMerge throws when only one peer has accepted', async () => {
    const { room } = await makeMediatorRoom()
    await driveToConsolidatingWithProposal(room)

    const aId = room.participants.find((p) => p.role_label === 'A')!.agent_id
    const llmAccept = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
      auditConsolidation: { faithful: true, issues: [] },
    })
    await room.reviewConsolidation({ agent_id: aId, llm: llmAccept, signature: 'sa' as never })
    expect(room.roundAccepts).toHaveLength(1)

    const logLenBefore = room.log.length
    await expect(
      room.runMediatorMerge({ signature: 'sm' as never }),
    ).rejects.toThrow(/not all peers/i)
    // No new event appended.
    expect(room.log.length).toBe(logLenBefore)
  })

  it('one peer disputes: consolidation_dispute appended, consecutive_disputes incremented, round retried', async () => {
    const { room } = await makeMediatorRoom()
    await driveToConsolidatingWithProposal(room)

    const aId = room.participants.find((p) => p.role_label === 'A')!.agent_id
    const bId = room.participants.find((p) => p.role_label === 'B')!.agent_id

    const llmAccept = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
      auditConsolidation: { faithful: true, issues: [] },
    })
    const llmDispute = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
      auditConsolidation: { faithful: false, issues: ['omitted term'] },
    })

    await room.reviewConsolidation({ agent_id: aId, llm: llmAccept, signature: 'sa' as never })
    const artifactBefore = room.current_artifact

    const event = await room.reviewConsolidation({ agent_id: bId, llm: llmDispute, signature: 'sb' as never })

    expect(event.payload.type).toBe('consolidation_dispute')
    expect(room.consecutive_disputes).toBe(1)
    // current_artifact unchanged (no merge happened).
    expect(room.current_artifact).toBe(artifactBefore)
    // round was retried: state should be active.
    expect(room.state).toBe('active')

    // runMediatorMerge now throws because round_accepts was cleared.
    await expect(
      room.runMediatorMerge({ signature: 'sm' as never }),
    ).rejects.toThrow()
  })

  it('three consecutive disputes in a mediator room with best_effort leads to closing + deadlock', async () => {
    const { room } = await makeMediatorRoom({ deadlock_policy: 'best_effort' })

    const llmDispute = new ScriptedLLMAdapter({
      consolidatorOutputs: [
        stubConsolidatorOutput(),
        stubConsolidatorOutput(),
        stubConsolidatorOutput(),
      ],
      verifierAlways: { equivalent: true },
      auditConsolidation: { faithful: false, issues: ['always wrong'] },
    })

    for (let r = 0; r < 3; r++) {
      const aId = room.participants.find((p) => p.role_label === 'A')!.agent_id
      const bId = room.participants.find((p) => p.role_label === 'B')!.agent_id
      await room.handleSend({ agent_id: aId, content_ciphertext: 'a', signature: 's' as never })
      await room.handleSend({ agent_id: bId, content_ciphertext: 'b', signature: 's' as never })
      await room.runMediatorConsolidation({ llm: llmDispute, signature: 'sm' as never })

      const disputingPeer = aId
      await room.reviewConsolidation({ agent_id: disputingPeer, llm: llmDispute, signature: 'sp' as never })

      // After 3rd dispute the room closes; don't try to continue.
      if (room.state === 'closing') break
    }

    expect(room.consecutive_disputes).toBe(3)
    expect(room.state).toBe('closing')
    expect(room.hard_limit_hit).toBe('deadlock')
  })

  it('artifact_history.commit called once on successful runMediatorMerge with correct round_index', async () => {
    const commit = vi.fn().mockResolvedValue({ commit_hash: 'abc123' })
    const history: ArtifactHistoryPort = {
      init: vi.fn().mockResolvedValue(undefined),
      commit,
      log: vi.fn().mockResolvedValue([]),
      diff: vi.fn().mockResolvedValue(''),
      exportBundle: vi.fn().mockResolvedValue(Buffer.alloc(0)),
      verifyTrailers: vi.fn().mockResolvedValue({ ok: true }),
    }

    const { room } = await makeMediatorRoom({ artifact_history: history })
    await driveToConsolidatingWithProposal(room)

    const aId = room.participants.find((p) => p.role_label === 'A')!.agent_id
    const bId = room.participants.find((p) => p.role_label === 'B')!.agent_id
    const llmAccept = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
      auditConsolidation: { faithful: true, issues: [] },
    })

    await room.reviewConsolidation({ agent_id: aId, llm: llmAccept, signature: 'sa' as never })
    await room.reviewConsolidation({ agent_id: bId, llm: llmAccept, signature: 'sb' as never })

    await room.runMediatorMerge({ signature: 'sm' as never })

    expect(commit).toHaveBeenCalledTimes(1)
    const meta = commit.mock.calls[0]![0]
    expect(meta.round_index).toBe(0)
  })
})
