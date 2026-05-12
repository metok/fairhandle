import { describe, it, expect } from 'vitest'
import { Ed25519SignatureAdapter } from '../src/index.js'

describe('Ed25519SignatureAdapter', () => {
  it('produces a 128-char hex signature', async () => {
    const sig = new Ed25519SignatureAdapter()
    const kp = await sig.generateEphemeralKeyPair()
    const s = await sig.sign('hello world', kp)
    expect(s.length).toBe(128)
    expect(s).toMatch(/^[0-9a-f]{128}$/)
  })
  it('verifies correctly', async () => {
    const sig = new Ed25519SignatureAdapter()
    const kp = await sig.generateEphemeralKeyPair()
    const s = await sig.sign('hello world', kp)
    expect(await sig.verify('hello world', s, kp.pubkey)).toBe(true)
  })
  it('rejects tampered messages', async () => {
    const sig = new Ed25519SignatureAdapter()
    const kp = await sig.generateEphemeralKeyPair()
    const s = await sig.sign('hello world', kp)
    expect(await sig.verify('goodbye', s, kp.pubkey)).toBe(false)
  })
  it('rejects signatures from a different key', async () => {
    const sig = new Ed25519SignatureAdapter()
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    const s = await sig.sign('hello', a)
    expect(await sig.verify('hello', s, b.pubkey)).toBe(false)
  })
  it('produces a 64-char hex pubkey', async () => {
    const sig = new Ed25519SignatureAdapter()
    const kp = await sig.generateEphemeralKeyPair()
    expect(kp.pubkey.length).toBe(64)
    expect(kp.pubkey).toMatch(/^[0-9a-f]{64}$/)
  })
})
