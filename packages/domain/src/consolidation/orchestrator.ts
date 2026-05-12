import type {
  LLMPort,
  ConsolidatorOutput,
  ConsolidatorInput,
} from '../ports/llm.js'
import type { Artifact } from '../types/artifact.js'
import type { Message } from '../types/message.js'
import type { RoomConfig } from '../types/config.js'

export interface RunConsolidationInput {
  llm: LLMPort
  room_config: RoomConfig
  previous_artifact: Artifact | null
  transcript_since_last_consolidation: Message[]
}

export async function runRoundConsolidation(
  input: RunConsolidationInput,
): Promise<ConsolidatorOutput> {
  const llmInput: ConsolidatorInput = {
    room_config: input.room_config,
    previous_artifact: input.previous_artifact,
    transcript_since_last_consolidation: input.transcript_since_last_consolidation,
  }
  return input.llm.runConsolidator(llmInput)
}
