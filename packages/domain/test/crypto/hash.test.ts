import { describe, it, expect } from 'vitest'
import { sha256Hex, hashCanonical } from '../../src/crypto/hash.js'

describe('sha256Hex', () => {
  it('matches a known vector for "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('hashCanonical', () => {
  it('produces stable hashes regardless of key order', () => {
    const a = hashCanonical({ x: 1, y: 2 })
    const b = hashCanonical({ y: 2, x: 1 })
    expect(a).toBe(b)
  })
  it('differs between different content', () => {
    const a = hashCanonical({ x: 1 })
    const b = hashCanonical({ x: 2 })
    expect(a).not.toBe(b)
  })
})
