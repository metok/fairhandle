import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  Room,
  defaultRoomConfig,
  type RoomId,
  type RoomConfig,
  type ChannelPort,
  type LLMPort,
  type Pubkey,
  type AgentId,
  type Envelope,
  type KeyPair,
} from '@fairhandle/domain'
import { Ed25519SignatureAdapter } from '@fairhandle/signature-ed25519'
import { WebSocketServerChannel, WebSocketClientChannel, WebSocketHubChannel } from '@fairhandle/channel-ws'
import { SqliteStorageAdapter } from '@fairhandle/storage-sqlite'
import { StorageGitAdapter } from '@fairhandle/storage-git'
import { AnthropicLLMAdapter } from '@fairhandle/llm-anthropic'
import { SystemClock } from '@fairhandle/clock-system'
import {
  encodeInvite,
  decodeInvite,
  newRoomId,
  hashRoomConfig,
} from './invite.js'

export interface RoomRegistryConfig {
  role_label: string
  /** Base directory for room-specific state. Defaults to a fresh tmp dir per process. */
  base_dir?: string
  /**
   * Injectable host channel factory for tests. Given a mediator flag, returns a ChannelPort
   * with a listen() method. Defaults to WebSocketHubChannel (mediator=true) or
   * WebSocketServerChannel (mediator=false).
   */
  host_channel_factory?: (opts: { mediator: boolean }) => ChannelPort & { listen: () => Promise<number> }
  /**
   * Injectable client channel factory for tests. Returns a ChannelPort with a connect() method.
   * Defaults to new WebSocketClientChannel(url).
   */
  client_channel_factory?: (_url: string) => ChannelPort & { connect: () => Promise<void> }
  /**
   * Injectable LLM factory for tests. Defaults to new AnthropicLLMAdapter().
   */
  llm_factory?: () => LLMPort
}

interface RoomHandle {
  room: Room
  channel: ChannelPort
  storage: SqliteStorageAdapter
  gitDir: string
  artifactHistory: StorageGitAdapter
  sig: Ed25519SignatureAdapter
  identityKeypair: KeyPair
  myAgentId: AgentId
  myPubkey: Pubkey
  myIdx: 0 | 1
  myRoleLabel: string
  llm: LLMPort
  baseDir: string
  /** Background loop driving the protocol forward (consolidation, etc.). */
  loopPromise: Promise<void>
  closed: boolean
}

export interface CreateRoomResult {
  room_id: string
  invite_code: string
}

export interface JoinRoomResult {
  room_id: string
}

interface ToolArgs {
  [k: string]: unknown
}

export class RoomRegistry {
  private rooms = new Map<string, RoomHandle>()
  private clock = new SystemClock()
  private baseDir: string
  private mediatorKeypairPromise: Promise<KeyPair> | null = null
  private mediatorSig: Ed25519SignatureAdapter | null = null
  // Per-room serialization queues: concurrent persistEvents calls are chained
  // to prevent UNIQUE constraint violations on the SQLite event log.
  private persistTails = new Map<string, Promise<void>>()

  constructor(private readonly cfg: RoomRegistryConfig) {
    this.baseDir = cfg.base_dir ?? mkdtempSync(join(tmpdir(), 'fairhandle-mcp-'))
  }

  list(): Array<{ room_id: string; state: string; role_label: string }> {
    return [...this.rooms.entries()].map(([room_id, h]) => ({
      room_id,
      state: h.room.state,
      role_label: this.cfg.role_label,
    }))
  }

  async handleTool(name: string, args: ToolArgs): Promise<unknown> {
    switch (name) {
      case 'create_room':
        return this.createRoom(args as { role_label?: string; mediator_pubkey?: string })
      case 'join_room':
        return this.joinRoom(args as { invite_code: string; role_label?: string })
      case 'send_message':
        return this.sendMessage(args as { room_id: string; content: string })
      case 'propose_done':
        return this.proposeDone(args as { room_id: string; reason: string })
      case 'accept_done':
        return this.acceptDone(args as { room_id: string })
      case 'leave_room':
        return this.leaveRoom(args as { room_id: string; reason: string })
      case 'get_room_state':
        return this.getRoomState(args as { room_id: string })
      case 'get_mediator_identity':
        return this.getMediatorIdentity()
      case 'join_as_mediator':
        return this.joinAsMediator(args as { invite_code: string })
      default:
        throw new Error(`unknown tool: ${name}`)
    }
  }

  private async getMediatorIdentity(): Promise<{ pubkey: string }> {
    const kp = await this.getMediatorKeypair()
    return { pubkey: kp.pubkey }
  }

  private getMediatorKeypair(): Promise<KeyPair> {
    if (this.mediatorKeypairPromise === null) {
      const sig = new Ed25519SignatureAdapter()
      this.mediatorSig = sig
      this.mediatorKeypairPromise = sig.generateEphemeralKeyPair()
    }
    return this.mediatorKeypairPromise
  }

  getRoomConfig(room_id: string): RoomConfig {
    return this.get(room_id).room.config
  }

  getRoomChannel(room_id: string): ChannelPort {
    return this.get(room_id).channel
  }

  getRoomIdentityPubkey(room_id: string): Pubkey {
    return this.get(room_id).identityKeypair.pubkey
  }

  async createRoom(args: { role_label?: string; mediator_pubkey?: string }): Promise<CreateRoomResult> {
    if (args.mediator_pubkey === '') {
      throw new Error('mediator_pubkey must be a non-empty string when provided')
    }

    const room_id = newRoomId()
    const config = {
      ...defaultRoomConfig(),
      mediator_pubkey: args.mediator_pubkey ? (args.mediator_pubkey as Pubkey) : null,
    }
    const myRoleLabel = args.role_label ?? this.cfg.role_label
    const sig = new Ed25519SignatureAdapter()
    const myKp = await sig.generateEphemeralKeyPair()

    let channel: ChannelPort
    let port: number
    if (this.cfg.host_channel_factory) {
      const ch = this.cfg.host_channel_factory({ mediator: config.mediator_pubkey !== null })
      port = await ch.listen()
      channel = ch
    } else if (config.mediator_pubkey !== null) {
      const hub = new WebSocketHubChannel({ port: 0 })
      port = await hub.listen()
      channel = hub
    } else {
      const ws = new WebSocketServerChannel({ port: 0 })
      port = await ws.listen()
      channel = ws
    }

    const { storage, gitDir, artifactHistory, baseDir } = this.setupStorage(room_id)
    const llm: LLMPort = this.cfg.llm_factory ? this.cfg.llm_factory() : new AnthropicLLMAdapter()

    const room = await Room.create({
      room_id: room_id as RoomId,
      config,
      signature: sig,
      clock: this.clock,
      artifact_history: artifactHistory,
    })

    channel.onReceive((env: Envelope) => {
      void room.handleRemoteEnvelope(env).then(() => this.persistEvents(room_id, room, storage))
    })

    const joinEvents = await room.handleJoin({
      pubkey: myKp.pubkey,
      role_label: myRoleLabel,
      signature: 'placeholder' as never,
    })
    for (const ev of joinEvents) await channel.send(ev.payload)
    await this.persistEvents(room_id, room, storage)

    const myAgentId = room.participants[0]!.agent_id

    const handle: RoomHandle = {
      room,
      channel,
      storage,
      gitDir,
      artifactHistory,
      sig,
      identityKeypair: myKp,
      myAgentId,
      myPubkey: myKp.pubkey,
      myIdx: 0,
      myRoleLabel,
      llm,
      baseDir,
      loopPromise: Promise.resolve(),
      closed: false,
    }
    handle.loopPromise = this.driveLoop(room_id, handle, 'A')
    this.rooms.set(room_id, handle)

    const invite = encodeInvite({
      room_id,
      initiator_pubkey: myKp.pubkey,
      config_hash: hashRoomConfig(config),
      host: '127.0.0.1',
      port,
      mediator_pubkey: config.mediator_pubkey ?? null,
    })
    return { room_id, invite_code: invite }
  }

  async joinRoom(args: { invite_code: string; role_label?: string }): Promise<JoinRoomResult> {
    const invite = decodeInvite(args.invite_code)
    const room_id = invite.room_id
    const myRoleLabel = args.role_label ?? this.cfg.role_label
    const config = { ...defaultRoomConfig(), mediator_pubkey: invite.mediator_pubkey ?? null }
    const sig = new Ed25519SignatureAdapter()
    const myKp = await sig.generateEphemeralKeyPair()
    const llm: LLMPort = this.cfg.llm_factory ? this.cfg.llm_factory() : new AnthropicLLMAdapter()

    const url = `ws://${invite.host}:${invite.port}`
    const client: ChannelPort & { connect: () => Promise<void> } = this.cfg.client_channel_factory
      ? this.cfg.client_channel_factory(url)
      : new WebSocketClientChannel(url)
    await client.connect()
    const channel: ChannelPort = client

    const { storage, gitDir, artifactHistory, baseDir } = this.setupStorage(room_id)

    const room = await Room.create({
      room_id: room_id as RoomId,
      config,
      signature: sig,
      clock: this.clock,
      artifact_history: artifactHistory,
    })

    channel.onReceive((env: Envelope) => {
      void room.handleRemoteEnvelope(env).then(() => this.persistEvents(room_id, room, storage))
    })

    // Wait for initiator's join envelope to arrive (so we are participant[1] not [0]).
    await waitFor(() => room.participants.length >= 1, 30_000, 'never saw initiator join')

    const joinEvents = await room.handleJoin({
      pubkey: myKp.pubkey,
      role_label: myRoleLabel,
      signature: 'placeholder' as never,
    })
    for (const ev of joinEvents) await channel.send(ev.payload)
    await this.persistEvents(room_id, room, storage)

    // Find my participant index by pubkey
    const myParticipant = room.participants.find((p) => p.pubkey === myKp.pubkey)
    if (!myParticipant) throw new Error('failed to find own participant after join')
    const myIdx = room.participants.indexOf(myParticipant) === 1 ? 1 : 0

    const handle: RoomHandle = {
      room,
      channel,
      storage,
      gitDir,
      artifactHistory,
      sig,
      identityKeypair: myKp,
      myAgentId: myParticipant.agent_id,
      myPubkey: myKp.pubkey,
      myIdx: myIdx as 0 | 1,
      myRoleLabel,
      llm,
      baseDir,
      loopPromise: Promise.resolve(),
      closed: false,
    }
    handle.loopPromise = this.driveLoop(room_id, handle, 'B')
    this.rooms.set(room_id, handle)
    return { room_id }
  }

  async joinAsMediator(args: { invite_code: string }): Promise<JoinRoomResult> {
    const invite = decodeInvite(args.invite_code)
    if (invite.mediator_pubkey === null) {
      throw new Error('invite is not for a mediator room')
    }
    const room_id = invite.room_id

    const mediatorKp = await this.getMediatorKeypair()
    if (mediatorKp.pubkey !== invite.mediator_pubkey) {
      throw new Error(
        `mediator pubkey mismatch: this server's pubkey (${mediatorKp.pubkey}) does not match invite's mediator_pubkey (${invite.mediator_pubkey})`,
      )
    }

    const config: RoomConfig = { ...defaultRoomConfig(), mediator_pubkey: invite.mediator_pubkey }

    const sig = this.mediatorSig ?? new Ed25519SignatureAdapter()
    const llm: LLMPort = this.cfg.llm_factory ? this.cfg.llm_factory() : new AnthropicLLMAdapter()

    const url = `ws://${invite.host}:${invite.port}`
    const client: ChannelPort & { connect: () => Promise<void> } = this.cfg.client_channel_factory
      ? this.cfg.client_channel_factory(url)
      : new WebSocketClientChannel(url)
    await client.connect()
    const channel: ChannelPort = client

    const { storage, gitDir, artifactHistory, baseDir } = this.setupStorage(room_id)

    const room = await Room.create({
      room_id: room_id as RoomId,
      config,
      signature: sig,
      clock: this.clock,
      artifact_history: artifactHistory,
    })

    channel.onReceive((env: Envelope) => {
      void room.handleRemoteEnvelope(env).then(() => this.persistEvents(room_id, room, storage))
    })

    await waitFor(
      () => room.participants.filter((p) => p.role === 'peer').length === 2,
      30_000,
      'never saw both peers join',
    )

    const mediatorJoinEvents = await room.handleMediatorJoin({
      pubkey: mediatorKp.pubkey as Pubkey,
      signature: 'placeholder' as never,
    })
    for (const ev of mediatorJoinEvents) await channel.send(ev.payload)
    await this.persistEvents(room_id, room, storage)

    const mediatorParticipant = room.participants.find((p) => p.role === 'mediator')
    if (!mediatorParticipant) throw new Error('mediator participant not found after handleMediatorJoin')

    const handle: RoomHandle = {
      room,
      channel,
      storage,
      gitDir,
      artifactHistory,
      sig,
      identityKeypair: mediatorKp,
      myAgentId: mediatorParticipant.agent_id,
      myPubkey: mediatorKp.pubkey as Pubkey,
      myIdx: 0,
      myRoleLabel: 'Mediator',
      llm,
      baseDir,
      loopPromise: Promise.resolve(),
      closed: false,
    }
    this.rooms.set(room_id, handle)
    return { room_id }
  }

  async sendMessage(args: { room_id: string; content: string }): Promise<{ ok: true; turn_index: number }> {
    const h = this.get(args.room_id)
    await waitFor(() => h.room.state === 'active' && h.room.current_turn_index % 2 === h.myIdx, 60_000, 'not active or not my turn')
    const evs = await h.room.handleSend({
      agent_id: h.myAgentId,
      content_ciphertext: args.content,
      signature: 'placeholder' as never,
    })
    for (const ev of evs) await h.channel.send(ev.payload)
    await this.persistEvents(args.room_id, h.room, h.storage)
    return { ok: true, turn_index: h.room.current_turn_index }
  }

  async proposeDone(args: { room_id: string; reason: string }): Promise<{ ok: true }> {
    const h = this.get(args.room_id)
    await waitFor(() => h.room.state === 'active', 60_000, 'not active')
    const evs = await h.room.handleProposeDone({
      agent_id: h.myAgentId,
      reason: args.reason,
      signature: 'placeholder' as never,
    })
    for (const ev of evs) await h.channel.send(ev.payload)
    await this.persistEvents(args.room_id, h.room, h.storage)
    return { ok: true }
  }

  async acceptDone(args: { room_id: string }): Promise<{ ok: true; state: string }> {
    const h = this.get(args.room_id)
    await waitFor(() => h.room.proposeDoneBy != null && h.room.state === 'active', 60_000, 'no propose_done')
    const evs = await h.room.handleAcceptDone({
      agent_id: h.myAgentId,
      signature: 'placeholder' as never,
    })
    for (const ev of evs) await h.channel.send(ev.payload)
    await this.persistEvents(args.room_id, h.room, h.storage)
    await h.room.finalize()
    return { ok: true, state: h.room.state }
  }

  async leaveRoom(args: { room_id: string; reason: string }): Promise<{ ok: true }> {
    const h = this.get(args.room_id)
    const evs = await h.room.handleLeave({
      agent_id: h.myAgentId,
      reason: args.reason,
      signature: 'placeholder' as never,
    })
    for (const ev of evs) await h.channel.send(ev.payload)
    await this.persistEvents(args.room_id, h.room, h.storage)
    return { ok: true }
  }

  async getRoomState(args: { room_id: string }): Promise<{
    state: string
    current_turn_index: number
    current_round: number
    participants: Array<{ agent_id: string; role_label: string; pubkey: string }>
    artifact: unknown
    transcript: Array<{ role_label: string; content: string; turn_index: number; round_index: number }>
    head_hash: string | null
    consecutive_disputes: number
    hard_limit_hit: string | null
    walk_away_by: string | null
    my_role_label: string
    my_idx: 0 | 1
  }> {
    const h = this.get(args.room_id)
    const r = h.room
    const labelByAgent = new Map(r.participants.map((p) => [p.agent_id, p.role_label]))
    let round = 0
    const transcript = r.log
      .getEvents()
      .filter((e) => e.payload.type === 'send_message')
      .map((e, idx) => {
        const send = e.payload.payload as { type: 'send_message'; ciphertext: string }
        const entry = {
          role_label: labelByAgent.get(e.payload.agent_id) ?? e.payload.agent_id.slice(0, 8),
          content: send.ciphertext,
          turn_index: idx,
          round_index: round,
        }
        if ((idx + 1) % 2 === 0) round++
        return entry
      })
    return {
      state: r.state,
      current_turn_index: r.current_turn_index,
      current_round: r.current_round,
      participants: r.participants.map((p) => ({ agent_id: p.agent_id, role_label: p.role_label, pubkey: p.pubkey })),
      artifact: r.current_artifact,
      transcript,
      head_hash: r.log.getHeadHash(),
      consecutive_disputes: r.consecutive_disputes,
      hard_limit_hit: r.hard_limit_hit,
      walk_away_by: r.walk_away_by,
      my_role_label: h.myRoleLabel,
      my_idx: h.myIdx,
    }
  }

  async getDecryptedState(room_id: string): Promise<unknown> {
    return this.getRoomState({ room_id })
  }

  async getDecryptedTranscript(room_id: string): Promise<Array<{ agent_id: string; content: string; turn_index: number; round_index: number }>> {
    const h = this.get(room_id)
    const events = h.room.log.getEvents()
    let round = 0
    return events
      .filter((e) => e.payload.type === 'send_message')
      .map((e, idx) => {
        const send = e.payload.payload as { type: 'send_message'; ciphertext: string }
        const out = { agent_id: e.payload.agent_id, content: send.ciphertext, turn_index: idx, round_index: round }
        if ((idx + 1) % 2 === 0) round++
        return out
      })
  }

  async getChain(room_id: string): Promise<{ room_id: string; events: unknown[] }> {
    const h = this.get(room_id)
    return { room_id, events: h.room.log.getEvents() as unknown[] }
  }

  async closeAll(): Promise<void> {
    for (const h of this.rooms.values()) {
      h.closed = true
      await h.channel.close()
      h.storage.close()
    }
    this.rooms.clear()
  }

  private get(room_id: string): RoomHandle {
    const h = this.rooms.get(room_id)
    if (!h) throw new Error(`unknown room: ${room_id}`)
    return h
  }

  private setupStorage(room_id: string): {
    storage: SqliteStorageAdapter
    gitDir: string
    artifactHistory: StorageGitAdapter
    baseDir: string
  } {
    const baseDir = join(this.baseDir, room_id)
    mkdirSync(baseDir, { recursive: true })
    const storage = new SqliteStorageAdapter(join(baseDir, 'chain.db'))
    const gitDir = join(baseDir, 'artifact.git')
    const artifactHistory = new StorageGitAdapter({ dir: gitDir })
    // init is async but the adapter handles missing dir lazily; init eagerly to avoid races
    void artifactHistory.init()
    return { storage, gitDir, artifactHistory, baseDir }
  }

  private persistEvents(room_id: string, room: Room, storage: SqliteStorageAdapter): Promise<void> {
    const tail = (this.persistTails.get(room_id) ?? Promise.resolve()).then(async () => {
      const events = room.log.getEvents()
      const stored = await storage.getEvents(room_id as RoomId)
      for (let i = stored.length; i < events.length; i++) {
        await storage.appendEvent(room_id as RoomId, events[i]!)
      }
      // Also write chain.json snapshot for HTTP and verifier access.
      const chainPath = join(this.rooms.get(room_id)?.baseDir ?? this.baseDir, 'chain.json')
      writeFileSync(chainPath, JSON.stringify({ room_id, events }))
    })
    // eslint-disable-next-line no-console
    this.persistTails.set(room_id, tail.catch((err) => { console.error('[persistEvents]', room_id, err) }))
    return tail
  }

  /**
   * Background loop that auto-runs consolidation when the room enters that state,
   * and auto-merges on the low-node side. Per spec, A is always the low-node id when
   * the initiator is A. Plan 1 keeps this assumption.
   */
  private async driveLoop(room_id: string, h: RoomHandle, node: 'A' | 'B'): Promise<void> {
    while (!h.closed) {
      try {
        await waitFor(
          () => h.closed || h.room.state === 'consolidating' || h.room.state === 'closing' || h.room.state === 'closed',
          365 * 24 * 60 * 60 * 1000, // effectively forever
          'background loop predicate',
        )
        if (h.closed || h.room.state === 'closing' || h.room.state === 'closed') return
        if (h.room.state !== 'consolidating') continue

        const prop = await h.room.runOwnConsolidation({
          llm: h.llm,
          our_node_id: node,
          signature: 'placeholder' as never,
        })
        await h.channel.send(prop.payload)
        await this.persistEvents(room_id, h.room, h.storage)

        // Wait until peer proposal arrives
        await waitFor(
          () => h.closed || h.room.peerProposal != null || h.room.state !== 'consolidating',
          120_000,
          'peer proposal never arrived',
        )
        if (h.closed) return
        if (h.room.state !== 'consolidating') continue

        if (node === 'A') {
          const merge = await h.room.attemptMerge({
            llm: h.llm,
            low_node_id: 'A',
            signature: 'placeholder' as never,
          })
          await h.channel.send(merge.payload)
          await this.persistEvents(room_id, h.room, h.storage)
        } else {
          // B side waits for A's merge envelope to land
          await waitFor(
            () => h.closed || h.room.state === 'active' || h.room.state === 'closing' || h.room.state === 'closed',
            120_000,
            'never resumed from consolidation',
          )
        }
      } catch (e) {
        if (h.closed) return
        // Surface the error to stderr but don't kill the registry; the user can decide next steps.
        // eslint-disable-next-line no-console
        console.error(`[driveLoop ${room_id}]`, e)
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
  }
}

async function waitFor(pred: () => boolean, timeout: number, msg: string): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error('timeout: ' + msg)
    await new Promise((r) => setTimeout(r, 100))
  }
}
