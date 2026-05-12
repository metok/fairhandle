import type { Envelope } from './envelope.js'
import type { HashHex } from './ids.js'

export interface Event {
  /** Monotonic from 0; equals position in the log. */
  index: number
  /** sha256 of the previous event, or the room_id for index 0. */
  prev_hash: HashHex
  /** The signed envelope produced this event. */
  payload: Envelope
  /** sha256(canonical(payload)). */
  payload_hash: HashHex
  /** sha256(prev_hash || payload_hash). */
  hash: HashHex
  /** Timestamp the receiver appended; not signed. */
  appended_at: string
}
