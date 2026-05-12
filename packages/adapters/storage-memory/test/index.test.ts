import { describe, it, expect } from 'vitest'
import { MemoryStorageAdapter } from '../src/index.js'
import type { Event, RoomId, HashHex } from '@fairhandle/domain'

const room = '11111111-1111-4111-8111-111111111111' as RoomId

function fakeEvent(index: number, prev: HashHex, hash: HashHex): Event {
  return {
    index,
    prev_hash: prev,
    payload: {} as Event['payload'],
    payload_hash: ('p' + index) as HashHex,
    hash,
    appended_at: '2026-05-12T10:00:00Z',
  }
}

describe('MemoryStorageAdapter', () => {
  it('returns empty when no events', async () => {
    const s = new MemoryStorageAdapter()
    expect(await s.getEvents(room)).toEqual([])
    expect(await s.getHeadHash(room)).toBeNull()
  })
  it('appends and reads back', async () => {
    const s = new MemoryStorageAdapter()
    const e1 = fakeEvent(0, 'seed' as HashHex, 'h0' as HashHex)
    const e2 = fakeEvent(1, 'h0' as HashHex, 'h1' as HashHex)
    await s.appendEvent(room, e1)
    await s.appendEvent(room, e2)
    expect(await s.getEvents(room)).toEqual([e1, e2])
    expect(await s.getHeadHash(room)).toBe('h1')
  })
})
