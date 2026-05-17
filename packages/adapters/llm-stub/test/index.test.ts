import { describe, it, expect } from 'vitest'
import { ScriptedLLMAdapter } from '../src/index.js'
import type { ConsolidatorOutput, VerifierOutput } from '@fairhandle/domain'

describe('ScriptedLLMAdapter — auditConsolidation', () => {
  it('defaults to faithful with no issues', async () => {
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true } as VerifierOutput,
    })
    expect(await llm.auditConsolidation({} as never)).toEqual({
      faithful: true,
      issues: [],
    })
  })
  it('returns a single configured verdict for every call', async () => {
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true } as VerifierOutput,
      auditConsolidation: { faithful: false, issues: ['biased toward A'] },
    })
    expect(await llm.auditConsolidation({} as never)).toEqual({
      faithful: false,
      issues: ['biased toward A'],
    })
    expect(await llm.auditConsolidation({} as never)).toEqual({
      faithful: false,
      issues: ['biased toward A'],
    })
  })
  it('consumes an array per-call and repeats the last entry once exhausted', async () => {
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true } as VerifierOutput,
      auditConsolidation: [
        { faithful: true, issues: [] },
        { faithful: false, issues: ['omission'] },
      ],
    })
    expect(await llm.auditConsolidation({} as never)).toEqual({ faithful: true, issues: [] })
    expect(await llm.auditConsolidation({} as never)).toEqual({ faithful: false, issues: ['omission'] })
    // exhausted — last entry repeats
    expect(await llm.auditConsolidation({} as never)).toEqual({ faithful: false, issues: ['omission'] })
  })
})

function makeOutput(version: number): ConsolidatorOutput {
  return {
    artifact: {
      markdown: 'Round ' + version,
      version,
      overlay: [],
      open_issues: [],
      changelog: 'change ' + version,
    },
    open_issues: [],
    changelog: 'change ' + version,
  }
}

describe('ScriptedLLMAdapter', () => {
  it('returns consolidator outputs in sequence', async () => {
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [makeOutput(1), makeOutput(2)],
      verifierAlways: { equivalent: true } as VerifierOutput,
    })
    const a = await llm.runConsolidator({} as never)
    const b = await llm.runConsolidator({} as never)
    expect(a.artifact.version).toBe(1)
    expect(b.artifact.version).toBe(2)
  })
  it('throws when the script is exhausted', async () => {
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [makeOutput(1)],
      verifierAlways: { equivalent: true } as VerifierOutput,
    })
    await llm.runConsolidator({} as never)
    await expect(llm.runConsolidator({} as never)).rejects.toThrow(/exhausted/)
  })
  it('returns the canned verifier result', async () => {
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: false } as VerifierOutput,
    })
    expect(await llm.runVerifier({ clause_a_text: 'x', clause_b_text: 'y' })).toEqual({ equivalent: false })
  })
  it('defaults artifact equivalence to equivalent', async () => {
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true } as VerifierOutput,
    })
    expect(await llm.verifyArtifactEquivalence({} as never)).toEqual({
      equivalent: true,
      divergences: [],
    })
  })
  it('returns the scripted artifact-equivalence verdict', async () => {
    const llm = new ScriptedLLMAdapter({
      consolidatorOutputs: [],
      verifierAlways: { equivalent: true } as VerifierOutput,
      artifactEquivalence: { equivalent: false, divergences: ['fee differs'] },
    })
    expect(await llm.verifyArtifactEquivalence({} as never)).toEqual({
      equivalent: false,
      divergences: ['fee differs'],
    })
  })
})
