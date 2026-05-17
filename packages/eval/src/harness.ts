import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Anthropic from '@anthropic-ai/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { runAgent } from './agent.js'
import { gradeRun, type RoomStateLike } from './graders.js'
import type { Scenario, GradedRun } from './scenario.js'

const here = dirname(fileURLToPath(import.meta.url))
const MCP_BIN = resolve(here, '..', '..', 'mcp-server', 'bin', 'fairhandle-mcp')

function randomPort(): number {
  return 17000 + Math.floor(Math.random() * 2000)
}

function textOf(result: unknown): string {
  const content = (result as { content?: unknown }).content
  const blocks = (content as Array<{ type: string; text?: string }> | undefined) ?? []
  return blocks.map((b) => b.text ?? '').join('')
}

async function getState(mcp: Client, roomId: string): Promise<RoomStateLike> {
  const r = await mcp.callTool({ name: 'get_room_state', arguments: { room_id: roomId } })
  return JSON.parse(textOf(r)) as RoomStateLike
}

async function waitForActive(mcp: Client, roomId: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  for (;;) {
    const s = await getState(mcp, roomId)
    if (s.state === 'active' || s.state === 'consolidating') return
    if (Date.now() - start > timeoutMs) throw new Error(`room never became active (state=${s.state})`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

export interface RunScenarioOptions {
  scenario: Scenario
  runIndex: number
  anthropic: Anthropic
  agentModel: string
  graderModel: string
}

/** Run one full negotiation: spawn two MCP servers, hand off, drive both agents, grade. */
export async function runScenarioOnce(opts: RunScenarioOptions): Promise<GradedRun> {
  const { scenario, runIndex, anthropic, agentModel, graderModel } = opts
  const start = Date.now()
  const portA = randomPort()
  const portB = portA + 1

  const transportA = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    env: { ...process.env, FH_ROLE_LABEL: 'PeerA', FH_HTTP_PORT: String(portA) } as Record<string, string>,
  })
  const transportB = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    env: { ...process.env, FH_ROLE_LABEL: 'PeerB', FH_HTTP_PORT: String(portB) } as Record<string, string>,
  })
  const clientA = new Client({ name: 'eval-a', version: '0' }, { capabilities: {} })
  const clientB = new Client({ name: 'eval-b', version: '0' }, { capabilities: {} })

  let error: string | null = null
  let stateA: RoomStateLike | null = null
  let stateB: RoomStateLike | null = null

  try {
    await clientA.connect(transportA)
    await clientB.connect(transportB)

    // Handshake: Alice creates the room, Bob joins with the invite.
    const created = await clientA.callTool({
      name: 'create_room',
      arguments: { role_label: 'Alice' },
    })
    const { room_id, invite_code } = JSON.parse(textOf(created)) as {
      room_id: string
      invite_code: string
    }
    await clientB.callTool({
      name: 'join_room',
      arguments: { invite_code, role_label: 'Bob' },
    })
    await waitForActive(clientA, room_id)

    // Drive both negotiating agents concurrently.
    await Promise.all([
      runAgent({ anthropic, model: agentModel, mcp: clientA, system: scenario.briefA, roomId: room_id }),
      runAgent({ anthropic, model: agentModel, mcp: clientB, system: scenario.briefB, roomId: room_id }),
    ])

    stateA = await getState(clientA, room_id)
    stateB = await getState(clientB, room_id)
  } catch (e) {
    error = (e as Error).message
  } finally {
    await clientA.close().catch(() => {})
    await clientB.close().catch(() => {})
  }

  const fallback: RoomStateLike = {
    state: 'unknown',
    current_round: 0,
    head_hash: null,
    hard_limit_hit: null,
    walk_away_by: null,
    artifact: null,
  }
  return gradeRun({
    runIndex,
    scenario,
    stateA: stateA ?? fallback,
    stateB: stateB ?? fallback,
    anthropic,
    graderModel,
    durationMs: Date.now() - start,
    error,
  })
}
