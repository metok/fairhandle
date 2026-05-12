import { describe, it, expect } from 'vitest'
import { deriveRoomKey } from '../../src/crypto/room-key.js'
import { Ed25519SignatureAdapter } from '@fairhandle/signature-ed25519'

describe('deriveRoomKey', () => {
  it('produces a 32-byte symmetric key', async () => {
    const sig = new Ed25519SignatureAdapter()
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    const room = '99999999-9999-4999-8999-999999999999'
    const k = await deriveRoomKey({
      my_ed25519_private: a.private_handle as Uint8Array,
      their_ed25519_public_hex: b.pubkey,
      room_id: room,
    })
    expect(k.length).toBe(32)
  })
  it('both peers derive the same key', async () => {
    const sig = new Ed25519SignatureAdapter()
    const a = await sig.generateEphemeralKeyPair()
    const b = await sig.generateEphemeralKeyPair()
    const room = '88888888-7777-4666-8555-444444444444'
    const ka = await deriveRoomKey({
      my_ed25519_private: a.private_handle as Uint8Array,
      their_ed25519_public_hex: b.pubkey,
      room_id: room,
    })
    const kb = await deriveRoomKey({
      my_ed25519_private: b.private_handle as Uint8Array,
      their_ed25519_public_hex: a.pubkey,
      room_id: room,
    })
    expect(Buffer.from(ka).toString('hex')).toBe(Buffer.from(kb).toString('hex'))
  })
})
