import { describe, it, expect } from 'vitest'
import { runRoundConsolidation } from '../../src/consolidation/orchestrator.js'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'
import type { Message } from '../../src/index.js'

const ROUND_TRANSCRIPT: Message[] = [
  { agent_id: 'a' as never, content: 'hello', turn_index: 0, round_index: 0 },
  { agent_id: 'b' as never, content: 'hi back', turn_index: 1, round_index: 0 },
]

describe('runRoundConsolidation', () => {
  it('calls the LLM and returns its output', async () => {
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [
        {
          artifact: { markdown: 'agreed', version: 1, overlay: [], open_issues: [], changelog: 'change' },
          open_issues: [],
          changelog: 'change',
        },
      ],
      verifierAlways: { equivalent: true },
    })
    const out = await runRoundConsolidation({
      llm,
      room_config: {} as never,
      previous_artifact: null,
      transcript_since_last_consolidation: ROUND_TRANSCRIPT,
    })
    expect(out.artifact.markdown).toBe('agreed')
    expect(out.artifact.version).toBe(1)
  })
})
