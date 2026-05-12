import { createWriteStream } from 'node:fs'
import archiver from 'archiver'
import { writeFile, mkdtemp, copyFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface ExportInput {
  chain_json_path: string
  artifact_git_dir: string
  pubkeys: Record<string, string>
  output_zip_path: string
}

export async function exportBundle(input: ExportInput): Promise<void> {
  const stagingDir = await mkdtemp(join(tmpdir(), 'fh-export-'))
  await writeFile(join(stagingDir, 'pubkeys.json'), JSON.stringify(input.pubkeys, null, 2))
  await writeFile(
    join(stagingDir, 'verify.sh'),
    `#!/bin/sh\nexec npx -y -p @fairhandle/verifier fairhandle verify "$(dirname "$0")"\n`,
  )
  await copyFile(input.chain_json_path, join(stagingDir, 'chain.json'))
  await cp(input.artifact_git_dir, join(stagingDir, 'artifact.git'), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(input.output_zip_path)
    const arc = archiver('zip', { zlib: { level: 9 } })
    out.on('close', () => resolve())
    arc.on('error', reject)
    arc.pipe(out)
    arc.directory(stagingDir, false)
    void arc.finalize()
  })
}
