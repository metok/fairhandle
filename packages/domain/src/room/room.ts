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
import type { LLMPort, ConsolidatorOutput } from '../ports/llm.js'
import type { Envelope, JoinRoomPayload } from '../types/envelope.js'
import type { Event } from '../types/event.js'
import type { Artifact } from '../types/artifact.js'
import type { Message } from '../types/message.js'
import { MerkleLog } from '../log/merkle-log.js'
import { validateRoomConfig } from '../types/config.js'
import { sha256Hex, hashCanonical } from '../crypto/hash.js'
import { runRoundConsolidation } from '../consolidation/orchestrator.js'
import { verifyStructuralAgreement } from '../consolidation/verifier.js'

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
  current_artifact: Artifact | null = null
  private own_proposal: ConsolidatorOutput | null = null
  private peer_proposal: ConsolidatorOutput | null = null
  private propose_done_by: AgentId | null = null

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

  async runOwnConsolidation(input: {
    llm: LLMPort
    our_node_id: 'A' | 'B'
    signature: SignatureHex
  }): Promise<Event> {
    if (this.state !== 'consolidating') {
      throw new Error(`cannot consolidate: state is ${this.state}`)
    }
    const out = await runRoundConsolidation({
      llm: input.llm,
      room_config: this.deps.config,
      previous_artifact: this.current_artifact,
      transcript_since_last_consolidation: this.lastRoundMessages(),
    })
    this.own_proposal = out
    const proposal_hash = hashCanonical(out) as HashHex
    const envelope: Envelope = {
      v: 1,
      room_id: this.deps.room_id,
      agent_id: this.participantForNodeId(input.our_node_id).agent_id,
      type: 'consolidation_proposal',
      payload: {
        type: 'consolidation_proposal',
        round_index: this.current_round,
        ciphertext: JSON.stringify(out),
        proposal_hash,
      },
      prev_event_hash: this.log.getHeadHash() as HashHex,
      client_ts: this.deps.clock.nowIso(),
      nonce: 'AAAAAAAAAAAAAAAAAAAAAA==',
      signature: input.signature,
    }
    return this.log.append(envelope, this.deps.clock.nowIso())
  }

  async attemptMerge(input: {
    llm: LLMPort
    low_node_id: 'A' | 'B'
    signature: SignatureHex
  }): Promise<Event> {
    if (this.state !== 'consolidating') throw new Error('not in consolidating')
    if (!this.own_proposal || !this.peer_proposal) throw new Error('missing proposals')
    const a = input.low_node_id === 'A' ? this.own_proposal : this.peer_proposal
    const b = input.low_node_id === 'A' ? this.peer_proposal : this.own_proposal
    const verifyResult = await verifyStructuralAgreement({ a, b, llm: input.llm, low_node_id: input.low_node_id })

    let envelope: Envelope
    if (verifyResult.outcome === 'agreed') {
      const canonical = input.low_node_id === 'A' ? a : b
      this.current_artifact = canonical.artifact
      envelope = {
        v: 1,
        room_id: this.deps.room_id,
        agent_id: this.participantForNodeId(input.low_node_id).agent_id,
        type: 'consolidation_merge',
        payload: {
          type: 'consolidation_merge',
          round_index: this.current_round,
          canonical_artifact_hash: hashCanonical(canonical.artifact) as HashHex,
          proposal_hashes: { a: hashCanonical(a) as HashHex, b: hashCanonical(b) as HashHex },
          canonical_artifact_ciphertext: JSON.stringify(canonical.artifact),
        },
        prev_event_hash: this.log.getHeadHash() as HashHex,
        client_ts: this.deps.clock.nowIso(),
        nonce: 'AAAAAAAAAAAAAAAAAAAAAA==',
        signature: input.signature,
      }
    } else {
      envelope = {
        v: 1,
        room_id: this.deps.room_id,
        agent_id: this.participantForNodeId(input.low_node_id).agent_id,
        type: 'consolidation_dispute',
        payload: {
          type: 'consolidation_dispute',
          round_index: this.current_round,
          proposal_hashes: { a: hashCanonical(a) as HashHex, b: hashCanonical(b) as HashHex },
          disagreement_summary_ciphertext: JSON.stringify(verifyResult.disagreement),
        },
        prev_event_hash: this.log.getHeadHash() as HashHex,
        client_ts: this.deps.clock.nowIso(),
        nonce: 'AAAAAAAAAAAAAAAAAAAAAA==',
        signature: input.signature,
      }
    }
    const event = this.log.append(envelope, this.deps.clock.nowIso())
    this.advanceAfterConsolidation()
    return event
  }

  private advanceAfterConsolidation(): void {
    this.own_proposal = null
    this.peer_proposal = null
    this.current_round++
    this.state = 'active'
  }

  private participantForNodeId(node: 'A' | 'B'): AgentParticipant {
    const idx = node === 'A' ? 0 : 1
    const p = this.participants[idx]
    if (!p) throw new Error('participant not seated')
    return p
  }

  async finalize(): Promise<void> {
    if (this.state !== 'closing') throw new Error(`cannot finalize: state is ${this.state}`)
    this.state = 'closed'
  }

  async handleProposeDone(input: { agent_id: AgentId; reason: string; signature: SignatureHex }): Promise<Event[]> {
    if (this.state !== 'active') throw new Error(`cannot propose_done: ${this.state}`)
    if (!this.participants.some((p) => p.agent_id === input.agent_id)) {
      throw new Error('unknown agent')
    }
    this.propose_done_by = input.agent_id
    const envelope: Envelope = {
      v: 1,
      room_id: this.deps.room_id,
      agent_id: input.agent_id,
      type: 'propose_done',
      payload: { type: 'propose_done', reason: input.reason },
      prev_event_hash: this.log.getHeadHash() as HashHex,
      client_ts: this.deps.clock.nowIso(),
      nonce: 'AAAAAAAAAAAAAAAAAAAAAA==',
      signature: input.signature,
    }
    return [this.log.append(envelope, this.deps.clock.nowIso())]
  }

  async handleAcceptDone(input: { agent_id: AgentId; signature: SignatureHex }): Promise<Event[]> {
    if (this.state !== 'active') throw new Error(`cannot accept_done: ${this.state}`)
    if (!this.propose_done_by) throw new Error('no propose_done outstanding')
    if (this.propose_done_by === input.agent_id) throw new Error('cannot accept your own propose_done')
    const envelope: Envelope = {
      v: 1,
      room_id: this.deps.room_id,
      agent_id: input.agent_id,
      type: 'accept_done',
      payload: { type: 'accept_done' },
      prev_event_hash: this.log.getHeadHash() as HashHex,
      client_ts: this.deps.clock.nowIso(),
      nonce: 'AAAAAAAAAAAAAAAAAAAAAA==',
      signature: input.signature,
    }
    const ev = this.log.append(envelope, this.deps.clock.nowIso())
    this.state = 'closing'
    return [ev]
  }

  private lastRoundMessages(): Message[] {
    const sends = this.log.getEvents()
      .filter((e) => e.payload.type === 'send_message')
      .slice(-2)
    return sends.map((e, i) => ({
      agent_id: e.payload.agent_id,
      content: (e.payload.payload as { type: 'send_message'; ciphertext: string }).ciphertext,
      turn_index: this.current_turn_index - 2 + i,
      round_index: this.current_round,
    }))
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
      case 'consolidation_proposal': {
        const p = env.payload as { type: 'consolidation_proposal'; ciphertext: string }
        const parsed = JSON.parse(p.ciphertext) as ConsolidatorOutput
        // Determine if this is our own or peer's proposal by agent_id.
        const isOwnAgent = this.participants.some((part) => part.agent_id === env.agent_id && part === this.participants[0])
        if (this.own_proposal && this.peer_proposal) break // both set
        if (this.own_proposal === null && isOwnAgent) this.own_proposal = parsed
        else this.peer_proposal = parsed
        break
      }
      case 'consolidation_merge': {
        const p = env.payload as { type: 'consolidation_merge'; canonical_artifact_ciphertext: string }
        this.current_artifact = JSON.parse(p.canonical_artifact_ciphertext) as Artifact
        this.advanceAfterConsolidation()
        break
      }
      case 'consolidation_dispute': {
        this.advanceAfterConsolidation()
        break
      }
      case 'propose_done': {
        this.propose_done_by = env.agent_id
        break
      }
      case 'accept_done': {
        this.state = 'closing'
        break
      }
      default:
        // Other envelope types are handled in later tasks.
        break
    }
  }
}
