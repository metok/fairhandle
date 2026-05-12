import { describe, it, expect } from 'vitest'
import { canonicalize } from '../../src/crypto/jcs.js'

describe('canonicalize (RFC 8785 JCS, partial)', () => {
  it('sorts object keys', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })
  it('handles nested objects', () => {
    expect(canonicalize({ z: { b: 1, a: 2 }, a: 3 })).toBe(
      '{"a":3,"z":{"a":2,"b":1}}',
    )
  })
  it('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]')
  })
  it('escapes strings minimally per RFC 8785 §3.2.2.2', () => {
    expect(canonicalize({ s: 'hello "world"\n\t' })).toBe(
      '{"s":"hello \\"world\\"\\n\\t"}',
    )
  })
  it('handles unicode chars > 0x7f without escaping', () => {
    expect(canonicalize({ s: 'café' })).toBe('{"s":"café"}')
  })
  it('emits integers without trailing zero', () => {
    expect(canonicalize({ n: 1 })).toBe('{"n":1}')
  })
  it('emits floats with no trailing zeros', () => {
    expect(canonicalize({ n: 1.5 })).toBe('{"n":1.5}')
  })
  it('rejects non-finite numbers', () => {
    expect(() => canonicalize({ n: NaN })).toThrow(/finite/)
    expect(() => canonicalize({ n: Infinity })).toThrow(/finite/)
  })
  it('encodes null', () => {
    expect(canonicalize({ x: null })).toBe('{"x":null}')
  })
  it('encodes booleans', () => {
    expect(canonicalize({ t: true, f: false })).toBe('{"f":false,"t":true}')
  })
})

describe('canonicalize (RFC 8785 strict examples)', () => {
  it('handles RFC 8785 §3.2.4 example 1: arrays', () => {
    expect(canonicalize([56, '999'])).toBe('[56,"999"]')
  })
  it('preserves key-by-key sorting with utf-16 code-unit order', () => {
    // 'é' (U+00E9) sorts AFTER 'z' (U+007A) by UTF-16
    expect(canonicalize({ z: 1, é: 2 })).toBe('{"z":1,"é":2}')
  })
  it('handles deeply nested objects', () => {
    expect(canonicalize({ a: { c: { e: 1, d: 2 }, b: 3 } })).toBe('{"a":{"b":3,"c":{"d":2,"e":1}}}')
  })
  it('does NOT escape forward slash', () => {
    expect(canonicalize({ url: 'a/b' })).toBe('{"url":"a/b"}')
  })
  it('encodes 0 as 0, not as 0.0', () => {
    expect(canonicalize({ n: 0 })).toBe('{"n":0}')
  })
  it('encodes -0 as 0', () => {
    expect(canonicalize({ n: -0 })).toBe('{"n":0}')
  })
  it('uses lowercase e in scientific notation when needed', () => {
    // ECMA-262 ToString uses lowercase 'e'. RFC 8785 §3.2.2.3 inherits this.
    expect(canonicalize({ n: 1e21 })).toBe('{"n":1e+21}')
  })
})
