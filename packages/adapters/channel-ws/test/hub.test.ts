import { describe, it, expect } from 'vitest'
import { WebSocketHubChannel, WebSocketClientChannel } from '../src/index.js'
import type { Envelope, AcceptDonePayload, RoomId, AgentId, HashHex, SignatureHex } from '@fairhandle/domain'

function fakeEnv(): Envelope {
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

describe('WebSocketHubChannel', () => {
  it('hub send() reaches all connected clients', async () => {
    const hub = new WebSocketHubChannel()
    const port = await hub.listen()
    const c1 = new WebSocketClientChannel(`ws://127.0.0.1:${port}`)
    const c2 = new WebSocketClientChannel(`ws://127.0.0.1:${port}`)
    await c1.connect()
    await c2.connect()

    const c1Received: Envelope[] = []
    const c2Received: Envelope[] = []
    c1.onReceive((e) => c1Received.push(e))
    c2.onReceive((e) => c2Received.push(e))

    await hub.send(fakeEnv())
    await new Promise((r) => setTimeout(r, 50))

    expect(c1Received.length).toBe(1)
    expect(c2Received.length).toBe(1)

    await c1.close()
    await c2.close()
    await hub.close()
  })

  it('client message reaches hub onReceive and every OTHER client, not sender', async () => {
    const hub = new WebSocketHubChannel()
    const port = await hub.listen()
    const c1 = new WebSocketClientChannel(`ws://127.0.0.1:${port}`)
    const c2 = new WebSocketClientChannel(`ws://127.0.0.1:${port}`)
    await c1.connect()
    await c2.connect()

    const hubReceived: Envelope[] = []
    const c1Received: Envelope[] = []
    const c2Received: Envelope[] = []
    hub.onReceive((e) => hubReceived.push(e))
    c1.onReceive((e) => c1Received.push(e))
    c2.onReceive((e) => c2Received.push(e))

    await c1.send(fakeEnv())
    await new Promise((r) => setTimeout(r, 50))

    expect(hubReceived.length).toBe(1)
    expect(c2Received.length).toBe(1)
    expect(c1Received.length).toBe(0)

    await c1.close()
    await c2.close()
    await hub.close()
  })

  it('message from client 2 reaches hub and client 1, not client 2', async () => {
    const hub = new WebSocketHubChannel()
    const port = await hub.listen()
    const c1 = new WebSocketClientChannel(`ws://127.0.0.1:${port}`)
    const c2 = new WebSocketClientChannel(`ws://127.0.0.1:${port}`)
    await c1.connect()
    await c2.connect()

    const hubReceived: Envelope[] = []
    const c1Received: Envelope[] = []
    const c2Received: Envelope[] = []
    hub.onReceive((e) => hubReceived.push(e))
    c1.onReceive((e) => c1Received.push(e))
    c2.onReceive((e) => c2Received.push(e))

    await c2.send(fakeEnv())
    await new Promise((r) => setTimeout(r, 50))

    expect(hubReceived.length).toBe(1)
    expect(c1Received.length).toBe(1)
    expect(c2Received.length).toBe(0)

    await c1.close()
    await c2.close()
    await hub.close()
  })

  it('hub send() before any client connects is buffered and delivered on first connect', async () => {
    const hub = new WebSocketHubChannel()
    const port = await hub.listen()

    await hub.send(fakeEnv())

    const c1 = new WebSocketClientChannel(`ws://127.0.0.1:${port}`)
    await c1.connect()
    await new Promise((r) => setTimeout(r, 50))

    const received: Envelope[] = []
    c1.onReceive((e) => received.push(e))
    await new Promise((r) => setTimeout(r, 10))

    expect(received.length).toBe(1)

    await c1.close()
    await hub.close()
  })

  it('the queue is replayed to every late-connecting client', async () => {
    const hub = new WebSocketHubChannel()
    const port = await hub.listen()

    await hub.send(fakeEnv())

    const c1 = new WebSocketClientChannel(`ws://127.0.0.1:${port}`)
    await c1.connect()
    await new Promise((r) => setTimeout(r, 50))

    const c1Received: Envelope[] = []
    const c2Received: Envelope[] = []
    c1.onReceive((e) => c1Received.push(e))

    const c2 = new WebSocketClientChannel(`ws://127.0.0.1:${port}`)
    await c2.connect()
    await new Promise((r) => setTimeout(r, 50))
    c2.onReceive((e) => c2Received.push(e))
    await new Promise((r) => setTimeout(r, 10))

    expect(c1Received.length).toBe(1)
    expect(c2Received.length).toBe(1)

    await c1.close()
    await c2.close()
    await hub.close()
  })

  it('after close() the hub no longer delivers envelopes', async () => {
    const hub = new WebSocketHubChannel()
    const port = await hub.listen()
    const c1 = new WebSocketClientChannel(`ws://127.0.0.1:${port}`)
    await c1.connect()

    const received: Envelope[] = []
    hub.onReceive((e) => received.push(e))

    await hub.close()
    await new Promise((r) => setTimeout(r, 50))

    expect(received.length).toBe(0)
  })
})
