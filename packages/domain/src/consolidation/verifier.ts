import type { ConsolidatorOutput, LLMPort } from '../ports/llm.js'

export interface VerifyInput {
  a: ConsolidatorOutput
  b: ConsolidatorOutput
  llm: LLMPort
  /** Identifier of the peer with the lexicographically-lower NodeId; used for tie-breaking. */
  low_node_id: 'A' | 'B'
}

export type VerifyOutcome = 'agreed' | 'disputed'

export interface VerifyResult {
  outcome: VerifyOutcome
  canonical_from_peer: 'A' | 'B'
  /** Populated when disputed; structured diff. */
  disagreement?: {
    missing_in_b: string[]
    missing_in_a: string[]
    status_diffs: { clause_type: string; a_status: string; b_status: string }[]
    semantic_diffs: { clause_type: string }[]
    open_issues_only_in_a: string[]
    open_issues_only_in_b: string[]
  }
}

export async function verifyStructuralAgreement(input: VerifyInput): Promise<VerifyResult> {
  const aClauses = new Map(input.a.artifact.overlay.map((c) => [c.clause_type, c]))
  const bClauses = new Map(input.b.artifact.overlay.map((c) => [c.clause_type, c]))

  const aSet = new Set(aClauses.keys())
  const bSet = new Set(bClauses.keys())
  const missing_in_b = [...aSet].filter((k) => !bSet.has(k))
  const missing_in_a = [...bSet].filter((k) => !aSet.has(k))

  const status_diffs: { clause_type: string; a_status: string; b_status: string }[] = []
  for (const k of aSet) {
    if (!bSet.has(k)) continue
    const ac = aClauses.get(k)!
    const bc = bClauses.get(k)!
    if (ac.status !== bc.status) status_diffs.push({ clause_type: k, a_status: ac.status, b_status: bc.status })
  }

  // Semantic equivalence for agreed clauses.
  const semantic_diffs: { clause_type: string }[] = []
  for (const k of aSet) {
    if (!bSet.has(k)) continue
    const ac = aClauses.get(k)!
    const bc = bClauses.get(k)!
    if (ac.status !== 'agreed' || bc.status !== 'agreed') continue
    const aText = input.a.artifact.markdown.slice(ac.span.start, ac.span.end)
    const bText = input.b.artifact.markdown.slice(bc.span.start, bc.span.end)
    const v = await input.llm.runVerifier({ clause_a_text: aText, clause_b_text: bText })
    if (!v.equivalent) semantic_diffs.push({ clause_type: k })
  }

  const aIssues = new Set(input.a.open_issues)
  const bIssues = new Set(input.b.open_issues)
  const open_issues_only_in_a = [...aIssues].filter((s) => !bIssues.has(s))
  const open_issues_only_in_b = [...bIssues].filter((s) => !aIssues.has(s))

  const disagreed =
    missing_in_a.length > 0 ||
    missing_in_b.length > 0 ||
    status_diffs.length > 0 ||
    semantic_diffs.length > 0 ||
    open_issues_only_in_a.length > 0 ||
    open_issues_only_in_b.length > 0

  if (disagreed) {
    return {
      outcome: 'disputed',
      canonical_from_peer: input.low_node_id,
      disagreement: {
        missing_in_a,
        missing_in_b,
        status_diffs,
        semantic_diffs,
        open_issues_only_in_a,
        open_issues_only_in_b,
      },
    }
  }
  return { outcome: 'agreed', canonical_from_peer: input.low_node_id }
}
