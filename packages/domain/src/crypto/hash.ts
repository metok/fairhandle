import { createHash } from 'node:crypto'
import { canonicalize } from './jcs.js'
import type { HashHex } from '../types/ids.js'

export function sha256Hex(input: string | Uint8Array): HashHex {
  const h = createHash('sha256')
  h.update(input)
  return h.digest('hex') as HashHex
}

export function hashCanonical(value: unknown): HashHex {
  return sha256Hex(canonicalize(value))
}

export function chainEventHash(prev: HashHex, payloadHash: HashHex): HashHex {
  return sha256Hex(prev + payloadHash)
}
