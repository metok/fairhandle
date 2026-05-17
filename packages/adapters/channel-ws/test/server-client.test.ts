import { describe, it, expect } from 'vitest'
import { WebSocketServerChannel, WebSocketClientChannel } from '../src/index.js'
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

describe('WebSocket server/client', () => {
  it('delivers in both directions', async () => {
    const server = new WebSocketServerChannel()
    const port = await server.listen()
    const client = new WebSocketClientChannel(`ws://127.0.0.1:${port}`)
    await client.connect()

    const fromClient: Envelope[] = []
    const fromServer: Envelope[] = []
    server.onReceive((e) => fromClient.push(e))
    client.onReceive((e) => fromServer.push(e))

    await client.send(fakeEnv())
    await server.send(fakeEnv())
    await new Promise((r) => setTimeout(r, 50))

    expect(fromClient.length).toBe(1)
    expect(fromServer.length).toBe(1)

    await client.close()
    await server.close()
  })

  it('buffers inbound messages received before a handler is registered', async () => {
    const server = new WebSocketServerChannel()
    const port = await server.listen()
    // Queue an envelope on the server before any client connects.
    await server.send(fakeEnv())

    const client = new WebSocketClientChannel(`ws://127.0.0.1:${port}`)
    await client.connect()
    // Server flushes the queued envelope the instant the client connects.
    // Simulate a caller that registers its handler late (after Room setup, etc.).
    await new Promise((r) => setTimeout(r, 50))

    const received: Envelope[] = []
    client.onReceive((e) => received.push(e))
    await new Promise((r) => setTimeout(r, 10))

    expect(received.length).toBe(1)

    await client.close()
    await server.close()
  })
})
