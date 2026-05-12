import type { Pubkey, SignatureHex } from '../types/ids.js'

export interface KeyPair {
  pubkey: Pubkey
  /** Opaque private-key handle; never serialize. */
  private_handle: unknown
}

export interface SignaturePort {
  generateEphemeralKeyPair(): Promise<KeyPair>
  sign(message: string, key: KeyPair): Promise<SignatureHex>
  verify(message: string, signature: SignatureHex, pubkey: Pubkey): Promise<boolean>
}
