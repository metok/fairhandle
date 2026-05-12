import { describe, it, expect } from 'vitest'
import { defaultRoomConfig, validateRoomConfig } from '../../src/types/config.js'

describe('RoomConfig', () => {
  it('exposes defaults', () => {
    const cfg = defaultRoomConfig()
    expect(cfg.turn_cap).toBe(50)
    expect(cfg.time_cap_ms).toBe(60 * 60 * 1000)
    expect(cfg.deadlock_policy).toBe('best_effort')
    expect(cfg.opening_artifact).toBeNull()
    expect(cfg.expected_peer_pubkey).toBeNull()
  })
  it('accepts valid configs', () => {
    expect(() => validateRoomConfig(defaultRoomConfig())).not.toThrow()
  })
  it('rejects turn_cap < 2', () => {
    const cfg = { ...defaultRoomConfig(), turn_cap: 1 }
    expect(() => validateRoomConfig(cfg)).toThrow(/turn_cap/)
  })
  it('rejects turn_cap that is odd', () => {
    const cfg = { ...defaultRoomConfig(), turn_cap: 3 }
    expect(() => validateRoomConfig(cfg)).toThrow(/even/)
  })
})
