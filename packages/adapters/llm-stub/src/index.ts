import type {
  LLMPort,
  ConsolidatorInput,
  ConsolidatorOutput,
  VerifierInput,
  VerifierOutput,
} from '@fairhandle/domain'

export interface ScriptedLLMConfig {
  consolidatorOutputs: ConsolidatorOutput[]
  verifierAlways: VerifierOutput
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
}
