import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileIdentityStore } from '../src/index.js'

let tmp: string

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

function setupStore() {
  tmp = mkdtempSync(join(tmpdir(), 'fairhandle-keys-'))
  return new FileIdentityStore(tmp)
}

describe('FileIdentityStore', () => {
  it('creates a fresh long-lived key on first call and reads it back on second', async () => {
    const store = setupStore()
    const a = await store.loadOrCreateLongLivedKey('alice')
    const b = await store.loadOrCreateLongLivedKey('alice')
    expect(a.pubkey).toBe(b.pubkey)
    expect(Buffer.from(a.private_handle as Uint8Array).toString('hex'))
      .toBe(Buffer.from(b.private_handle as Uint8Array).toString('hex'))
  })

  it('generates a distinct ephemeral key per room and retrieves it', async () => {
    const store = setupStore()
    const room1 = '11111111-1111-4111-8111-111111111111'
    const room2 = '22222222-2222-4222-8222-222222222222'
    const k1 = await store.generateEphemeralRoomKey(room1)
    const k2 = await store.generateEphemeralRoomKey(room2)
    expect(k1.pubkey).not.toBe(k2.pubkey)

    const fetched = await store.getEphemeralRoomKey(room1)
    expect(fetched?.pubkey).toBe(k1.pubkey)

    expect(await store.getEphemeralRoomKey('99999999-9999-4999-8999-999999999999')).toBeNull()
  })
})
