import type { Pubkey } from './ids.js'

export type DeadlockPolicy = 'best_effort' | 'escalate_to_humans'

export interface RoomConfig {
  /** Maximum number of `send_message` turns total. Must be even and >= 2. */
  turn_cap: number
  /** Maximum wall-clock duration in ms from waiting->active transition. */
  time_cap_ms: number
  /** What to do when 3 consecutive consolidations dispute. */
  deadlock_policy: DeadlockPolicy
  /** Optional opening markdown artifact (initiator provides). */
  opening_artifact: string | null
  /** If set, the joining peer's pubkey must match. */
  expected_peer_pubkey: Pubkey | null
  /** If set, the room expects a mediator with this pubkey to join. */
  mediator_pubkey: Pubkey | null
}

export function defaultRoomConfig(): RoomConfig {
  return {
    turn_cap: 50,
    time_cap_ms: 60 * 60 * 1000,
    deadlock_policy: 'best_effort',
    opening_artifact: null,
    expected_peer_pubkey: null,
    mediator_pubkey: null,
  }
}

export function validateRoomConfig(cfg: RoomConfig): void {
  if (cfg.turn_cap < 2) throw new Error('turn_cap must be >= 2')
  if (cfg.turn_cap % 2 !== 0) throw new Error('turn_cap must be even (full rounds)')
  if (cfg.time_cap_ms < 1000) throw new Error('time_cap_ms must be >= 1000')
}
