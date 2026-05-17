import type Anthropic from '@anthropic-ai/sdk'
import type { Scenario, RunOutcome, GradedRun } from './scenario.js'

export interface RoomStateLike {
  state: string
  current_round: number
  head_hash: string | null
  hard_limit_hit: string | null
  walk_away_by: string | null
  artifact: { markdown: string } | null
}

function isTerminal(state: string): boolean {
  return state === 'closed' || state === 'closing'
}

/** Classify the run outcome from a peer's final room state. */
function classifyOutcome(s: RoomStateLike): RunOutcome {
  if (s.walk_away_by !== null) return 'walk_away'
  if (s.hard_limit_hit !== null) return 'deadlock'
  if (isTerminal(s.state) && s.current_round >= 1) return 'deal'
  return 'incomplete'
}

/** LLM grader: does the final artifact settle every term inside the overlap zone? */
async function gradeOverlap(
  anthropic: Anthropic,
  model: string,
  artifactMarkdown: string,
  overlapSpec: string,
): Promise<{ within_overlap: boolean; notes: string }> {
  const prompt = [
    'You are grading the outcome of a two-party negotiation.',
    '',
    'Final agreed document:',
    '---',
    artifactMarkdown || '(empty)',
    '---',
    '',
    'Acceptable settlement zone:',
    overlapSpec,
    '',
    'Did the parties settle EVERY term, and is every settled term inside the acceptable',
    'zone? If any term is unsettled, contested, or outside the zone, answer false.',
    'Return ONLY a JSON object: {"within_overlap": true|false, "notes": "<one sentence>"}',
  ].join('\n')

  const resp = await anthropic.messages.create({
    model,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return { within_overlap: false, notes: 'grader returned no JSON' }
  try {
    const parsed = JSON.parse(match[0]) as { within_overlap?: boolean; notes?: string }
    return { within_overlap: parsed.within_overlap === true, notes: parsed.notes ?? '' }
  } catch {
    return { within_overlap: false, notes: 'grader JSON parse failed' }
  }
}

export interface GradeInput {
  runIndex: number
  scenario: Scenario
  stateA: RoomStateLike
  stateB: RoomStateLike
  anthropic: Anthropic
  graderModel: string
  durationMs: number
  error?: string | null
}

export async function gradeRun(input: GradeInput): Promise<GradedRun> {
  const { scenario, stateA, stateB } = input
  const reached_closure = isTerminal(stateA.state) && isTerminal(stateB.state)
  const heads_match = stateA.head_hash !== null && stateA.head_hash === stateB.head_hash
  const outcome = classifyOutcome(stateA)
  const rounds = stateA.current_round

  let within_overlap: boolean | null = null
  let grader_notes = ''
  if (scenario.expected.outcome === 'deal' && outcome === 'deal') {
    const g = await gradeOverlap(
      input.anthropic,
      input.graderModel,
      stateA.artifact?.markdown ?? '',
      scenario.expected.overlapSpec,
    )
    within_overlap = g.within_overlap
    grader_notes = g.notes
  }

  const passed =
    input.error == null &&
    reached_closure &&
    heads_match &&
    outcome === scenario.expected.outcome &&
    (scenario.expected.outcome !== 'deal' || within_overlap === true)

  return {
    run_index: input.runIndex,
    reached_closure,
    outcome,
    heads_match,
    rounds,
    within_overlap,
    grader_notes,
    passed,
    error: input.error ?? null,
    duration_ms: input.durationMs,
  }
}

export { classifyOutcome, isTerminal }
