/* eslint-disable no-console */
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Room, defaultRoomConfig, type RoomId, type ChannelPort } from '@fairhandle/domain'
import { Ed25519SignatureAdapter } from '@fairhandle/signature-ed25519'
import { WebSocketServerChannel, WebSocketClientChannel } from '@fairhandle/channel-ws'
import { SqliteStorageAdapter } from '@fairhandle/storage-sqlite'
import { AnthropicLLMAdapter } from '@fairhandle/llm-anthropic'
import { SystemClock } from '@fairhandle/clock-system'

async function main() {
  const role = (process.env.FH_ROLE ?? '') as 'A' | 'B'
  const room_id = process.env.FH_ROOM ?? ''
  const port = parseInt(process.env.FH_PORT ?? '0', 10)
  const messages: string[] = JSON.parse(process.env.FH_MESSAGES ?? '[]') as string[]

  const sig = new Ed25519SignatureAdapter()
  const clock = new SystemClock()
  const llm = new AnthropicLLMAdapter()
  const tmpDir = mkdtempSync(join(tmpdir(), `fairhandle-${role}-`))
  const storage = new SqliteStorageAdapter(join(tmpDir, 'chain.db'))

  const room = await Room.create({
    room_id: room_id as RoomId,
    config: defaultRoomConfig(),
    signature: sig,
    clock,
  })

  let channel: ChannelPort
  if (role === 'A') {
    const s = new WebSocketServerChannel({ port })
    await s.listen()
    channel = s
  } else {
    const c = new WebSocketClientChannel(`ws://127.0.0.1:${port}`)
    await c.connect()
    channel = c
  }

  channel.onReceive((env) => {
    void room.handleRemoteEnvelope(env).then(() => storeNew(room, storage, room_id as RoomId))
  })

  const myKp = await sig.generateEphemeralKeyPair()
  const joinEvents = await room.handleJoin({
    pubkey: myKp.pubkey,
    role_label: role,
    signature: 'placeholder' as never,
  })
  for (const ev of joinEvents) await channel.send(ev.payload)
  await storeNew(room, storage, room_id as RoomId)

  // Wait until both peers have joined.
  await waitFor(() => room.state === 'active', 30_000, 'never reached active')

  const myIdx = role === 'A' ? 0 : 1
  const myAgentId = room.participants[myIdx]!.agent_id

  for (let i = 0; i < messages.length; i++) {
    await waitFor(
      () => room.current_turn_index % 2 === myIdx && room.state === 'active',
      30_000,
      'not my turn',
    )
    const evs = await room.handleSend({
      agent_id: myAgentId,
      content_ciphertext: messages[i]!,
      signature: 'placeholder' as never,
    })
    for (const ev of evs) await channel.send(ev.payload)
    await storeNew(room, storage, room_id as RoomId)

    if (room.state === 'consolidating') {
      const prop = await room.runOwnConsolidation({
        llm,
        our_node_id: role,
        signature: 'placeholder' as never,
      })
      await channel.send(prop.payload)
      await storeNew(room, storage, room_id as RoomId)

      await waitFor(() => room.peerProposal != null, 60_000, 'peer proposal never arrived')
      if (role === 'A') {
        const merge = await room.attemptMerge({
          llm,
          low_node_id: 'A',
          signature: 'placeholder' as never,
        })
        await channel.send(merge.payload)
        await storeNew(room, storage, room_id as RoomId)
      } else {
        await waitFor(
          () => room.state === 'active' || room.state === 'closing',
          60_000,
          'never resumed after consolidation',
        )
      }
    }
  }

  if (role === 'A') {
    const p = await room.handleProposeDone({
      agent_id: myAgentId,
      reason: 'aligned',
      signature: 'placeholder' as never,
    })
    for (const ev of p) await channel.send(ev.payload)
  } else {
    await waitFor(() => room.proposeDoneBy != null, 30_000, 'propose_done never seen')
    const a = await room.handleAcceptDone({
      agent_id: myAgentId,
      signature: 'placeholder' as never,
    })
    for (const ev of a) await channel.send(ev.payload)
  }
  await waitFor(() => room.state === 'closing', 30_000, 'never reached closing')
  await room.finalize()
  console.log(JSON.stringify({ role, status: 'done', head: room.log.getHeadHash() }))
  await channel.close()
  storage.close()
}

async function storeNew(room: Room, storage: SqliteStorageAdapter, room_id: RoomId): Promise<void> {
  const events = room.log.getEvents()
  const stored = await storage.getEvents(room_id)
  for (let i = stored.length; i < events.length; i++) {
    await storage.appendEvent(room_id, events[i]!)
  }
}

async function waitFor(pred: () => boolean, timeout: number, msg: string): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error('timeout: ' + msg)
    await new Promise((r) => setTimeout(r, 100))
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
