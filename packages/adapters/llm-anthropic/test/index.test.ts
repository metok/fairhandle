import { describe, it, expect } from 'vitest'
import { AnthropicLLMAdapter } from '../src/index.js'

const enabled = process.env.RUN_REAL_LLM === '1'

describe.skipIf(!enabled)('AnthropicLLMAdapter (real)', () => {
  it('consolidates a tiny transcript', async () => {
    const llm = new AnthropicLLMAdapter()
    const out = await llm.runConsolidator({
      room_config: { turn_cap: 50, time_cap_ms: 60_000, deadlock_policy: 'best_effort', opening_artifact: null, expected_peer_pubkey: null },
      previous_artifact: null,
      transcript_since_last_consolidation: [
        { agent_id: 'a' as never, content: 'I propose 30-day net payment terms.', turn_index: 0, round_index: 0 },
        { agent_id: 'b' as never, content: 'Agreed on 30 days. I also want to add a 5% early-payment discount.', turn_index: 1, round_index: 0 },
      ],
    })
    expect(out.artifact.markdown).toMatch(/30/i)
    expect(out.artifact.overlay.length).toBeGreaterThan(0)
  }, 60000)
})
