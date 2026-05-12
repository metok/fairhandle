import { randomUUID } from 'node:crypto'
import type {
  RoomId,
  RoomState,
  RoomConfig,
  Pubkey,
  SignatureHex,
  HashHex,
  AgentId,
} from '../types/ids.js'
import type { ClockPort } from '../ports/clock.js'
import type { SignaturePort } from '../ports/signature.js'
import type { Envelope, JoinRoomPayload } from '../types/envelope.js'
import type { Event } from '../types/event.js'
import { MerkleLog } from '../log/merkle-log.js'
import { validateRoomConfig } from '../types/config.js'
import { sha256Hex } from '../crypto/hash.js'

export interface AgentParticipant {
  agent_id: AgentId
  role_label: string
  pubkey: Pubkey
  joined_at_event: number
}

export interface RoomDeps {
  room_id: RoomId
  config: RoomConfig
  signature: SignaturePort
  clock: ClockPort
}

export interface JoinInput {
  pubkey: Pubkey
  role_label: string
  signature: SignatureHex
}

export class Room {
  state: RoomState = 'waiting'
  readonly participants: AgentParticipant[] = []
  readonly log: MerkleLog
  current_turn_index = 0
  current_round = 0

  private constructor(private readonly deps: RoomDeps) {
    validateRoomConfig(deps.config)
    this.log = new MerkleLog(deps.room_id)
  }

  static async create(deps: RoomDeps): Promise<Room> {
    return new Room(deps)
  }

  get room_id(): RoomId { return this.deps.room_id }
  get config(): RoomConfig { return this.deps.config }

  async handleJoin(input: JoinInput): Promise<Event[]> {
    if (this.state !== 'waiting') {
      throw new Error(`cannot join: state is ${this.state}`)
    }
    if (this.participants.length >= 2) {
      throw new Error('room is full')
    }
    if (this.deps.config.expected_peer_pubkey && this.participants.length === 1) {
      if (input.pubkey !== this.deps.config.expected_peer_pubkey) {
        throw new Error('joiner pubkey does not match expected_peer_pubkey')
      }
    }
    if (this.participants.some((p) => p.role_label === input.role_label)) {
      throw new Error(`role_label already taken: ${input.role_label}`)
    }
    const agent_id = randomUUID() as AgentId
    const envelope: Envelope = {
      v: 1,
      room_id: this.deps.room_id,
      agent_id,
      type: 'join_room',
      payload: { type: 'join_room', role_label: input.role_label } as JoinRoomPayload,
      prev_event_hash: (this.log.getHeadHash() ?? '') as HashHex,
      client_ts: this.deps.clock.nowIso(),
      nonce: 'AAAAAAAAAAAAAAAAAAAAAA==',
      signature: input.signature,
    }
    const event = this.log.append(envelope, this.deps.clock.nowIso())
    this.participants.push({
      agent_id,
      role_label: input.role_label,
      pubkey: input.pubkey,
      joined_at_event: event.index,
    })
    if (this.participants.length === 2) {
      this.state = 'active'
    }
    return [event]
  }

  async handleSend(input: {
    agent_id: AgentId
    content_ciphertext: string
    signature: SignatureHex
  }): Promise<Event[]> {
    if (this.state !== 'active') {
      throw new Error(`cannot send: state is ${this.state}`)
    }
    if (this.current_turn_index >= this.deps.config.turn_cap) {
      throw new Error('turn cap reached')
    }
    const expectedAgentIdx = this.current_turn_index % 2
    const expected = this.participants[expectedAgentIdx]
    if (!expected) throw new Error('participants not seated')
    if (expected.agent_id !== input.agent_id) {
      throw new Error('not your turn')
    }
    const envelope: Envelope = {
      v: 1,
      room_id: this.deps.room_id,
      agent_id: input.agent_id,
      type: 'send_message',
      payload: { type: 'send_message', ciphertext: input.content_ciphertext },
      prev_event_hash: this.log.getHeadHash() as HashHex,
      client_ts: this.deps.clock.nowIso(),
      nonce: 'AAAAAAAAAAAAAAAAAAAAAA==',
      signature: input.signature,
    }
    const event = this.log.append(envelope, this.deps.clock.nowIso())
    this.current_turn_index++
    // Round completes after every two turns.
    if (this.current_turn_index % 2 === 0) {
      this.state = 'consolidating'
    }
    return [event]
  }

  async applyRemote(remote: Event): Promise<void> {
    // Re-create the envelope from the remote event payload.
    // Verify chain continuity; do not re-sign — just append the same envelope
    // and let the MerkleLog recompute its own hash (which must match remote.hash
    // because both peers canonicalize the same payload identically).
    const env = remote.payload
    // Discard if from one of our own commands (idempotent re-delivery).
    if (this.log.getEvents().some((e) => e.hash === remote.hash)) return
    const localPrev = (this.log.getHeadHash() ?? this.hashForIndex0()) as HashHex
    if (remote.prev_hash !== localPrev) {
      throw new Error(`chain divergence: expected prev ${localPrev}, got ${remote.prev_hash}`)
    }
    const event = this.log.append(env, this.deps.clock.nowIso())
    if (event.hash !== remote.hash) {
      throw new Error(`hash mismatch after append: ${event.hash} != ${remote.hash}`)
    }
    this.advanceStateFromEnvelope(env)
  }

  private hashForIndex0(): string {
    return sha256Hex(this.deps.room_id)
  }

  private advanceStateFromEnvelope(env: Envelope): void {
    switch (env.type) {
      case 'join_room': {
        const last = this.log.getHead()!
        const payload = env.payload as JoinRoomPayload
        if (this.participants.some((p) => p.agent_id === env.agent_id)) return
        this.participants.push({
          agent_id: env.agent_id,
          role_label: payload.role_label,
          pubkey: '' as Pubkey, // remote: not known to us locally; left blank in Plan 1 stub
          joined_at_event: last.index,
        })
        if (this.participants.length === 2) this.state = 'active'
        break
      }
      case 'send_message': {
        this.current_turn_index++
        if (this.current_turn_index % 2 === 0) this.state = 'consolidating'
        break
      }
      default:
        // Other envelope types are handled in later tasks.
        break
    }
  }
}
