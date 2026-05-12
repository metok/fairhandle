import { describe, it, expect } from 'vitest'
import { verifyStructuralAgreement } from '../../src/consolidation/verifier.js'
import type { ConsolidatorOutput, Artifact } from '../../src/index.js'
import { ScriptedLLMAdapter } from '@fairhandle/llm-stub'

function artifact(overlay: { clause_type: string; status: 'agreed' | 'open' | 'contested' }[], openIssues: string[] = [], md = 'doc'): Artifact {
  return {
    markdown: md,
    version: 1,
    overlay: overlay.map((o, i) => ({
      span: { start: i * 10, end: i * 10 + 5 },
      clause_type: o.clause_type,
      status: o.status,
      criticality_default: 'low',
      last_changed_at_version: 1,
    })),
    open_issues: openIssues,
    changelog: 'x',
  }
}

function out(art: Artifact): ConsolidatorOutput {
  return { artifact: art, open_issues: art.open_issues, changelog: 'x' }
}

describe('verifyStructuralAgreement', () => {
  it('agrees when clause types and statuses match', async () => {
    const llm = new ScriptedLLMAdapter({ consolidatorOutputs: [], verifierAlways: { equivalent: true } })
    const a = out(artifact([{ clause_type: 'payment', status: 'agreed' }]))
    const b = out(artifact([{ clause_type: 'payment', status: 'agreed' }]))
    const r = await verifyStructuralAgreement({ a, b, llm, low_node_id: 'A' })
    expect(r.outcome).toBe('agreed')
    expect(r.canonical_from_peer).toBe('A')
  })
  it('disagrees when clause sets differ', async () => {
    const llm = new ScriptedLLMAdapter({ consolidatorOutputs: [], verifierAlways: { equivalent: true } })
    const a = out(artifact([{ clause_type: 'payment', status: 'agreed' }]))
    const b = out(artifact([{ clause_type: 'payment', status: 'agreed' }, { clause_type: 'ip', status: 'open' }]))
    const r = await verifyStructuralAgreement({ a, b, llm, low_node_id: 'A' })
    expect(r.outcome).toBe('disputed')
  })
  it('disagrees when status differs', async () => {
    const llm = new ScriptedLLMAdapter({ consolidatorOutputs: [], verifierAlways: { equivalent: true } })
    const a = out(artifact([{ clause_type: 'payment', status: 'agreed' }]))
    const b = out(artifact([{ clause_type: 'payment', status: 'contested' }]))
    const r = await verifyStructuralAgreement({ a, b, llm, low_node_id: 'A' })
    expect(r.outcome).toBe('disputed')
  })
  it('disagrees when open_issues differ', async () => {
    const llm = new ScriptedLLMAdapter({ consolidatorOutputs: [], verifierAlways: { equivalent: true } })
    const a = out(artifact([], ['a']))
    const b = out(artifact([], ['b']))
    const r = await verifyStructuralAgreement({ a, b, llm, low_node_id: 'A' })
    expect(r.outcome).toBe('disputed')
  })
  it('disagrees when verifier says agreed clauses are not equivalent', async () => {
    const llm = new ScriptedLLMAdapter({ consolidatorOutputs: [], verifierAlways: { equivalent: false } })
    const a = out(artifact([{ clause_type: 'payment', status: 'agreed' }], [], 'A'))
    const b = out(artifact([{ clause_type: 'payment', status: 'agreed' }], [], 'B'))
    const r = await verifyStructuralAgreement({ a, b, llm, low_node_id: 'A' })
    expect(r.outcome).toBe('disputed')
  })
})
