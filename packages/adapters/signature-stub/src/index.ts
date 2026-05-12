import { randomUUID, createHash } from 'node:crypto'
import type {
  SignaturePort,
  KeyPair,
  Pubkey,
  SignatureHex,
} from '@fairhandle/domain'

/**
 * Deterministic, non-cryptographic stub signature for in-process tests.
 * Signature = sha256(privateSecret || message). Verify recomputes.
 * Pubkey carries the secret (since there's no real asymmetric crypto here).
 * DO NOT use outside tests.
 */
export class StubSignatureAdapter implements SignaturePort {
  async generateEphemeralKeyPair(): Promise<KeyPair> {
    const secret = randomUUID().replaceAll('-', '')
    return {
      pubkey: ('stub-pub-' + secret) as Pubkey,
      private_handle: secret,
    }
  }

  async sign(message: string, key: KeyPair): Promise<SignatureHex> {
    const secret = key.private_handle as string
    const h = createHash('sha256')
    h.update(secret)
    h.update(message)
    return h.digest('hex') as SignatureHex
  }

  async verify(
    message: string,
    signature: SignatureHex,
    pubkey: Pubkey,
  ): Promise<boolean> {
    const prefix = 'stub-pub-'
    if (!pubkey.startsWith(prefix)) return false
    const secret = pubkey.slice(prefix.length)
    const h = createHash('sha256')
    h.update(secret)
    h.update(message)
    return h.digest('hex') === signature
  }
}
