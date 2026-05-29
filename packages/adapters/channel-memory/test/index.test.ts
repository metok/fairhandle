import { describe, it, expect } from 'vitest'
import { createPairedChannels, createBroadcastChannels, createReplayBroadcastChannels } from '../src/index.js'
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

describe('createBroadcastChannels', () => {
  it('throws when n is less than 2', () => {
    expect(() => createBroadcastChannels(1)).toThrow()
  })

  it('returns n channels', () => {
    const channels = createBroadcastChannels(3)
    expect(channels).toHaveLength(3)
  })

  it('send from channel 0 is received by channels 1 and 2 but not by channel 0 itself', async () => {
    const channels = createBroadcastChannels(3)
    const ch0 = channels[0]!
    const ch1 = channels[1]!
    const ch2 = channels[2]!
    const recv0: Envelope[] = []
    const recv1: Envelope[] = []
    const recv2: Envelope[] = []
    ch0.onReceive((e) => recv0.push(e))
    ch1.onReceive((e) => recv1.push(e))
    ch2.onReceive((e) => recv2.push(e))
    const env = fakeEnvelope()
    await ch0.send(env)
    expect(recv0).toEqual([])
    expect(recv1).toEqual([env])
    expect(recv2).toEqual([env])
  })

  it('send from each of three channels reaches exactly the other two', async () => {
    const channels = createBroadcastChannels(3)
    const ch0 = channels[0]!
    const ch1 = channels[1]!
    const ch2 = channels[2]!
    const recv0: Envelope[] = []
    const recv1: Envelope[] = []
    const recv2: Envelope[] = []
    ch0.onReceive((e) => recv0.push(e))
    ch1.onReceive((e) => recv1.push(e))
    ch2.onReceive((e) => recv2.push(e))
    const e0 = fakeEnvelope()
    const e1 = fakeEnvelope()
    const e2 = fakeEnvelope()
    await ch0.send(e0)
    await ch1.send(e1)
    await ch2.send(e2)
    expect(recv0).toEqual([e1, e2])
    expect(recv1).toEqual([e0, e2])
    expect(recv2).toEqual([e0, e1])
  })

  it('supports unsubscribe', async () => {
    const channels = createBroadcastChannels(3)
    const ch0 = channels[0]!
    const ch1 = channels[1]!
    const ch2 = channels[2]!
    const recv1: Envelope[] = []
    const recv2: Envelope[] = []
    const off = ch1.onReceive((e) => recv1.push(e))
    ch2.onReceive((e) => recv2.push(e))
    off()
    await ch0.send(fakeEnvelope())
    expect(recv1).toEqual([])
    expect(recv2).toHaveLength(1)
  })

  it('close prevents further sends', async () => {
    const ch0 = createBroadcastChannels(3)[0]!
    await ch0.close()
    await expect(ch0.send(fakeEnvelope())).rejects.toThrow('channel closed')
  })
})

async function flush(iterations = 10) {
  for (let i = 0; i < iterations; i++) {
    await new Promise((r) => setTimeout(r, 0))
  }
}

describe('createReplayBroadcastChannels', () => {
  it('delivers messages to already-registered handlers', async () => {
    const [ch0, ch1, ch2] = createReplayBroadcastChannels(3)
    const recv1: Envelope[] = []
    const recv2: Envelope[] = []
    ch1!.onReceive((e) => recv1.push(e))
    ch2!.onReceive((e) => recv2.push(e))
    const env = fakeEnvelope()
    await ch0!.send(env)
    await flush()
    expect(recv1).toEqual([env])
    expect(recv2).toEqual([env])
  })

  it('replays history to a handler registered after send', async () => {
    const [ch0, ch1, ch2] = createReplayBroadcastChannels(3)
    const env = fakeEnvelope()
    await ch0!.send(env)
    await flush()

    const recv1: Envelope[] = []
    ch1!.onReceive((e) => recv1.push(e))
    expect(recv1).toEqual([env])

    const recv2: Envelope[] = []
    ch2!.onReceive((e) => recv2.push(e))
    expect(recv2).toEqual([env])
  })

  it('does not replay to sender', async () => {
    const [ch0, ch1] = createReplayBroadcastChannels(2)
    const env = fakeEnvelope()
    await ch0!.send(env)
    await flush()

    const recv0: Envelope[] = []
    ch0!.onReceive((e) => recv0.push(e))
    expect(recv0).toEqual([])

    const recv1: Envelope[] = []
    ch1!.onReceive((e) => recv1.push(e))
    expect(recv1).toEqual([env])
  })

  it('throws when n is less than 2', () => {
    expect(() => createReplayBroadcastChannels(1)).toThrow()
  })
})
