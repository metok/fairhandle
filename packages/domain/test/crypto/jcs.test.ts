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
