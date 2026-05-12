import * as ed25519 from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'
import type { SignaturePort, KeyPair, Pubkey, SignatureHex } from '@fairhandle/domain'

// @noble/ed25519 v2 requires SHA-512 setup for sync operation; async path also needs it on some Node versions.
ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m))

function toHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')
}
function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

export class Ed25519SignatureAdapter implements SignaturePort {
  async generateEphemeralKeyPair(): Promise<KeyPair> {
    const sk = ed25519.utils.randomPrivateKey()
    const pk = await ed25519.getPublicKeyAsync(sk)
    return {
      pubkey: toHex(pk) as Pubkey,
      private_handle: sk,
    }
  }

  async sign(message: string, key: KeyPair): Promise<SignatureHex> {
    const sk = key.private_handle as Uint8Array
    const sig = await ed25519.signAsync(new TextEncoder().encode(message), sk)
    return toHex(sig) as SignatureHex
  }

  async verify(message: string, signature: SignatureHex, pubkey: Pubkey): Promise<boolean> {
    try {
      return await ed25519.verifyAsync(fromHex(signature), new TextEncoder().encode(message), fromHex(pubkey))
    } catch {
      return false
    }
  }
}
