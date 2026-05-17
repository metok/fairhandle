import { describe, it, expect } from 'vitest'
import { verifyConsolidationAgreement } from '../../src/consolidation/verifier.js'
import type { ConsolidatorOutput, Artifact } from '../../src/index.js'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'

function artifact(md: string): Artifact {
  return { markdown: md, version: 1, overlay: [], open_issues: [], changelog: 'x' }
}
function out(md: string): ConsolidatorOutput {
  return { artifact: artifact(md), open_issues: [], changelog: 'x' }
}

describe('verifyConsolidationAgreement', () => {
  it('agrees when the LLM judges the two artifacts materially equivalent', async () => {
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
      artifactEquivalence: { equivalent: true, divergences: [] },
    })
    const r = await verifyConsolidationAgreement({
      a: out('Fee: 800 EUR.'),
      b: out('The agreed fee is eight hundred euros.'),
      llm,
      low_node_id: 'A',
      transcript: [],
      previous_artifact: null,
    })
    expect(r.outcome).toBe('agreed')
    expect(r.canonical_from_peer).toBe('A')
  })

  it('disputes when the LLM judges the artifacts materially divergent', async () => {
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true },
      artifactEquivalence: { equivalent: false, divergences: ['fee: A says 800, B says 600'] },
    })
    const r = await verifyConsolidationAgreement({
      a: out('Fee: 800 EUR.'),
      b: out('Fee: 600 EUR.'),
      llm,
      low_node_id: 'A',
      transcript: [],
      previous_artifact: null,
    })
    expect(r.outcome).toBe('disputed')
    expect(r.disagreement?.divergences).toEqual(['fee: A says 800, B says 600'])
  })
})
