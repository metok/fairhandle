import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { Ed25519SignatureAdapter } from '@fairhandle/signature-ed25519'
import type { KeyPair, Pubkey } from '@fairhandle/domain'

export interface IdentityStore {
  /** Load the long-lived identity key, or generate + persist on first call. */
  loadOrCreateLongLivedKey(label: string): Promise<KeyPair>
  /** Generate (and persist) a fresh ephemeral per-room keypair. */
  generateEphemeralRoomKey(room_id: string): Promise<KeyPair>
  getEphemeralRoomKey(room_id: string): Promise<KeyPair | null>
}

export class FileIdentityStore implements IdentityStore {
  private sig = new Ed25519SignatureAdapter()
  private base: string

  constructor(baseDir?: string) {
    this.base = baseDir ?? resolve(homedir(), '.fairhandle', 'keys')
    mkdirSync(this.base, { recursive: true, mode: 0o700 })
  }

  async loadOrCreateLongLivedKey(label: string): Promise<KeyPair> {
    const path = join(this.base, `agent-${label}.json`)
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf8')) as { pubkey: string; private_hex: string }
      return { pubkey: data.pubkey as Pubkey, private_handle: Buffer.from(data.private_hex, 'hex') }
    }
    const kp = await this.sig.generateEphemeralKeyPair()
    const sk = kp.private_handle as Uint8Array
    writeFileSync(path, JSON.stringify({ pubkey: kp.pubkey, private_hex: Buffer.from(sk).toString('hex') }), 'utf8')
    chmodSync(path, 0o600)
    return kp
  }

  async generateEphemeralRoomKey(room_id: string): Promise<KeyPair> {
    const kp = await this.sig.generateEphemeralKeyPair()
    const sk = kp.private_handle as Uint8Array
    const path = join(this.base, `ephem-${room_id}.json`)
    writeFileSync(path, JSON.stringify({ pubkey: kp.pubkey, private_hex: Buffer.from(sk).toString('hex') }), 'utf8')
    chmodSync(path, 0o600)
    return kp
  }

  async getEphemeralRoomKey(room_id: string): Promise<KeyPair | null> {
    const path = join(this.base, `ephem-${room_id}.json`)
    if (!existsSync(path)) return null
    const data = JSON.parse(readFileSync(path, 'utf8')) as { pubkey: string; private_hex: string }
    return { pubkey: data.pubkey as Pubkey, private_handle: Buffer.from(data.private_hex, 'hex') }
  }
}
