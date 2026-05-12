import { describe, it, expect } from 'vitest'
import { createPairedChannels } from '../src/index.js'
import type { Envelope, AcceptDonePayload, RoomId, AgentId, HashHex, SignatureHex } from '@fairhandle/domain'

function fakeEnvelope(): Envelope {
  return {
    v: 1,
    room_id: '00000000-0000-4000-8000-000000000000' as RoomId,
    agent_id: '00000000-0000-4000-8000-000000000001' as AgentId,
    type: 'accept_done',
    payload: { type: 'accept_done' } as AcceptDonePayload,
    prev_event_hash: 'aa' as HashHex,
    client_ts: '2026-05-12T10:00:00Z',
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA==',
    signature: 'bb' as SignatureHex,
  }
}

describe('createPairedChannels', () => {
  it('delivers from A to B and from B to A', async () => {
    const [a, b] = createPairedChannels()
    const fromA: Envelope[] = []
    const fromB: Envelope[] = []
    b.onReceive((e) => fromA.push(e))
    a.onReceive((e) => fromB.push(e))
    const e1 = fakeEnvelope()
    const e2 = fakeEnvelope()
    await a.send(e1)
    await b.send(e2)
    expect(fromA).toEqual([e1])
    expect(fromB).toEqual([e2])
  })
  it('supports unsubscribe', async () => {
    const [a, b] = createPairedChannels()
    const received: Envelope[] = []
    const off = b.onReceive((e) => received.push(e))
    off()
    await a.send(fakeEnvelope())
    expect(received).toEqual([])
  })
})
