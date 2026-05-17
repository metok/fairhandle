/* eslint-disable no-console */
import { config as dotenvConfig } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { runAgent } from './agent.js'
import { bakeryScenario } from './scenarios/bakery.js'

dotenvConfig({ path: resolve(homedir(), '.fairhandle', '.env') })

const here = dirname(fileURLToPath(import.meta.url))
const MCP_BIN = resolve(here, '..', '..', 'mcp-server', 'bin', 'fairhandle-mcp')

interface TranscriptEntry {
  agent_id: string
  content: string
  turn_index: number
  round_index: number
}
interface ChainEvent {
  index: number
  hash: string
  payload: { type: string }
}
interface State {
  state: string
  current_round: number
  head_hash: string | null
  hard_limit_hit: string | null
  walk_away_by: string | null
  participants: Array<{ agent_id: string; role_label: string }>
  artifact: {
    markdown: string
    version: number
    overlay: Array<{ clause_type: string; status: string }>
    changelog: string
  } | null
}

function textOf(r: unknown): string {
  const c = (r as { content?: unknown }).content
  const blocks = (c as Array<{ text?: string }> | undefined) ?? []
  return blocks.map((b) => b.text ?? '').join('')
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

const line = () => console.log('-'.repeat(64))

async function main(): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    console.error('ANTHROPIC_API_KEY not set — put it in ~/.fairhandle/.env')
    process.exit(1)
  }
  const model = process.env.DEMO_AGENT_MODEL ?? 'claude-haiku-4-5'
  const anthropic = new Anthropic({ apiKey: key })
  const scenario = bakeryScenario
  const portA = 18200 + Math.floor(Math.random() * 600)
  const portB = portA + 1
  const baseA = `http://127.0.0.1:${portA}`

  console.log('')
  line()
  console.log('  fairhandle — live negotiation demo')
  console.log(`  scenario: ${scenario.title}`)
  console.log(`  agents:   ${model} (one per peer)`)
  line()

  const mk = (role: string, port: number) =>
    new StdioClientTransport({
      command: process.execPath,
      args: [MCP_BIN],
      env: { ...process.env, FH_ROLE_LABEL: role, FH_HTTP_PORT: String(port) } as Record<string, string>,
    })
  const clientA = new Client({ name: 'demo-a', version: '0' }, { capabilities: {} })
  const clientB = new Client({ name: 'demo-b', version: '0' }, { capabilities: {} })
  await clientA.connect(mk('PeerA', portA))
  await clientB.connect(mk('PeerB', portB))
  console.log('  two MCP servers spawned (real Ed25519 keys, WebSocket transport, SQLite chain)')

  const created = await clientA.callTool({ name: 'create_room', arguments: { role_label: 'Alice' } })
  const { room_id, invite_code } = JSON.parse(textOf(created)) as { room_id: string; invite_code: string }
  console.log(`  Alice created room ${room_id.slice(0, 18)}…`)
  console.log(`  invite: ${invite_code.slice(0, 52)}…`)
  await clientB.callTool({ name: 'join_room', arguments: { invite_code, role_label: 'Bob' } })
  console.log('  Bob joined. Room is active.')
  line()
  console.log('  NEGOTIATION (live)')
  line()

  // Live feed: poll the HTTP endpoint for new transcript lines + chain events.
  let seenMsgs = 0
  let seenEvents = 0
  let roleByAgent = new Map<string, string>()
  const poll = setInterval(() => {
    void (async () => {
      const st = await getJson<State>(`${baseA}/api/rooms/${room_id}/state`)
      if (st) roleByAgent = new Map(st.participants.map((p) => [p.agent_id, p.role_label]))
      const tr = await getJson<TranscriptEntry[]>(`${baseA}/api/rooms/${room_id}/transcript`)
      if (tr) {
        for (const m of tr.slice(seenMsgs)) {
          const who = roleByAgent.get(m.agent_id) ?? m.agent_id.slice(0, 6)
          console.log(`  [round ${m.round_index + 1}] ${who}:`)
          for (const ln of m.content.split('\n')) console.log(`      ${ln}`)
        }
        seenMsgs = Math.max(seenMsgs, tr.length)
      }
      const ch = await getJson<{ events: ChainEvent[] }>(`${baseA}/api/rooms/${room_id}/chain`)
      if (ch) {
        for (const e of ch.events.slice(seenEvents)) {
          if (e.payload.type === 'consolidation_merge') {
            console.log('  >> consolidation MERGED — both peers agreed on the round draft')
          } else if (e.payload.type === 'consolidation_dispute') {
            console.log('  >> consolidation DISPUTED — peers produced divergent drafts')
          } else if (e.payload.type === 'propose_done') {
            console.log('  >> propose_done')
          } else if (e.payload.type === 'accept_done') {
            console.log('  >> accept_done — room closing')
          } else if (e.payload.type === 'leave_room') {
            console.log('  >> leave_room — a peer walked away')
          }
        }
        seenEvents = Math.max(seenEvents, ch.events.length)
      }
    })()
  }, 1000)

  await Promise.all([
    runAgent({ anthropic, model, mcp: clientA, system: scenario.briefA, roomId: room_id }),
    runAgent({ anthropic, model, mcp: clientB, system: scenario.briefB, roomId: room_id }),
  ])
  clearInterval(poll)
  await new Promise((r) => setTimeout(r, 800))

  const finalA = await getJson<State>(`${baseA}/api/rooms/${room_id}/state`)
  const finalChain = await getJson<{ events: ChainEvent[] }>(`${baseA}/api/rooms/${room_id}/chain`)
  const stB = JSON.parse(
    textOf(await clientB.callTool({ name: 'get_room_state', arguments: { room_id } })),
  ) as State

  line()
  console.log('  RESULT')
  line()
  console.log(`  peer A state: ${finalA?.state}   peer B state: ${stB.state}`)
  console.log(`  rounds completed: ${finalA?.current_round ?? 0}`)
  console.log(`  Merkle heads match: ${finalA?.head_hash === stB.head_hash ? 'YES' : 'NO'}`)
  if (finalA?.hard_limit_hit) console.log(`  hard limit hit: ${finalA.hard_limit_hit}`)
  if (finalA?.walk_away_by) console.log('  ended by walk-away')

  if (finalA?.artifact) {
    line()
    console.log('  CONSOLIDATED ARTIFACT (last merged draft)')
    line()
    for (const ln of finalA.artifact.markdown.split('\n')) console.log(`  ${ln}`)
    if (finalA.artifact.overlay.length > 0) {
      console.log('')
      console.log('  clauses:')
      for (const c of finalA.artifact.overlay) {
        console.log(`    - ${c.clause_type}: ${c.status}`)
      }
    }
  } else {
    line()
    console.log('  No merged artifact — every round disputed (independent consolidators diverged).')
  }

  line()
  console.log('  MERKLE CHAIN')
  line()
  for (const e of finalChain?.events ?? []) {
    console.log(`  ${String(e.index).padStart(2)}  ${e.payload.type.padEnd(24)}  ${e.hash.slice(0, 16)}…`)
  }
  line()

  await clientA.close().catch(() => {})
  await clientB.close().catch(() => {})
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
