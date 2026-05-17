/** A scenario fixture: two briefs plus the expected outcome the graders check against. */
export interface Scenario {
  /** Stable identifier, used in the report. */
  id: string
  /** Human-readable one-liner. */
  title: string
  /** System prompt for the agent playing peer A (the room initiator). */
  briefA: string
  /** System prompt for the agent playing peer B (the joiner). */
  briefB: string
  /** What a correct run should produce. */
  expected: {
    /** 'deal' = consolidation merged + propose/accept done; 'walk_away' = a peer left. */
    outcome: 'deal' | 'walk_away'
    /**
     * Plain-language description of the acceptable settlement zone, handed to the
     * LLM grader to judge whether a reached deal is actually within bounds.
     * Only consulted when expected.outcome === 'deal'.
     */
    overlapSpec: string
  }
}

export type RunOutcome = 'deal' | 'walk_away' | 'deadlock' | 'incomplete'

export interface GradedRun {
  run_index: number
  reached_closure: boolean
  outcome: RunOutcome
  heads_match: boolean
  rounds: number
  /** LLM-graded: did the settlement land inside the scenario's overlap zone? */
  within_overlap: boolean | null
  grader_notes: string
  /** True when the run matches the scenario's expected outcome and all checks pass. */
  passed: boolean
  error: string | null
  duration_ms: number
}

export interface EvalReport {
  scenario_id: string
  runs: GradedRun[]
  pass_count: number
  total: number
  pass_rate: number
}
