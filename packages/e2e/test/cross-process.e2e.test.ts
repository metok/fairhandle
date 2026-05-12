import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const enabled = process.env.RUN_REAL_LLM === '1'

describe.skipIf(!enabled)('E2E cross-process (real LLM, real transport)', () => {
  it('two peers complete a 1-round negotiation over WebSocket', async () => {
    const roomId = randomUUID()
    const port = 17000 + Math.floor(Math.random() * 1000)
    const here = dirname(fileURLToPath(import.meta.url))
    const runner = resolve(here, '..', 'src', 'peer-runner.ts')

    function spawnPeer(role: 'A' | 'B', messages: string[]) {
      return spawn('npx', ['tsx', runner], {
        env: {
          ...process.env,
          FH_ROLE: role,
          FH_ROOM: roomId,
          FH_PORT: String(port),
          FH_MESSAGES: JSON.stringify(messages),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }

    const peerA = spawnPeer('A', ['I propose 30-day net payment terms.'])
    // Give A a moment to start listening
    await new Promise((r) => setTimeout(r, 500))
    const peerB = spawnPeer('B', ['Agreed on 30-day net. Anything else?'])

    let aOut = ''; let bOut = ''
    peerA.stdout.on('data', (d: Buffer) => { aOut += d.toString() })
    peerB.stdout.on('data', (d: Buffer) => { bOut += d.toString() })
    peerA.stderr.on('data', (d: Buffer) => process.stderr.write(`[A] ${d}`))
    peerB.stderr.on('data', (d: Buffer) => process.stderr.write(`[B] ${d}`))

    const codes = await Promise.all([
      new Promise<number>((res) => peerA.on('exit', (c) => res(c ?? 1))),
      new Promise<number>((res) => peerB.on('exit', (c) => res(c ?? 1))),
    ])
    expect(codes).toEqual([0, 0])

    const lastLineA = aOut.trim().split('\n').at(-1)!
    const lastLineB = bOut.trim().split('\n').at(-1)!
    const a = JSON.parse(lastLineA) as { status: string; head: string }
    const b = JSON.parse(lastLineB) as { status: string; head: string }
    expect(a.status).toBe('done')
    expect(b.status).toBe('done')
    expect(a.head).toBe(b.head)
  }, 180_000)
})
