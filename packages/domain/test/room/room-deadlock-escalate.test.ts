import { describe, it, expect } from 'vitest'
import { Room, defaultRoomConfig, type RoomId } from '../../src/index.js'
import { StubSignatureAdapter } from '@fairhandle/signature-stub'
import { FixedClock } from '@fairhandle/clock-system'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'

const ROOM = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' as RoomId

function divergent(v: number, s: 'agreed' | 'open') {
  return {
    artifact: { markdown: 'd' + v, version: v, overlay: [{ span: { start: 0, end: 2 }, clause_type: 'x', status: s, criticality_default: 'low' as const, last_changed_at_version: v }], open_issues: [], changelog: 'r' + v },
    open_issues: [],
    changelog: 'r' + v,
  }
}

async function reachThirdDispute(policy: 'best_effort' | 'escalate_to_humans') {
  const sig = new StubSignatureAdapter()
  const clock = new FixedClock(new Date('2026-05-12T00:00:00Z'))
  const llm = new ScriptedLLMAdapter({
    consolidatorOutputs: [
      divergent(1, 'agreed'), divergent(1, 'open'),
      divergent(2, 'agreed'), divergent(2, 'open'),
      divergent(3, 'agreed'), divergent(3, 'open'),
    ],
    verifierAlways: { equivalent: true },
  })
  const room = await Room.create({ room_id: ROOM, config: { ...defaultRoomConfig(), deadlock_policy: policy }, signature: sig, clock })
  const a = await sig.generateEphemeralKeyPair()
  const b = await sig.generateEphemeralKeyPair()
  await room.handleJoin({ pubkey: a.pubkey, role_label: 'A', signature: 's' as never })
  await room.handleJoin({ pubkey: b.pubkey, role_label: 'B', signature: 's' as never })
  for (let r = 0; r < 3; r++) {
    const aId = room.participants[0]!.agent_id
    const bId = room.participants[1]!.agent_id
    await room.handleSend({ agent_id: aId, content_ciphertext: 'a', signature: 's' as never })
    await room.handleSend({ agent_id: bId, content_ciphertext: 'b', signature: 's' as never })
    await room.runOwnConsolidation({ llm, our_node_id: 'A', signature: 's' as never })
    const peerProp = await llm.runConsolidator({} as never)
    ;(room as unknown as { peer_proposal: unknown }).peer_proposal = peerProp
    await room.attemptMerge({ llm, low_node_id: 'A', signature: 's' as never })
  }
  return room
}

describe('Deadlock — escalate_to_humans policy', () => {
  it('transitions to paused after 3 consecutive disputes', async () => {
    const room = await reachThirdDispute('escalate_to_humans')
    expect(room.state).toBe('paused')
  })

  it('human_authorize_continue resets counter and returns to active', async () => {
    const room = await reachThirdDispute('escalate_to_humans')
    await room.humanAuthorizeContinue()
    expect(room.state).toBe('active')
    expect(room.consecutive_disputes).toBe(0)
  })

  it('human_authorize_close transitions to closing with hard_limit_hit', async () => {
    const room = await reachThirdDispute('escalate_to_humans')
    await room.humanAuthorizeClose()
    expect(room.state).toBe('closing')
    expect(room.hard_limit_hit).toBe('deadlock')
  })
})
