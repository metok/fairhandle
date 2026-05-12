import type { Envelope } from '../types/envelope.js'
import type { Event } from '../types/event.js'
import type { RoomId, HashHex } from '../types/ids.js'
import { hashCanonical, chainEventHash, sha256Hex } from '../crypto/hash.js'

export interface LogVerifyResult {
  ok: boolean
  failed_at_index?: number
  reason?: string
}

export class MerkleLog {
  private readonly events: Event[] = []
  constructor(private readonly room: RoomId) {}

  get length(): number {
    return this.events.length
  }

  getHead(): Event | null {
    if (this.events.length === 0) return null
    return this.events[this.events.length - 1]!
  }

  getHeadHash(): HashHex | null {
    return this.getHead()?.hash ?? null
  }

  getEvents(): readonly Event[] {
    return this.events
  }

  append(envelope: Envelope, appendedAtIso: string): Event {
    const index = this.events.length
    const prev_hash = index === 0
      ? sha256Hex(this.room)
      : this.events[index - 1]!.hash
    const payload_hash = hashCanonical(envelope)
    const hash = chainEventHash(prev_hash, payload_hash)
    const event: Event = {
      index,
      prev_hash,
      payload: envelope,
      payload_hash,
      hash,
      appended_at: appendedAtIso,
    }
    this.events.push(event)
    return event
  }

  verifyIntegrity(): LogVerifyResult {
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i]!
      const expectedPrev = i === 0 ? sha256Hex(this.room) : this.events[i - 1]!.hash
      if (e.prev_hash !== expectedPrev) {
        return { ok: false, failed_at_index: i, reason: 'prev_hash mismatch' }
      }
      const expectedPayloadHash = hashCanonical(e.payload)
      if (e.payload_hash !== expectedPayloadHash) {
        return { ok: false, failed_at_index: i, reason: 'payload_hash mismatch' }
      }
      const expectedHash = chainEventHash(e.prev_hash, e.payload_hash)
      if (e.hash !== expectedHash) {
        return { ok: false, failed_at_index: i, reason: 'hash mismatch' }
      }
    }
    return { ok: true }
  }
}
