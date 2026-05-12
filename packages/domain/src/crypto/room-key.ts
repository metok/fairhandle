import {
  edwardsToMontgomeryPriv,
  edwardsToMontgomeryPub,
  x25519,
} from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'

function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

export interface DeriveRoomKeyInput {
  my_ed25519_private: Uint8Array
  their_ed25519_public_hex: string
  room_id: string
}

export async function deriveRoomKey(input: DeriveRoomKeyInput): Promise<Uint8Array> {
  // Convert Ed25519 keys to X25519 (Montgomery form) for ECDH.
  const myMonPriv = edwardsToMontgomeryPriv(input.my_ed25519_private)
  const theirMonPub = edwardsToMontgomeryPub(fromHex(input.their_ed25519_public_hex))
  const shared = x25519.getSharedSecret(myMonPriv, theirMonPub)
  return hkdf(
    sha256,
    shared,
    new TextEncoder().encode(input.room_id),
    new TextEncoder().encode('fairhandle/v1/room'),
    32,
  )
}
