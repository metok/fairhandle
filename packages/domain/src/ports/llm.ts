import type { Artifact } from '../types/artifact.js'
import type { Message } from '../types/message.js'
import type { RoomConfig } from '../types/config.js'

export interface ConsolidatorInput {
  room_config: RoomConfig
  previous_artifact: Artifact | null
  transcript_since_last_consolidation: Message[]
}

export interface ConsolidatorOutput {
  artifact: Artifact
  open_issues: string[]
  changelog: string
}

export interface VerifierInput {
  clause_a_text: string
  clause_b_text: string
}

export interface VerifierOutput {
  equivalent: boolean
}

export interface LLMPort {
  /** Run the consolidator on a transcript delta. */
  runConsolidator(input: ConsolidatorInput): Promise<ConsolidatorOutput>
  /** Check semantic equivalence of two agreed-clause prose blobs. */
  runVerifier(input: VerifierInput): Promise<VerifierOutput>
}
