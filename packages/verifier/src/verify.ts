import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Ed25519SignatureAdapter } from '@fairhandle/signature-ed25519'
import { StorageGitAdapter } from '@fairhandle/storage-git'
import { hashCanonical, chainEventHash, sha256Hex } from '@fairhandle/domain'
import type { Event, HashHex, Envelope, Pubkey, SignatureHex } from '@fairhandle/domain'

export interface VerifyReport {
  ok: boolean
  errors: string[]
  warnings: string[]
  summary: {
    events: number
    rounds: number
    final_artifact_signed: boolean
  }
}

interface ChainFile {
  room_id: string
  events: Event[]
}

interface PubkeysFile {
  [role_or_agent: string]: string
}

export async function verifyBundle(bundleDir: string): Promise<VerifyReport> {
  const errors: string[] = []
  const warnings: string[] = []

  const chainPath = join(bundleDir, 'chain.json')
  const chain = JSON.parse(readFileSync(chainPath, 'utf8')) as ChainFile

  // 1. Chain integrity (hash linkage, payload hashes).
  for (let i = 0; i < chain.events.length; i++) {
    const e = chain.events[i]!
    const expectedPrev = i === 0 ? sha256Hex(chain.room_id) : chain.events[i - 1]!.hash
    if (e.prev_hash !== expectedPrev) errors.push(`event ${i}: prev_hash mismatch`)
    const expectedPayloadHash = hashCanonical(e.payload)
    if (e.payload_hash !== expectedPayloadHash) errors.push(`event ${i}: payload_hash mismatch`)
    const expectedHash = chainEventHash(e.prev_hash, e.payload_hash)
    if (e.hash !== expectedHash) errors.push(`event ${i}: hash mismatch`)
  }

  // 2. Optional signature verification — if pubkeys.json is present, check sigs.
  const pubkeysPath = join(bundleDir, 'pubkeys.json')
  if (existsSync(pubkeysPath)) {
    const pubkeys = JSON.parse(readFileSync(pubkeysPath, 'utf8')) as PubkeysFile
    const sig = new Ed25519SignatureAdapter()
    const pubkeyByAgentId = new Map<string, string>()
    // First pass: index join_room envelopes to learn role_label → agent_id.
    for (const e of chain.events) {
      if (e.payload.type === 'join_room') {
        const role = (e.payload.payload as { type: 'join_room'; role_label: string }).role_label
        const pk = pubkeys[role] ?? pubkeys[e.payload.agent_id]
        if (pk) pubkeyByAgentId.set(e.payload.agent_id, pk)
      }
    }
    for (const e of chain.events) {
      const env = e.payload
      const pk = pubkeyByAgentId.get(env.agent_id)
      if (!pk) {
        warnings.push(`event ${e.index}: no pubkey known for agent ${env.agent_id}; signature check skipped`)
        continue
      }
      const sigOK = await sig.verify(
        JSON.stringify(envelopeWithoutSig(env)),
        env.signature as SignatureHex,
        pk as Pubkey,
      )
      if (!sigOK) errors.push(`event ${e.index}: bad signature on ${env.type}`)
    }
  } else {
    warnings.push('pubkeys.json not found; signature verification skipped')
  }

  // 3. Git trailers reference real chain event hashes.
  const gitDir = join(bundleDir, 'artifact.git')
  if (existsSync(join(gitDir, '.git'))) {
    const g = new StorageGitAdapter({ dir: gitDir })
    const chainHashes = new Set(chain.events.map((e) => e.hash))
    const tr = await g.verifyTrailers(chainHashes)
    if (!tr.ok) errors.push(`git commit ${tr.failing_commit ?? '<unknown>'} trailer does not match any chain event`)
  } else {
    warnings.push('artifact.git not found; git projection check skipped')
  }

  const rounds = chain.events.filter((e) => e.payload.type === 'consolidation_merge').length
  const final_artifact_signed = chain.events.some((e) => e.payload.type === 'final_artifact_sign')

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: { events: chain.events.length, rounds, final_artifact_signed },
  }
}

function envelopeWithoutSig(env: Envelope): Omit<Envelope, 'signature'> {
  const { signature: _signature, ...rest } = env
  void _signature
  return rest
}
