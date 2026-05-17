import Anthropic from '@anthropic-ai/sdk'
import { config as dotenvConfig } from 'dotenv'
import { resolve as pathResolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type {
  LLMPort,
  ConsolidatorInput,
  ConsolidatorOutput,
  VerifierInput,
  VerifierOutput,
  ArtifactEquivalenceInput,
  ArtifactEquivalenceOutput,
} from '@fairhandle/domain'

dotenvConfig({ path: pathResolve(homedir(), '.fairhandle', '.env') })

export interface AnthropicLLMConfig {
  /** Defaults to env ANTHROPIC_API_KEY. */
  api_key?: string
  /** Model name. Default: claude-haiku-4-5. */
  model?: string
  /** Path to the consolidator prompt file. Default: spec/consolidator-prompt-v1.md. */
  prompt_path?: string
}

const DEFAULT_PROMPT_V1 = `# Consolidator System Prompt v1

You are the neutral scribe of a two-party negotiation between two AI agents acting on behalf of two human principals. You DO NOT negotiate. You DO NOT advocate for either side. You DO NOT inject opinions or preferences.

Your sole task: read the public conversation between Agent-A and Agent-B since the last consolidation, and produce an updated draft document that faithfully reflects what they have agreed to and clearly marks what they have not.

## Rules

1. If both agents have explicitly agreed to a clause, include it in markdown and tag the region with status: agreed.
2. If they have proposed different versions of the same clause, pick the most recent proposal and tag the region status: contested. Add a clear note in the markdown like "[CONTESTED: A proposes 30 days, B proposes 14 days]".
3. If a topic was raised but not resolved, tag the region status: open and surface it in open_issues.
4. Preserve previously-agreed text from previous_artifact.markdown unless explicitly changed by both parties.
5. Tag clause types using snake_case labels (e.g., payment_terms, ip_assignment, confidentiality, term_length).
6. Set criticality_default to high for money/IP/liability/exclusivity/termination clauses; medium for scope/timelines; low otherwise.
7. Output changelog as a concise summary.
8. Never invent terms not present in the transcript or previous artifact.
9. If transcript is empty, produce a minimal skeleton.

## Output schema

Return ONLY a JSON object with exactly this shape:

{
  "artifact": {
    "markdown": "<canonical document>",
    "version": <integer>,
    "overlay": [
      {
        "span": { "start": <int>, "end": <int> },
        "clause_type": "<snake_case_label>",
        "status": "agreed" | "open" | "contested",
        "criticality_default": "low" | "medium" | "high",
        "last_changed_at_version": <int>
      }
    ],
    "open_issues": ["<short issue>"],
    "changelog": "<one-paragraph summary>"
  },
  "open_issues": ["<same as artifact.open_issues>"],
  "changelog": "<same as artifact.changelog>"
}

span.start and span.end are character offsets into artifact.markdown. Compute precisely so markdown.slice(start, end) recovers the clause text.

Return ONLY the JSON object. No commentary, no preamble, no markdown code fences.`

function loadDefaultPrompt(): string {
  // Try to find spec/consolidator-prompt-v1.md relative to this source file.
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const candidate = pathResolve(here, '..', '..', '..', '..', 'spec', 'consolidator-prompt-v1.md')
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8')
  } catch {
    // fall through to inline default
  }
  return DEFAULT_PROMPT_V1
}

export class AnthropicLLMAdapter implements LLMPort {
  private client: Anthropic
  private model: string
  private system_prompt: string

  constructor(cfg: AnthropicLLMConfig = {}) {
    const key = cfg.api_key ?? process.env.ANTHROPIC_API_KEY
    if (!key) throw new Error('ANTHROPIC_API_KEY not set (check ~/.fairhandle/.env)')
    this.client = new Anthropic({ apiKey: key })
    this.model = cfg.model ?? 'claude-haiku-4-5'
    this.system_prompt = cfg.prompt_path
      ? readFileSync(cfg.prompt_path, 'utf8')
      : loadDefaultPrompt()
  }

  async runConsolidator(input: ConsolidatorInput): Promise<ConsolidatorOutput> {
    const user = [
      'Previous artifact:',
      input.previous_artifact ? JSON.stringify(input.previous_artifact) : '<none — first round>',
      '',
      'Transcript since last consolidation:',
      ...input.transcript_since_last_consolidation.map((m) =>
        `[turn ${m.turn_index}, agent ${m.agent_id}]: ${m.content}`,
      ),
      '',
      'Produce the updated artifact per the schema in your system prompt.',
    ].join('\n')

    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: this.system_prompt,
      messages: [{ role: 'user', content: user }],
    })

    const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    let parsed: ConsolidatorOutput
    try {
      parsed = JSON.parse(text)
    } catch {
      // Last-resort: try to extract a JSON block.
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('consolidator did not return parseable JSON: ' + text.slice(0, 200))
      parsed = JSON.parse(match[0])
    }
    return parsed
  }

  async runVerifier(input: VerifierInput): Promise<VerifierOutput> {
    const prompt = `Compare these two clause texts. Return JSON {"equivalent": true|false} indicating whether they say substantially the same thing in spirit and material content. Do not be pedantic about whitespace or word order.\n\nClause A:\n${input.clause_a_text}\n\nClause B:\n${input.clause_b_text}\n\nReturn ONLY the JSON.`
    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const match = text.match(/\{[\s\S]*?\}/)
    if (!match) return { equivalent: false }
    try {
      const parsed = JSON.parse(match[0]) as { equivalent?: boolean }
      return { equivalent: !!parsed.equivalent }
    } catch {
      return { equivalent: false }
    }
  }

  async verifyArtifactEquivalence(
    input: ArtifactEquivalenceInput,
  ): Promise<ArtifactEquivalenceOutput> {
    const describe = (label: string, a: ArtifactEquivalenceInput['artifact_a']): string =>
      [
        `=== Draft ${label} ===`,
        a.markdown,
        `open_issues: ${JSON.stringify(a.open_issues)}`,
        `clauses: ${JSON.stringify(a.overlay.map((c) => ({ type: c.clause_type, status: c.status })))}`,
      ].join('\n')

    const prompt = [
      'Two AI scribes independently consolidated the SAME negotiation round into',
      'draft documents A and B. Ignore ALL differences of wording, formatting,',
      'clause ordering, section labels, and character offsets. Judge ONLY whether',
      'A and B capture materially the same agreed terms, the same open issues, and',
      'the same contested points. Two drafts that record the same deal in different',
      'prose are equivalent.',
      '',
      describe('A', input.artifact_a),
      '',
      describe('B', input.artifact_b),
      '',
      'Return ONLY JSON: {"equivalent": true|false, "divergences": ["<material difference>", ...]}',
    ].join('\n')

    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return { equivalent: false, divergences: ['grader returned no JSON'] }
    try {
      const parsed = JSON.parse(match[0]) as { equivalent?: boolean; divergences?: string[] }
      return {
        equivalent: parsed.equivalent === true,
        divergences: Array.isArray(parsed.divergences) ? parsed.divergences : [],
      }
    } catch {
      return { equivalent: false, divergences: ['grader JSON parse failed'] }
    }
  }
}
