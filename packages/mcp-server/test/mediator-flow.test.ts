import { describe, it, expect, afterEach } from 'vitest'
import { RoomRegistry } from '../src/room-registry.js'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'
import { createReplayBroadcastChannels } from '@fairhandle/channel-memory'
import type { ChannelPort, Envelope } from '@fairhandle/domain'

async function flush(iterations = 20) {
  for (let i = 0; i < iterations; i++) {
    await new Promise((r) => setTimeout(r, 0))
  }
}

async function waitFor(pred: () => boolean, timeout: number, msg: string): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error('timeout: ' + msg)
    await new Promise((r) => setTimeout(r, 50))
  }
}

function asHost(ch: ChannelPort): ChannelPort & { listen: () => Promise<number> } {
  return {
    send: (env: Envelope) => ch.send(env),
    onReceive: (h) => ch.onReceive(h),
    close: () => ch.close(),
    listen: async () => 0,
  }
}

function asClient(ch: ChannelPort): ChannelPort & { connect: () => Promise<void> } {
  return {
    send: (env: Envelope) => ch.send(env),
    onReceive: (h) => ch.onReceive(h),
    close: () => ch.close(),
    connect: async () => undefined,
  }
}

function mediatorOutput(version: number) {
  return {
    artifact: {
      markdown: '# Round ' + version + '\n\nMediator consolidated terms.',
      version,
      overlay: [
        {
          span: { start: 0, end: 9 },
          clause_type: 'header',
          status: 'agreed' as const,
          criticality_default: 'low' as const,
          last_changed_at_version: version,
        },
      ],
      open_issues: [],
      changelog: 'mediator-r' + version,
    },
    open_issues: [],
    changelog: 'mediator-r' + version,
  }
}

async function setupThreeRegistries(
  mediatorLlmFactory: () => ScriptedLLMAdapter,
  peerALlmFactory: () => ScriptedLLMAdapter,
  peerBLlmFactory: () => ScriptedLLMAdapter,
) {
  const [chA, chB, chM] = createReplayBroadcastChannels(3)

  const registryA = new RoomRegistry({
    role_label: 'Alice',
    host_channel_factory: () => asHost(chA!),
    client_channel_factory: () => asClient(chA!),
    llm_factory: peerALlmFactory,
  })

  const registryB = new RoomRegistry({
    role_label: 'Bob',
    host_channel_factory: () => asHost(chB!),
    client_channel_factory: () => asClient(chB!),
    llm_factory: peerBLlmFactory,
  })

  const registryM = new RoomRegistry({
    role_label: 'Mediator',
    host_channel_factory: () => asHost(chM!),
    client_channel_factory: () => asClient(chM!),
    llm_factory: mediatorLlmFactory,
  })

  return { registryA, registryB, registryM }
}

describe('mediator-flow: happy path — two mediated rounds then done', () => {
  const registries: RoomRegistry[] = []

  afterEach(async () => {
    for (const r of registries) await r.closeAll()
    registries.length = 0
  })

  it('three registries run two mediated rounds autonomously; all converge to identical log and artifact', async () => {
    const { registryA, registryB, registryM } = await setupThreeRegistries(
      () => new ScriptedLLMAdapter({
        consolidatorOutputs: [mediatorOutput(1), mediatorOutput(2)],
        verifierAlways: { equivalent: true },
      }),
      () => new ScriptedLLMAdapter({
        consolidatorOutputs: [],
        verifierAlways: { equivalent: true },
        auditConsolidation: { faithful: true, issues: [] },
      }),
      () => new ScriptedLLMAdapter({
        consolidatorOutputs: [],
        verifierAlways: { equivalent: true },
        auditConsolidation: { faithful: true, issues: [] },
      }),
    )
    registries.push(registryA, registryB, registryM)

    const identityResult = await registryM.handleTool('get_mediator_identity', {}) as { pubkey: string }
    const mediatorPubkey = identityResult.pubkey

    const createResult = await registryA.handleTool('create_room', {
      role_label: 'Alice',
      mediator_pubkey: mediatorPubkey,
    }) as { room_id: string; invite_code: string }
    const { room_id, invite_code } = createResult
    await flush()

    await registryB.handleTool('join_room', { invite_code, role_label: 'Bob' })
    await flush()

    await registryM.handleTool('join_as_mediator', { invite_code })
    await flush()

    const aState0 = await registryA.handleTool('get_room_state', { room_id }) as { state: string }
    const bState0 = await registryB.handleTool('get_room_state', { room_id }) as { state: string }
    const mState0 = await registryM.handleTool('get_room_state', { room_id }) as { state: string }
    expect(aState0.state).toBe('active')
    expect(bState0.state).toBe('active')
    expect(mState0.state).toBe('active')

    // Round 1: Alice sends, then Bob sends — triggers consolidating
    await registryA.handleTool('send_message', { room_id, content: 'A round 0' })
    await flush()
    await registryB.handleTool('send_message', { room_id, content: 'B round 0' })
    await flush()

    // Wait for loops to run and bring all three back to active with current_round = 1
    await waitFor(
      () => {
        const aRoom = (registryA as unknown as { rooms: Map<string, { room: { state: string; current_round: number } }> }).rooms.get(room_id)
        const bRoom = (registryB as unknown as { rooms: Map<string, { room: { state: string; current_round: number } }> }).rooms.get(room_id)
        const mRoom = (registryM as unknown as { rooms: Map<string, { room: { state: string; current_round: number } }> }).rooms.get(room_id)
        return aRoom?.room.state === 'active' && bRoom?.room.state === 'active' && mRoom?.room.state === 'active' &&
          aRoom.room.current_round === 1 && bRoom.room.current_round === 1 && mRoom.room.current_round === 1
      },
      10_000,
      'rooms did not return to active after round 1',
    )

    // Round 2: repeat
    await registryA.handleTool('send_message', { room_id, content: 'A round 1' })
    await flush()
    await registryB.handleTool('send_message', { room_id, content: 'B round 1' })
    await flush()

    await waitFor(
      () => {
        const aRoom = (registryA as unknown as { rooms: Map<string, { room: { state: string; current_round: number } }> }).rooms.get(room_id)
        const bRoom = (registryB as unknown as { rooms: Map<string, { room: { state: string; current_round: number } }> }).rooms.get(room_id)
        const mRoom = (registryM as unknown as { rooms: Map<string, { room: { state: string; current_round: number } }> }).rooms.get(room_id)
        return aRoom?.room.state === 'active' && bRoom?.room.state === 'active' && mRoom?.room.state === 'active' &&
          aRoom.room.current_round === 2 && bRoom.room.current_round === 2 && mRoom.room.current_round === 2
      },
      10_000,
      'rooms did not return to active after round 2',
    )

    // Propose + accept done
    await registryA.handleTool('propose_done', { room_id, reason: 'aligned' })
    await flush()
    await registryB.handleTool('accept_done', { room_id })
    await flush()

    // All reach closing/closed
    await waitFor(
      () => {
        const aRoom = (registryA as unknown as { rooms: Map<string, { room: { state: string } }> }).rooms.get(room_id)
        const bRoom = (registryB as unknown as { rooms: Map<string, { room: { state: string } }> }).rooms.get(room_id)
        const mRoom = (registryM as unknown as { rooms: Map<string, { room: { state: string } }> }).rooms.get(room_id)
        return (aRoom?.room.state === 'closing' || aRoom?.room.state === 'closed') &&
          (bRoom?.room.state === 'closing' || bRoom?.room.state === 'closed') &&
          (mRoom?.room.state === 'closing' || mRoom?.room.state === 'closed')
      },
      5_000,
      'rooms did not reach closing',
    )

    // Verify current_artifact is set and identical on all three
    expect(registryA.getRoomCurrentArtifact(room_id)).not.toBeNull()
    expect(registryA.getRoomCurrentArtifact(room_id)).toEqual(registryB.getRoomCurrentArtifact(room_id))
    expect(registryA.getRoomCurrentArtifact(room_id)).toEqual(registryM.getRoomCurrentArtifact(room_id))

    // Log heads converge
    expect(registryA.getRoomLogHeadHash(room_id)).not.toBeNull()
    expect(registryA.getRoomLogHeadHash(room_id)).toBe(registryB.getRoomLogHeadHash(room_id))
    expect(registryA.getRoomLogHeadHash(room_id)).toBe(registryM.getRoomLogHeadHash(room_id))
  }, 30_000)
})

describe('mediator-flow: dispute variant — round 1 disputes, round 2 succeeds', () => {
  const registries: RoomRegistry[] = []

  afterEach(async () => {
    for (const r of registries) await r.closeAll()
    registries.length = 0
  })

  it('round 1 dispute increments consecutive_disputes on all three rooms; round 2 succeeds', async () => {
    const { registryA, registryB, registryM } = await setupThreeRegistries(
      () => new ScriptedLLMAdapter({
        consolidatorOutputs: [mediatorOutput(1), mediatorOutput(2)],
        verifierAlways: { equivalent: true },
      }),
      () => new ScriptedLLMAdapter({
        consolidatorOutputs: [],
        verifierAlways: { equivalent: true },
        auditConsolidation: [
          { faithful: false, issues: ['X'] },
          { faithful: true, issues: [] },
        ],
      }),
      () => new ScriptedLLMAdapter({
        consolidatorOutputs: [],
        verifierAlways: { equivalent: true },
        auditConsolidation: { faithful: true, issues: [] },
      }),
    )
    registries.push(registryA, registryB, registryM)

    const identityResult = await registryM.handleTool('get_mediator_identity', {}) as { pubkey: string }
    const mediatorPubkey = identityResult.pubkey

    const createResult = await registryA.handleTool('create_room', {
      role_label: 'Alice',
      mediator_pubkey: mediatorPubkey,
    }) as { room_id: string; invite_code: string }
    const { room_id, invite_code } = createResult
    await flush()

    await registryB.handleTool('join_room', { invite_code, role_label: 'Bob' })
    await flush()
    await registryM.handleTool('join_as_mediator', { invite_code })
    await flush()

    // Round 0 — A disputes
    await registryA.handleTool('send_message', { room_id, content: 'A opening' })
    await flush()
    await registryB.handleTool('send_message', { room_id, content: 'B response' })
    await flush()

    // After dispute: all rooms return to active, consecutive_disputes = 1
    await waitFor(
      () => {
        const aRoom = (registryA as unknown as { rooms: Map<string, { room: { state: string; consecutive_disputes: number } }> }).rooms.get(room_id)
        const bRoom = (registryB as unknown as { rooms: Map<string, { room: { state: string; consecutive_disputes: number } }> }).rooms.get(room_id)
        const mRoom = (registryM as unknown as { rooms: Map<string, { room: { state: string; consecutive_disputes: number } }> }).rooms.get(room_id)
        return aRoom?.room.state === 'active' && bRoom?.room.state === 'active' && mRoom?.room.state === 'active' &&
          aRoom.room.consecutive_disputes === 1 && bRoom.room.consecutive_disputes === 1 && mRoom.room.consecutive_disputes === 1
      },
      10_000,
      'dispute did not resolve correctly',
    )

    const aRoomAfterDispute = (registryA as unknown as { rooms: Map<string, { room: { current_artifact: unknown } }> }).rooms.get(room_id)
    expect(aRoomAfterDispute?.room.current_artifact).toBeNull()

    // Round 1 — both accept
    await registryA.handleTool('send_message', { room_id, content: 'A revised' })
    await flush()
    await registryB.handleTool('send_message', { room_id, content: 'B revised' })
    await flush()

    // After dispute, current_round is 1. After the successful second merge, it becomes 2.
    await waitFor(
      () => {
        const aRoom = (registryA as unknown as { rooms: Map<string, { room: { state: string; current_round: number } }> }).rooms.get(room_id)
        const bRoom = (registryB as unknown as { rooms: Map<string, { room: { state: string; current_round: number } }> }).rooms.get(room_id)
        const mRoom = (registryM as unknown as { rooms: Map<string, { room: { state: string; current_round: number } }> }).rooms.get(room_id)
        return aRoom?.room.state === 'active' && bRoom?.room.state === 'active' && mRoom?.room.state === 'active' &&
          aRoom.room.current_round === 2
      },
      10_000,
      'rooms did not return to active after round 1 (post-dispute)',
    )

    // After successful merge, consecutive_disputes resets to 0
    const aRoomFinal = (registryA as unknown as { rooms: Map<string, { room: { consecutive_disputes: number; current_artifact: unknown } }> }).rooms.get(room_id)
    const bRoomFinal = (registryB as unknown as { rooms: Map<string, { room: { consecutive_disputes: number } }> }).rooms.get(room_id)
    const mRoomFinal = (registryM as unknown as { rooms: Map<string, { room: { consecutive_disputes: number } }> }).rooms.get(room_id)

    expect(aRoomFinal?.room.consecutive_disputes).toBe(0)
    expect(bRoomFinal?.room.consecutive_disputes).toBe(0)
    expect(mRoomFinal?.room.consecutive_disputes).toBe(0)
    expect(aRoomFinal?.room.current_artifact).not.toBeNull()
  }, 30_000)
})

describe('mediator-flow: regression — no-mediator room still uses two-peer loop', () => {
  const registries: RoomRegistry[] = []

  afterEach(async () => {
    for (const r of registries) await r.closeAll()
    registries.length = 0
  })

  it('two-peer no-mediator room completes a round via driveTwoPeerLoop', async () => {
    const [chA, chB] = createReplayBroadcastChannels(2)

    const registryA = new RoomRegistry({
      role_label: 'Alice',
      host_channel_factory: () => asHost(chA!),
      client_channel_factory: () => asClient(chA!),
      llm_factory: () => new ScriptedLLMAdapter({
        consolidatorOutputs: [mediatorOutput(1)],
        verifierAlways: { equivalent: true },
      }),
    })
    const registryB = new RoomRegistry({
      role_label: 'Bob',
      host_channel_factory: () => asHost(chB!),
      client_channel_factory: () => asClient(chB!),
      llm_factory: () => new ScriptedLLMAdapter({
        consolidatorOutputs: [mediatorOutput(1)],
        verifierAlways: { equivalent: true },
      }),
    })
    registries.push(registryA, registryB)

    const createResult = await registryA.handleTool('create_room', { role_label: 'Alice' }) as { room_id: string; invite_code: string }
    const { room_id, invite_code } = createResult
    await flush()

    await registryB.handleTool('join_room', { invite_code, role_label: 'Bob' })
    await flush()

    await registryA.handleTool('send_message', { room_id, content: 'Hello from A' })
    await flush()
    await registryB.handleTool('send_message', { room_id, content: 'Hello from B' })
    await flush()

    await waitFor(
      () => {
        const aRoom = (registryA as unknown as { rooms: Map<string, { room: { state: string; current_round: number } }> }).rooms.get(room_id)
        const bRoom = (registryB as unknown as { rooms: Map<string, { room: { state: string; current_round: number } }> }).rooms.get(room_id)
        return aRoom?.room.state === 'active' && bRoom?.room.state === 'active' &&
          aRoom.room.current_round === 1 && bRoom.room.current_round === 1
      },
      10_000,
      'two-peer room did not complete consolidation',
    )

    expect(registryA.getRoomCurrentArtifact(room_id)).not.toBeNull()
    expect(registryA.getRoomCurrentArtifact(room_id)).toEqual(registryB.getRoomCurrentArtifact(room_id))
  }, 30_000)
})
