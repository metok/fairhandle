import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StorageGitAdapter } from '../src/index.js'
import type { CommitMetadata, Artifact } from '@fairhandle/domain'

let tmp: string
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

function meta(round: number): CommitMetadata {
  return {
    round_index: round,
    canonical_peer_pubkey: ('aa'.repeat(32)) as never,
    other_peer_pubkey: ('bb'.repeat(32)) as never,
    canonical_peer_label: 'Alice',
    other_peer_label: 'Bob',
    merkle_event_hash: ('cc'.repeat(32)) as never,
    proposal_hash_a: ('dd'.repeat(32)) as never,
    proposal_hash_b: ('ee'.repeat(32)) as never,
    changelog: 'agreed on payment terms',
    timestamp_iso: '2026-05-12T00:00:00Z',
  }
}

function artifact(v: number): Artifact {
  return { markdown: '# Round ' + v, version: v, overlay: [], open_issues: [], changelog: 'r' + v }
}

describe('StorageGitAdapter', () => {
  it('initializes and commits deterministically', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'fh-git-'))
    const g = new StorageGitAdapter({ dir: join(tmp, 'artifact.git') })
    await g.init()
    const r1 = await g.commit(meta(1), artifact(1))
    const r2 = await g.commit(meta(2), artifact(2))
    expect(r1.commit_hash).not.toBe(r2.commit_hash)
    const log = await g.log()
    expect(log.length).toBe(2)
    expect(log[0]!.round_index).toBe(2) // most recent first
  })
})
