import { describe, it, expect, vi } from 'vitest'
import { Room, defaultRoomConfig, type RoomId, type ArtifactHistoryPort } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'

const ROOM = 'eeeeeeee-1111-4111-8111-aaaaaaaaaaaa' as RoomId

function sameOutput() {
  return {
    artifact: { markdown: 'doc', version: 1, overlay: [], open_issues: [], changelog: 'c' },
    open_issues: [],
    changelog: 'c',
  }
}

describe('Room — ArtifactHistoryPort wiring', () => {
  it('calls artifact_history.commit once on a successful merge', async () => {
    const commit = vi.fn().mockResolvedValue({ commit_hash: 'abc' })
    const init = vi.fn().mockResolvedValue(undefined)
    const log = vi.fn().mockResolvedValue([])
    const diff = vi.fn().mockResolvedValue('')
    const exportBundle = vi.fn().mockResolvedValue(Buffer.alloc(0))
    const verifyTrailers = vi.fn().mockResolvedValue({ ok: true })
    const history: ArtifactHistoryPort = { init, commit, log, diff, exportBundle, verifyTrailers }

    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const llm = new ScriptedLLMAdapter({ consolidatorOutputs: [sameOutput()], verifierAlways: { equivalent: true } })
    const room = await Room.create({
      room_id: ROOM,
      config: defaultRoomConfig(),
      signature: sig,
      clock,
      artifact_history: history,
    })
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 's' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 's' as never })
    const aId = room.participants[0]!.agent_id
    const bId = room.participants[1]!.agent_id
    await room.handleSend({ agent_id: aId, content_ciphertext: 'a', signature: 's' as never })
    await room.handleSend({ agent_id: bId, content_ciphertext: 'b', signature: 's' as never })
    await room.runOwnConsolidation({ llm, our_node_id: 'A', signature: 's' as never })
    ;(room as unknown as { peer_proposal: unknown }).peer_proposal = sameOutput()
    await room.attemptMerge({ llm, low_node_id: 'A', signature: 's' as never })

    expect(commit).toHaveBeenCalledTimes(1)
    const arg = commit.mock.calls[0]
    expect(arg).toBeDefined()
    expect(arg![0].round_index).toBe(0)
  })

  it('does not call commit on dispute', async () => {
    const commit = vi.fn().mockResolvedValue({ commit_hash: 'abc' })
    const history: ArtifactHistoryPort = {
      init: vi.fn().mockResolvedValue(undefined),
      commit,
      log: vi.fn().mockResolvedValue([]),
      diff: vi.fn().mockResolvedValue(''),
      exportBundle: vi.fn().mockResolvedValue(Buffer.alloc(0)),
      verifyTrailers: vi.fn().mockResolvedValue({ ok: true }),
    }

    const sig = new StubSignatureAdapter()
    const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [sameOutput()],
      verifierAlways: { equivalent: true },
      artifactEquivalence: { equivalent: false, divergences: ['scripted dispute'] },
    })
    const room = await Room.create({
      room_id: ROOM,
      config: defaultRoomConfig(),
      signature: sig,
      clock,
      artifact_history: history,
    })
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 's' as never })
    await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 's' as never })
    const aId = room.participants[0]!.agent_id
    const bId = room.participants[1]!.agent_id
    await room.handleSend({ agent_id: aId, content_ciphertext: 'a', signature: 's' as never })
    await room.handleSend({ agent_id: bId, content_ciphertext: 'b', signature: 's' as never })
    await room.runOwnConsolidation({ llm, our_node_id: 'A', signature: 's' as never })
    // Stuff a divergent peer proposal to force a dispute.
    ;(room as unknown as { peer_proposal: unknown }).peer_proposal = {
      artifact: { markdown: 'doc', version: 1, overlay: [], open_issues: ['differ'], changelog: 'c' },
      open_issues: ['differ'],
      changelog: 'c',
    }
    await room.attemptMerge({ llm, low_node_id: 'A', signature: 's' as never })

    expect(commit).not.toHaveBeenCalled()
  })
})
