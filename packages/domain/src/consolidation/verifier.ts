import type { ConsolidatorOutput, LLMPort } from '../ports/llm.js'
import type { Message } from '../types/message.js'
import type { Artifact } from '../types/artifact.js'

export type VerifyOutcome = 'agreed' | 'disputed'

export interface VerifyResult {
  outcome: VerifyOutcome
  /** The peer whose artifact becomes canonical on agreement (tie-break = low node). */
  canonical_from_peer: 'A' | 'B'
  /** Populated when disputed: the material divergences between the two artifacts. */
  disagreement?: { divergences: string[] }
}

export interface ConsolidationVerifyInput {
  a: ConsolidatorOutput
  b: ConsolidatorOutput
  llm: LLMPort
  /** Peer with the lexicographically-lower NodeId; its artifact wins on agreement. */
  low_node_id: 'A' | 'B'
  transcript: Message[]
  previous_artifact: Artifact | null
}

/**
 * Bilateral consolidation check by *material equivalence*. Both peers
 * independently consolidated the round; this asks the LLM whether the two
 * artifacts capture materially the same agreed terms, open issues, and
 * contested points — ignoring wording, ordering, labels, and span offsets.
 * Equivalent artifacts merge (canonical = low node); divergent ones dispute.
 */
export async function verifyConsolidationAgreement(
  input: ConsolidationVerifyInput,
): Promise<VerifyResult> {
  const eq = await input.llm.verifyArtifactEquivalence({
    transcript_since_last_consolidation: input.transcript,
    previous_artifact: input.previous_artifact,
    artifact_a: input.a.artifact,
    artifact_b: input.b.artifact,
  })
  if (eq.equivalent) {
    return { outcome: 'agreed', canonical_from_peer: input.low_node_id }
  }
  return {
    outcome: 'disputed',
    canonical_from_peer: input.low_node_id,
    disagreement: { divergences: eq.divergences },
  }
}
