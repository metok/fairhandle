import { describe, it, expect } from 'vitest'
import { RoomRegistry } from '../src/room-registry.js'

const ED25519_PUBKEY_HEX_LENGTH = 64 // 32 bytes * 2 hex chars

describe('get_mediator_identity', () => {
  it('returns a non-empty hex pubkey of the correct Ed25519 length', async () => {
    const registry = new RoomRegistry({ role_label: 'test-mediator' })
    const result = await registry.handleTool('get_mediator_identity', {}) as { pubkey: string }

    expect(typeof result.pubkey).toBe('string')
    expect(result.pubkey.length).toBe(ED25519_PUBKEY_HEX_LENGTH)
    expect(/^[0-9a-f]+$/.test(result.pubkey)).toBe(true)
  })

  it('returns the same pubkey on repeated calls (cached keypair)', async () => {
    const registry = new RoomRegistry({ role_label: 'test-mediator' })

    const first = await registry.handleTool('get_mediator_identity', {}) as { pubkey: string }
    const second = await registry.handleTool('get_mediator_identity', {}) as { pubkey: string }

    expect(first.pubkey).toBe(second.pubkey)
  })

  it('two separate RoomRegistry instances return different pubkeys', async () => {
    const registryA = new RoomRegistry({ role_label: 'mediator-a' })
    const registryB = new RoomRegistry({ role_label: 'mediator-b' })

    const a = await registryA.handleTool('get_mediator_identity', {}) as { pubkey: string }
    const b = await registryB.handleTool('get_mediator_identity', {}) as { pubkey: string }

    expect(a.pubkey).not.toBe(b.pubkey)
  })

  it('concurrent calls on the same registry return the same pubkey (no double-keypair race)', async () => {
    const registry = new RoomRegistry({ role_label: 'test-mediator' })

    const [first, second, third] = await Promise.all([
      registry.handleTool('get_mediator_identity', {}) as Promise<{ pubkey: string }>,
      registry.handleTool('get_mediator_identity', {}) as Promise<{ pubkey: string }>,
      registry.handleTool('get_mediator_identity', {}) as Promise<{ pubkey: string }>,
    ])

    expect(first.pubkey).toBe(second.pubkey)
    expect(first.pubkey).toBe(third.pubkey)
  })
})
