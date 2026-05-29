import { randomUUID } from 'node:crypto'
import { hashCanonical } from '@fairhandle/domain'
import type { RoomConfig, Pubkey } from '@fairhandle/domain'

export interface InviteCode {
  room_id: string
  initiator_pubkey: Pubkey
  config_hash: string
  host: string
  port: number
  mediator_pubkey: string | null
}

export function encodeInvite(code: InviteCode): string {
  const med = code.mediator_pubkey ?? ''
  return `fh1:${code.room_id}:${code.initiator_pubkey}:${code.config_hash}:${code.host}:${code.port}:${med}`
}

export function decodeInvite(s: string): InviteCode {
  if (!s.startsWith('fh1:')) throw new Error('not a fairhandle invite code')
  const parts = s.slice(4).split(':')
  if (parts.length !== 5 && parts.length !== 6) throw new Error('bad invite code structure')
  const rawMed = parts[5] ?? ''
  return {
    room_id: parts[0]!,
    initiator_pubkey: parts[1]! as Pubkey,
    config_hash: parts[2]!,
    host: parts[3]!,
    port: parseInt(parts[4]!, 10),
    mediator_pubkey: rawMed.length > 0 ? rawMed : null,
  }
}

export function newRoomId(): string {
  return randomUUID()
}

export function hashRoomConfig(c: RoomConfig): string {
  return hashCanonical(c)
}
