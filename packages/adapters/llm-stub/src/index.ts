import type {
  LLMPort,
  ConsolidatorInput,
  ConsolidatorOutput,
  VerifierInput,
  VerifierOutput,
  ArtifactEquivalenceInput,
  ArtifactEquivalenceOutput,
} from '@fairhandle/domain'

export interface ScriptedLLMConfig {
  consolidatorOutputs: ConsolidatorOutput[]
  verifierAlways: VerifierOutput
  /** Verdict returned by verifyArtifactEquivalence. Defaults to equivalent. */
  artifactEquivalence?: ArtifactEquivalenceOutput
}

export class ScriptedLLMAdapter implements LLMPort {
  private idx = 0
  constructor(private readonly cfg: ScriptedLLMConfig) {}

  async runConsolidator(_input: ConsolidatorInput): Promise<ConsolidatorOutput> {
    if (this.idx >= this.cfg.consolidatorOutputs.length) {
      throw new Error('ScriptedLLMAdapter: consolidator script exhausted')
    }
    const out = this.cfg.consolidatorOutputs[this.idx++]!
    return structuredClone(out)
  }

  async runVerifier(_input: VerifierInput): Promise<VerifierOutput> {
    return structuredClone(this.cfg.verifierAlways)
  }

  async verifyArtifactEquivalence(
    _input: ArtifactEquivalenceInput,
  ): Promise<ArtifactEquivalenceOutput> {
    return structuredClone(this.cfg.artifactEquivalence ?? { equivalent: true, divergences: [] })
  }
}
