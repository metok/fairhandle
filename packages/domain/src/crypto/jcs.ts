/**
 * Minimal RFC 8785 JCS canonicalization.
 * Covers the JSON subset we actually emit (no exotic number forms,
 * no BigInt, no Date). Numbers must be finite; strings are escaped
 * per RFC 8785 §3.2.2.2. Object keys are sorted lexicographically by
 * their UTF-16 code units (which matches JavaScript's default sort).
 *
 * NOT a fully-spec-conformant JCS implementation — sufficient for
 * Plan 1's domain hashing. Plan 3 may swap for a vetted library.
 */
export function canonicalize(value: unknown): string {
  return encode(value)
}

function encode(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('jcs: numbers must be finite')
    return numberToCanonical(v)
  }
  if (typeof v === 'string') return encodeString(v)
  if (Array.isArray(v)) return '[' + v.map(encode).join(',') + ']'
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return (
      '{' +
      keys.map((k) => encodeString(k) + ':' + encode(obj[k])).join(',') +
      '}'
    )
  }
  throw new Error(`jcs: unsupported type: ${typeof v}`)
}

function numberToCanonical(n: number): string {
  // RFC 8785 §3.2.2.3: integers and floats use ECMAScript ToString
  // semantics, which is what Number.prototype.toString does by default.
  return Number.prototype.toString.call(n)
}

const ESCAPES: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
}

function encodeString(s: string): string {
  let out = '"'
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (ch in ESCAPES) {
      out += ESCAPES[ch]
    } else if (code < 0x20) {
      out += '\\u' + code.toString(16).padStart(4, '0')
    } else {
      out += ch
    }
  }
  return out + '"'
}
