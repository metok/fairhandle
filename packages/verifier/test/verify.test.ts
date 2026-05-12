import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { verifyBundle } from '../src/verify.js'

let dir: string

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('verifyBundle', () => {
  it('reports OK for an empty chain', async () => {
    dir = mkdtempSync(join(tmpdir(), 'fh-bundle-'))
    writeFileSync(
      join(dir, 'chain.json'),
      JSON.stringify({ room_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', events: [] }),
    )
    mkdirSync(join(dir, 'artifact.git'))
    const report = await verifyBundle(dir)
    expect(report.ok).toBe(true)
  })

  it('flags chain integrity errors when prev_hash is wrong', async () => {
    dir = mkdtempSync(join(tmpdir(), 'fh-bundle-bad-'))
    writeFileSync(
      join(dir, 'chain.json'),
      JSON.stringify({
        room_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        events: [{
          index: 0,
          prev_hash: 'tampered',
          payload_hash: 'x',
          hash: 'y',
          appended_at: '2026-05-12T00:00:00Z',
          payload: { v: 1, room_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', agent_id: 'x', type: 'join_room', payload: { type: 'join_room', role_label: 'A' }, prev_event_hash: '', client_ts: '2026-05-12T00:00:00Z', nonce: 'n', signature: 's' },
        }],
      }),
    )
    const report = await verifyBundle(dir)
    expect(report.ok).toBe(false)
    expect(report.errors.length).toBeGreaterThan(0)
  })
})
