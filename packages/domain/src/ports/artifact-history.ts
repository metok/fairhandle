import type { Artifact } from '../types/artifact.js'
import type { Pubkey, HashHex } from '../types/ids.js'

export interface CommitMetadata {
  round_index: number
  canonical_peer_pubkey: Pubkey
  other_peer_pubkey: Pubkey
  canonical_peer_label: string
  other_peer_label: string
  merkle_event_hash: HashHex
  proposal_hash_a: HashHex
  proposal_hash_b: HashHex
  changelog: string
  timestamp_iso: string
}

export interface CommitSummary {
  commit_hash: string
  round_index: number
  merkle_event_hash: HashHex
  message_subject: string
}

export interface ArtifactHistoryPort {
  init(): Promise<void>
  commit(meta: CommitMetadata, artifact: Artifact): Promise<{ commit_hash: string }>
  log(): Promise<CommitSummary[]>
  diff(from_commit: string, to_commit: string): Promise<string>
  exportBundle(): Promise<Buffer>
  /** Verify every commit's trailer points to a real chain event hash. Returns first inconsistency or null. */
  verifyTrailers(chainEventHashes: Set<HashHex>): Promise<{ ok: boolean; failing_commit?: string }>
}
