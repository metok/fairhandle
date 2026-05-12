import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStorageAdapter } from '../src/index.js'
import type { Event, RoomId, HashHex } from '@fairhandle/domain'

let tmp: string
let s: SqliteStorageAdapter

afterEach(() => {
  s.close()
  rmSync(tmp, { recursive: true, force: true })
})

function setup() {
  tmp = mkdtempSync(join(tmpdir(), 'fairhandle-'))
  s = new SqliteStorageAdapter(join(tmp, 'test.db'))
}

describe('SqliteStorageAdapter', () => {
  it('appends and reads back events', async () => {
    setup()
    const room = '11111111-1111-4111-8111-111111111111' as RoomId
    const ev: Event = {
      index: 0,
      prev_hash: 'seed' as HashHex,
      payload: {} as Event['payload'],
      payload_hash: 'p0' as HashHex,
      hash: 'h0' as HashHex,
      appended_at: '2026-05-12T00:00:00Z',
    }
    await s.appendEvent(room, ev)
    expect((await s.getEvents(room)).length).toBe(1)
    expect(await s.getHeadHash(room)).toBe('h0')
  })
})
