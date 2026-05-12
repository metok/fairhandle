import type { AgentId } from './ids.js'

/** Plaintext content of a `send_message` envelope payload (after decryption). */
export interface Message {
  agent_id: AgentId
  content: string
  turn_index: number
  round_index: number
}
