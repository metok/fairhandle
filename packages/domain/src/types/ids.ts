export type RoomId = string & { readonly __brand: 'RoomId' }
export type AgentId = string & { readonly __brand: 'AgentId' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isRoomId(value: unknown): value is RoomId {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function asRoomId(value: string): RoomId {
  if (!isRoomId(value)) throw new Error(`not a valid RoomId: ${value}`)
  return value
}

export function asAgentId(value: string): AgentId {
  if (!isAgentId(value)) throw new Error(`not a valid AgentId: ${value}`)
  return value
}

export type RoomState =
  | 'created'
  | 'waiting'
  | 'active'
  | 'consolidating'
  | 'closing'
  | 'closed'

export type Pubkey = string & { readonly __brand: 'Pubkey' }
export type SignatureHex = string & { readonly __brand: 'SignatureHex' }
export type HashHex = string & { readonly __brand: 'HashHex' }
