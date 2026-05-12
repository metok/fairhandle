import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import * as fs from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import * as git from 'isomorphic-git'
import type {
  ArtifactHistoryPort,
  CommitMetadata,
  CommitSummary,
  Artifact,
  HashHex,
} from '@fairhandle/domain'

export interface StorageGitConfig {
  /** Absolute path where the working repo lives. e.g. ~/.fairhandle/rooms/<room_id>/artifact.git */
  dir: string
}

export class StorageGitAdapter implements ArtifactHistoryPort {
  constructor(private readonly cfg: StorageGitConfig) {}

  async init(): Promise<void> {
    if (existsSync(join(this.cfg.dir, '.git'))) return
    mkdirSync(this.cfg.dir, { recursive: true })
    await git.init({ fs, dir: this.cfg.dir, defaultBranch: 'main' })
  }

  async commit(meta: CommitMetadata, artifact: Artifact): Promise<{ commit_hash: string }> {
    writeFileSync(join(this.cfg.dir, 'artifact.md'), artifact.markdown, 'utf8')
    writeFileSync(join(this.cfg.dir, 'overlay.json'), JSON.stringify(artifact.overlay, null, 2), 'utf8')
    await git.add({ fs, dir: this.cfg.dir, filepath: 'artifact.md' })
    await git.add({ fs, dir: this.cfg.dir, filepath: 'overlay.json' })
    const message =
      `Round ${meta.round_index} — ${truncateSubject(meta.changelog)}\n\n` +
      `${meta.changelog}\n\n` +
      `---\n` +
      `dyad-round: ${meta.round_index}\n` +
      `dyad-merkle-event: ${meta.merkle_event_hash}\n` +
      `dyad-canonical-from-peer: ${meta.canonical_peer_pubkey}\n` +
      `dyad-proposal-hashes: ${meta.proposal_hash_a} ${meta.proposal_hash_b}\n` +
      `Co-authored-by: ${meta.other_peer_label} <${shortPubkey(meta.other_peer_pubkey)}@dyad.fairhandle>\n`

    const author = {
      name: meta.canonical_peer_label,
      email: `${shortPubkey(meta.canonical_peer_pubkey)}@dyad.fairhandle`,
      timestamp: Math.floor(new Date(meta.timestamp_iso).getTime() / 1000),
      timezoneOffset: 0,
    }
    const commit_hash = await git.commit({
      fs,
      dir: this.cfg.dir,
      message,
      author,
      committer: author,
    })
    return { commit_hash }
  }

  async log(): Promise<CommitSummary[]> {
    const commits = await git.log({ fs, dir: this.cfg.dir })
    return commits.map((c) => {
      const subj = c.commit.message.split('\n')[0] ?? ''
      const merkleMatch = c.commit.message.match(/dyad-merkle-event:\s*(\S+)/)
      const roundMatch = c.commit.message.match(/dyad-round:\s*(\d+)/)
      return {
        commit_hash: c.oid,
        round_index: roundMatch ? parseInt(roundMatch[1]!, 10) : -1,
        merkle_event_hash: (merkleMatch?.[1] ?? '') as HashHex,
        message_subject: subj,
      }
    })
  }

  async diff(from_commit: string, to_commit: string): Promise<string> {
    const aBlob = await readBlobAtCommit(this.cfg.dir, from_commit, 'artifact.md')
    const bBlob = await readBlobAtCommit(this.cfg.dir, to_commit, 'artifact.md')
    return simpleUnifiedDiff(aBlob ?? '', bBlob ?? '')
  }

  async exportBundle(): Promise<Buffer> {
    const parent = dirname(this.cfg.dir)
    const dirName = basename(this.cfg.dir)
    const tarPath = join(parent, `${dirName}.tar`)
    execSync(`tar -C "${parent}" -cf "${tarPath}" "${dirName}"`)
    return readFileSync(tarPath)
  }

  async verifyTrailers(chainEventHashes: Set<HashHex>): Promise<{ ok: boolean; failing_commit?: string }> {
    const commits = await this.log()
    for (const c of commits) {
      if (!chainEventHashes.has(c.merkle_event_hash)) {
        return { ok: false, failing_commit: c.commit_hash }
      }
    }
    return { ok: true }
  }
}

function shortPubkey(pk: string): string {
  return pk.slice(0, 12)
}

function truncateSubject(s: string): string {
  const first = s.split('\n')[0]!
  return first.length > 60 ? first.slice(0, 57) + '...' : first
}

async function readBlobAtCommit(dir: string, oid: string, filepath: string): Promise<string | null> {
  try {
    const { blob } = await git.readBlob({ fs, dir, oid, filepath })
    return Buffer.from(blob).toString('utf8')
  } catch {
    return null
  }
}

function simpleUnifiedDiff(a: string, b: string): string {
  if (a === b) return ''
  return `--- previous\n+++ current\n@@\n-${a.replaceAll('\n', '\\n')}\n+${b.replaceAll('\n', '\\n')}\n`
}
