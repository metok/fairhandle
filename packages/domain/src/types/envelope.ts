import type { AgentId, RoomId, SignatureHex, HashHex } from './ids.js'

export type EnvelopeType =
  | 'join_room'
  | 'mediator_join'
  | 'send_message'
  | 'consolidation_proposal'
  | 'consolidation_merge'
  | 'consolidation_dispute'
  | 'consolidation_accept'
  | 'propose_done'
  | 'accept_done'
  | 'leave_room'
  | 'final_artifact_sign'

export interface JoinRoomPayload {
  type: 'join_room'
  role_label: string
}

export interface MediatorJoinPayload {
  type: 'mediator_join'
}

export interface SendMessagePayload {
  type: 'send_message'
  /** Encrypted in real impl; plaintext in Plan 1 stubs. */
  ciphertext: string
}

export interface ConsolidationProposalPayload {
  type: 'consolidation_proposal'
  round_index: number
  /** Encrypted in real impl; plaintext in Plan 1 stubs. */
  ciphertext: string
  proposal_hash: HashHex
}

export interface ConsolidationMergePayload {
  type: 'consolidation_merge'
  round_index: number
  canonical_artifact_hash: HashHex
  /** Present on the no-mediator path (two proposals); absent on the mediator path (one canonical proposal). */
  proposal_hashes?: { a: HashHex; b: HashHex }
  /** Encrypted in real impl; plaintext in Plan 1 stubs. */
  canonical_artifact_ciphertext: string
}

export interface ConsolidationDisputePayload {
  type: 'consolidation_dispute'
  round_index: number
  proposal_hashes?: { a: HashHex; b: HashHex }
  /** Encrypted in real impl; plaintext in Plan 1 stubs. */
  disagreement_summary_ciphertext: string
}

export interface ConsolidationAcceptPayload {
  type: 'consolidation_accept'
  round_index: number
  proposal_hash: HashHex
}

export interface ProposeDonePayload {
  type: 'propose_done'
  reason: string
}

export interface AcceptDonePayload {
  type: 'accept_done'
}

export interface LeaveRoomPayload {
  type: 'leave_room'
  reason: string
}

export interface FinalArtifactSignPayload {
  type: 'final_artifact_sign'
  principal_signature_over_final_hash: SignatureHex
  public_publish_consent: boolean
}

export type EnvelopePayload =
  | JoinRoomPayload
  | MediatorJoinPayload
  | SendMessagePayload
  | ConsolidationProposalPayload
  | ConsolidationMergePayload
  | ConsolidationDisputePayload
  | ConsolidationAcceptPayload
  | ProposeDonePayload
  | AcceptDonePayload
  | LeaveRoomPayload
  | FinalArtifactSignPayload

export interface Envelope {
  v: 1
  room_id: RoomId
  agent_id: AgentId
  type: EnvelopeType
  payload: EnvelopePayload
  prev_event_hash: HashHex
  client_ts: string // ISO 8601
  nonce: string // base64, 16 bytes
  signature: SignatureHex
}

/** Used to type-narrow envelope.payload by envelope.type at call sites. */
export type PayloadOf<T extends EnvelopeType> = Extract<EnvelopePayload, { type: T }>
