import { describe, it, expect } from 'vitest'
import { encryptToRoomKey, decryptFromRoomKey } from '../../src/crypto/aead.js'

describe('AEAD (AES-256-GCM)', () => {
  it('round-trips plaintext', () => {
    const key = new Uint8Array(32).fill(7)
    const ct = encryptToRoomKey(key, 'hello world')
    expect(decryptFromRoomKey(key, ct)).toBe('hello world')
  })
  it('rejects ciphertext with wrong key', () => {
    const k1 = new Uint8Array(32).fill(1)
    const k2 = new Uint8Array(32).fill(2)
    const ct = encryptToRoomKey(k1, 'secret')
    expect(() => decryptFromRoomKey(k2, ct)).toThrow()
  })
  it('produces different ciphertext for same plaintext (random nonce)', () => {
    const key = new Uint8Array(32).fill(3)
    const a = encryptToRoomKey(key, 'msg')
    const b = encryptToRoomKey(key, 'msg')
    expect(a).not.toBe(b)
  })
})
