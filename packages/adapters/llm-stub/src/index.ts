import type {
  LLMPort,
  ConsolidatorInput,
  ConsolidatorOutput,
  VerifierInput,
  VerifierOutput,
  ArtifactEquivalenceInput,
  ArtifactEquivalenceOutput,
  AuditConsolidationInput,
  AuditConsolidationOutput,
} from '@fairhandle/domain'

export interface ScriptedLLMConfig {
  consolidatorOutputs: ConsolidatorOutput[]
  verifierAlways: VerifierOutput
  /**
   * Verdict returned by verifyArtifactEquivalence. A single value is used for
   * every call; an array is consumed per call (the last entry repeats once
   * exhausted). Defaults to equivalent.
   */
  artifactEquivalence?: ArtifactEquivalenceOutput | ArtifactEquivalenceOutput[]
  /**
   * Verdict returned by auditConsolidation. A single value is used for every
   * call; an array is consumed per call (the last entry repeats once
   * exhausted). Defaults to {faithful: true, issues: []}.
   */
  auditConsolidation?: AuditConsolidationOutput | AuditConsolidationOutput[]
}

export class ScriptedLLMAdapter implements LLMPort {
  private idx = 0
  private eqIdx = 0
  private auditIdx = 0
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
    const cfg = this.cfg.artifactEquivalence
    const fallback: ArtifactEquivalenceOutput = { equivalent: true, divergences: [] }
    if (Array.isArray(cfg)) {
      const v = cfg.length === 0 ? fallback : cfg[Math.min(this.eqIdx, cfg.length - 1)]!
      this.eqIdx++
      return structuredClone(v)
    }
    return structuredClone(cfg ?? fallback)
  }

  async auditConsolidation(
    _input: AuditConsolidationInput,
  ): Promise<AuditConsolidationOutput> {
    const cfg = this.cfg.auditConsolidation
    const fallback: AuditConsolidationOutput = { faithful: true, issues: [] }
    if (Array.isArray(cfg)) {
      const v = cfg.length === 0 ? fallback : cfg[Math.min(this.auditIdx, cfg.length - 1)]!
      this.auditIdx++
      return structuredClone(v)
    }
    return structuredClone(cfg ?? fallback)
  }
}
