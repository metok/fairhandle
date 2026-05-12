import { describe, it, expect } from 'vitest'
import { isRoomId, isAgentId } from '../../src/types/ids.js'

describe('id type guards', () => {
  it('accepts a valid UUID v4 as RoomId', () => {
    expect(isRoomId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })
  it('rejects a non-UUID string as RoomId', () => {
    expect(isRoomId('not-a-uuid')).toBe(false)
  })
  it('accepts a valid UUID v4 as AgentId', () => {
    expect(isAgentId('123e4567-e89b-42d3-a456-426614174000')).toBe(true)
  })
})
