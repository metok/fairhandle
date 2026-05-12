import { describe, it, expect } from 'vitest'
import { MerkleLog } from '../../src/log/merkle-log.js'
import type { Envelope, RoomId, AgentId, HashHex, SignatureHex } from '../../src/index.js'

function envelope(type: 'accept_done' | 'leave_room' = 'accept_done'): Envelope {
  return {
    v: 1,
    room_id: '22222222-2222-4222-8222-222222222222' as RoomId,
    agent_id: '33333333-3333-4333-8333-333333333333' as AgentId,
    type,
    payload: type === 'accept_done' ? { type: 'accept_done' } : { type: 'leave_room', reason: 'x' },
    prev_event_hash: '' as HashHex,
    client_ts: '2026-05-12T00:00:00Z',
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA==',
    signature: 'sig' as SignatureHex,
  }
}

describe('MerkleLog', () => {
  it('starts empty with seed-based prev', () => {
    const log = new MerkleLog('22222222-2222-4222-8222-222222222222' as RoomId)
    expect(log.length).toBe(0)
    expect(log.getHead()).toBe(null)
  })
  it('appends and chains', () => {
    const log = new MerkleLog('22222222-2222-4222-8222-222222222222' as RoomId)
    const e1 = log.append(envelope('accept_done'), '2026-05-12T00:00:01Z')
    const e2 = log.append(envelope('leave_room'), '2026-05-12T00:00:02Z')
    expect(e1.index).toBe(0)
    expect(e2.index).toBe(1)
    expect(e2.prev_hash).toBe(e1.hash)
    expect(log.length).toBe(2)
    expect(log.getHead()!.hash).toBe(e2.hash)
  })
  it('verifies chain integrity', () => {
    const log = new MerkleLog('22222222-2222-4222-8222-222222222222' as RoomId)
    log.append(envelope(), '2026-05-12T00:00:01Z')
    log.append(envelope(), '2026-05-12T00:00:02Z')
    expect(log.verifyIntegrity().ok).toBe(true)
  })
})
