import { config as dotenvConfig } from 'dotenv'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import Anthropic from '@anthropic-ai/sdk'
import { bakeryScenario } from './scenarios/bakery.js'
import { runScenarioOnce } from './harness.js'
import type { EvalReport, GradedRun } from './scenario.js'

dotenvConfig({ path: resolve(homedir(), '.fairhandle', '.env') })

function formatRunLine(g: GradedRun): string {
  const tag = g.passed ? 'PASS' : 'FAIL'
  const secs = (g.duration_ms / 1000).toFixed(1)
  if (g.error) return `[${tag}] error: ${g.error} (${secs}s)`
  const overlap = g.within_overlap === null ? 'n/a' : String(g.within_overlap)
  return `[${tag}] outcome=${g.outcome} rounds=${g.rounds} heads_match=${g.heads_match} overlap=${overlap} (${secs}s)`
}

function printSummary(report: EvalReport): void {
  console.log('')
  console.log('='.repeat(60))
  console.log(`scenario:   ${report.scenario_id}`)
  console.log(`runs:       ${report.total}`)
  console.log(`passed:     ${report.pass_count}`)
  console.log(`pass rate:  ${(report.pass_rate * 100).toFixed(0)}%`)
  const deals = report.runs.filter((r) => r.outcome === 'deal').length
  const walks = report.runs.filter((r) => r.outcome === 'walk_away').length
  const deadlocks = report.runs.filter((r) => r.outcome === 'deadlock').length
  const incomplete = report.total - deals - walks - deadlocks
  console.log(
    `outcomes:   ${deals} deal / ${walks} walk-away / ${deadlocks} deadlock / ${incomplete} incomplete`,
  )
  for (const r of report.runs) {
    if (r.grader_notes) console.log(`  run ${r.run_index + 1}: ${r.grader_notes}`)
  }
  console.log('='.repeat(60))
}

async function main(): Promise<void> {
  const runs = parseInt(process.env.EVAL_RUNS ?? process.argv[2] ?? '3', 10)
  const agentModel = process.env.EVAL_AGENT_MODEL ?? 'claude-haiku-4-5'
  const graderModel = process.env.EVAL_GRADER_MODEL ?? 'claude-haiku-4-5'
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    console.error('ANTHROPIC_API_KEY not set — put it in ~/.fairhandle/.env')
    process.exit(1)
  }
  const anthropic = new Anthropic({ apiKey: key })
  const scenario = bakeryScenario

  console.log(`fairhandle eval — scenario "${scenario.id}" — ${runs} run(s) — agent model: ${agentModel}`)
  console.log(scenario.title)
  console.log('')

  const results: GradedRun[] = []
  for (let i = 0; i < runs; i++) {
    process.stdout.write(`run ${i + 1}/${runs} ... `)
    const g = await runScenarioOnce({ scenario, runIndex: i, anthropic, agentModel, graderModel })
    results.push(g)
    console.log(formatRunLine(g))
  }

  const pass_count = results.filter((r) => r.passed).length
  const report: EvalReport = {
    scenario_id: scenario.id,
    runs: results,
    pass_count,
    total: runs,
    pass_rate: runs === 0 ? 0 : pass_count / runs,
  }
  printSummary(report)
  process.exit(pass_count === runs ? 0 : 1)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
