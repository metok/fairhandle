import { describe, it, expect, afterEach } from 'vitest'
import { RoomRegistry } from '../src/room-registry.js'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'
import type { ChannelPort, Envelope } from '@fairhandle/domain'

// flush() drains the microtask/timer queue so async deliveries settle.
async function flush(iterations = 10) {
  for (let i = 0; i < iterations; i++) {
    await new Promise((r) => setTimeout(r, 0))
  }
}

type Handler = (env: Envelope) => void

/**
 * InMemoryHub simulates a WebSocketHubChannel with full history replay.
 * Any message sent to the hub is broadcast to ALL registered handlers AND
 * added to history. When a new handler is registered via onReceive, all
 * existing history is replayed to it synchronously (matching WS hub behaviour).
 *
 * A single hub instance is shared across all parties. Each party gets its
 * own HubClientView which routes sends THROUGH the hub.
 */
class InMemoryHub {
  private history: Envelope[] = []
  private handlers = new Set<Handler>()

  broadcast(env: Envelope): void {
    this.history.push(env)
    for (const h of this.handlers) h(env)
  }

  addReceiver(handler: Handler): () => void {
    // Replay history first.
    for (const env of this.history) handler(env)
    this.handlers.add(handler)
    return () => { this.handlers.delete(handler) }
  }

  asHostChannel(): ChannelPort & { listen: () => Promise<number> } {
    const hub = this
    return {
      send: async (env: Envelope): Promise<void> => { hub.broadcast(env) },
      onReceive: (handler: Handler) => hub.addReceiver(handler),
      close: async (): Promise<void> => {},
      listen: async (): Promise<number> => 0,
    }
  }

  asClientChannel(): ChannelPort & { connect: () => Promise<void> } {
    const hub = this
    return {
      send: async (env: Envelope): Promise<void> => { hub.broadcast(env) },
      onReceive: (handler: Handler) => hub.addReceiver(handler),
      close: async (): Promise<void> => {},
      connect: async (): Promise<void> => {},
    }
  }
}

describe('joinAsMediator — in-process with channel/LLM injection', () => {
  const registries: RoomRegistry[] = []

  afterEach(async () => {
    for (const r of registries) await r.closeAll()
    registries.length = 0
  })

  it('all three registries have the room; participants = 2 peers + 1 mediator; state = active', async () => {
    // A single InMemoryHub serves as the broadcast hub for the room.
    // All parties share the same hub: send() broadcasts and onReceive() replays history.
    const hub = new InMemoryHub()

    const stubbedLLM = () => new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
    })

    const registryA = new RoomRegistry({
      role_label: 'Alice',
      host_channel_factory: () => hub.asHostChannel(),
      client_channel_factory: () => hub.asClientChannel(),
      llm_factory: stubbedLLM,
    })
    registries.push(registryA)

    const registryB = new RoomRegistry({
      role_label: 'Bob',
      host_channel_factory: () => hub.asHostChannel(),
      client_channel_factory: () => hub.asClientChannel(),
      llm_factory: stubbedLLM,
    })
    registries.push(registryB)

    const registryM = new RoomRegistry({
      role_label: 'Mediator',
      host_channel_factory: () => hub.asHostChannel(),
      client_channel_factory: () => hub.asClientChannel(),
      llm_factory: stubbedLLM,
    })
    registries.push(registryM)

    // Step 1: get mediator pubkey
    const identityResult = await registryM.handleTool('get_mediator_identity', {}) as { pubkey: string }
    const mediatorPubkey = identityResult.pubkey

    // Step 2: Alice creates room with mediator_pubkey (hosts the hub)
    const createResult = await registryA.handleTool('create_room', {
      role_label: 'Alice',
      mediator_pubkey: mediatorPubkey,
    }) as { room_id: string; invite_code: string }
    const { room_id, invite_code } = createResult
    await flush()

    // Step 3: Bob joins — onReceive on hub replays Alice's join event immediately
    const joinResult = await registryB.handleTool('join_room', {
      invite_code,
      role_label: 'Bob',
    }) as { room_id: string }
    expect(joinResult.room_id).toBe(room_id)
    await flush()

    // Step 4: Mediator joins — onReceive replays Alice+Bob join events
    const mediatorResult = await registryM.handleTool('join_as_mediator', {
      invite_code,
    }) as { room_id: string }
    expect(mediatorResult.room_id).toBe(room_id)
    await flush()

    // All three registries must have the room registered
    expect(registryA.list().some((r) => r.room_id === room_id)).toBe(true)
    expect(registryB.list().some((r) => r.room_id === room_id)).toBe(true)
    expect(registryM.list().some((r) => r.room_id === room_id)).toBe(true)

    // Mediator's Room must have 2 peers + 1 mediator
    const mState = await registryM.handleTool('get_room_state', { room_id }) as {
      participants: Array<{ agent_id: string; role_label: string; pubkey: string }>
      state: string
    }
    expect(mState.participants.length).toBe(3)
    expect(mState.state).toBe('active')

    // All three rooms must be in state 'active'
    const aState = await registryA.handleTool('get_room_state', { room_id }) as { state: string }
    const bState = await registryB.handleTool('get_room_state', { room_id }) as { state: string }
    expect(aState.state).toBe('active')
    expect(bState.state).toBe('active')
  }, 30_000)
})

describe('joinAsMediator — rejects non-mediator invites', () => {
  it('throws when the invite has mediator_pubkey: null', async () => {
    const registryA = new RoomRegistry({ role_label: 'Alice' })
    const registryM = new RoomRegistry({ role_label: 'Mediator' })

    // Create a two-peer room (no mediator_pubkey)
    const createResult = await registryA.handleTool('create_room', {
      role_label: 'Alice',
    }) as { room_id: string; invite_code: string }

    await expect(
      registryM.handleTool('join_as_mediator', { invite_code: createResult.invite_code }),
    ).rejects.toThrow('invite is not for a mediator room')

    await registryA.closeAll()
    await registryM.closeAll()
  })
})
