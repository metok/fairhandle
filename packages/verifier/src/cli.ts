#!/usr/bin/env node
import { Command } from 'commander'
import { resolve } from 'node:path'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import extract from 'extract-zip'
import { verifyBundle } from './verify.js'

const program = new Command()

program
  .name('fairhandle')
  .description('fairhandle verification + bundle tools')
  .version('0.0.0')

program
  .command('verify <bundle>')
  .description('Verify a fairhandle export bundle (.zip or directory)')
  .action(async (bundle: string) => {
    const path = resolve(bundle)
    let dir = path
    if (path.endsWith('.zip')) {
      dir = mkdtempSync(resolve(tmpdir(), 'fh-verify-'))
      await extract(path, { dir })
    }
    if (!existsSync(resolve(dir, 'chain.json'))) {
      console.error('error: chain.json missing')
      process.exit(1)
    }
    const report = await verifyBundle(dir)
    if (report.ok) {
      console.log(`OK — ${report.summary.events} events, ${report.summary.rounds} rounds, signed=${String(report.summary.final_artifact_signed)}`)
      for (const w of report.warnings) console.warn(`warn: ${w}`)
      process.exit(0)
    }
    console.error('FAIL')
    for (const e of report.errors) console.error(`  ${e}`)
    for (const w of report.warnings) console.warn(`  warn: ${w}`)
    process.exit(1)
  })

program
  .command('export')
  .description('Bundle a closed room into a self-contained .zip')
  .requiredOption('--chain <path>', 'chain.json path')
  .requiredOption('--git <path>', 'artifact.git directory')
  .requiredOption('--pubkeys <path>', 'JSON file mapping role -> pubkey hex')
  .requiredOption('--out <path>', 'output .zip path')
  .action(async (opts: { chain: string; git: string; pubkeys: string; out: string }) => {
    const { exportBundle } = await import('./export.js')
    const pubkeys = JSON.parse(readFileSync(opts.pubkeys, 'utf8')) as Record<string, string>
    await exportBundle({
      chain_json_path: opts.chain,
      artifact_git_dir: opts.git,
      pubkeys,
      output_zip_path: opts.out,
    })
    console.log('wrote', opts.out)
  })

program.parseAsync().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
