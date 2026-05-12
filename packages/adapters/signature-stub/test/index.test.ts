import { describe, it, expect } from 'vitest'
import { StubSignatureAdapter } from '../src/index.js'

describe('StubSignatureAdapter', () => {
  it('signs and verifies', async () => {
    const sig = new StubSignatureAdapter()
    const kp = await sig.generateEphemeralKeyPair()
    const s = await sig.sign('hello', kp)
    expect(await sig.verify('hello', s, kp.pubkey)).toBe(true)
  })
  it('rejects tampered messages', async () => {
    const sig = new StubSignatureAdapter()
    const kp = await sig.generateEphemeralKeyPair()
    const s = await sig.sign('hello', kp)
    expect(await sig.verify('goodbye', s, kp.pubkey)).toBe(false)
  })
  it('rejects signatures from a different key', async () => {
    const sig = new StubSignatureAdapter()
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    const s = await sig.sign('hello', a)
    expect(await sig.verify('hello', s, b.pubkey)).toBe(false)
  })
})
