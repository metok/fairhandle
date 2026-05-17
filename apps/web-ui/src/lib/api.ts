// Shapes match the MCP server's HTTP responses (packages/mcp-server/src/room-registry.ts).

export type RoomState =
  | 'created'
  | 'waiting'
  | 'active'
  | 'consolidating'
  | 'paused'
  | 'closing'
  | 'closed'

export type ClauseStatus = 'agreed' | 'open' | 'contested'

export interface ClauseRegion {
  span: { start: number; end: number }
  clause_type: string
  status: ClauseStatus
  criticality_default: 'low' | 'medium' | 'high'
  last_changed_at_version: number
}

export interface Artifact {
  markdown: string
  version: number
  overlay: ClauseRegion[]
  open_issues: string[]
  changelog: string
}

export interface RoomStateResponse {
  state: RoomState
  current_turn_index: number
  current_round: number
  participants: Array<{ agent_id: string; role_label: string; pubkey: string }>
  artifact: Artifact | null
  head_hash: string | null
  consecutive_disputes: number
  hard_limit_hit: null | 'turn_cap' | 'time_cap' | 'deadlock'
  walk_away_by: string | null
  my_role_label: string
  my_idx: 0 | 1
}

export interface RoomSummary {
  room_id: string
  state: RoomState
  role_label: string
}

export interface TranscriptEntry {
  agent_id: string
  content: string
  turn_index: number
  round_index: number
}

export interface ChainEvent {
  index: number
  prev_hash: string
  payload_hash: string
  hash: string
  appended_at: string
  payload: { type: string; agent_id: string }
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`)
  return r.json() as Promise<T>
}

export function fetchRooms(base = ''): Promise<{ rooms: RoomSummary[] }> {
  return getJson(`${base}/api/rooms`)
}

export function fetchRoomState(roomId: string, base = ''): Promise<RoomStateResponse> {
  return getJson(`${base}/api/rooms/${roomId}/state`)
}

export function fetchTranscript(roomId: string, base = ''): Promise<TranscriptEntry[]> {
  return getJson(`${base}/api/rooms/${roomId}/transcript`)
}

export function fetchChain(roomId: string, base = ''): Promise<{ room_id: string; events: ChainEvent[] }> {
  return getJson(`${base}/api/rooms/${roomId}/chain`)
}
