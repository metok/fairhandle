import { describe, it, expect } from 'vitest'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const enabled = process.env.RUN_REAL_LLM === '1'

interface TextContent {
  type: 'text'
  text: string
}

function parseToolText(result: { content: unknown }): string {
  const arr = result.content as Array<TextContent>
  return arr[0]!.text
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout: ${label}`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

describe.skipIf(!enabled)('two MCP servers complete a negotiation', () => {
  it('Alice creates, Bob joins, they finalize', async () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const bin = resolve(here, '..', 'bin', 'fairhandle-mcp')
    const portA = 17800 + Math.floor(Math.random() * 100)
    const portB = portA + 1
    const transportA = new StdioClientTransport({
      command: bin,
      env: { ...process.env, FH_ROLE_LABEL: 'Alice', FH_HTTP_PORT: String(portA) },
    })
    const transportB = new StdioClientTransport({
      command: bin,
      env: { ...process.env, FH_ROLE_LABEL: 'Bob', FH_HTTP_PORT: String(portB) },
    })
    const a = new Client({ name: 'test-a', version: '0' }, { capabilities: {} })
    const b = new Client({ name: 'test-b', version: '0' }, { capabilities: {} })
    await a.connect(transportA)
    await b.connect(transportB)

    try {
      const created = await a.callTool({ name: 'create_room', arguments: { role_label: 'Alice' } })
      const parsed = JSON.parse(parseToolText(created as { content: unknown })) as { invite_code: string; room_id: string }
      const { invite_code, room_id } = parsed

      await b.callTool({ name: 'join_room', arguments: { invite_code, role_label: 'Bob' } })

      // Round 1: A then B
      await a.callTool({ name: 'send_message', arguments: { room_id, content: 'I propose 30-day net payment terms.' } })
      await b.callTool({ name: 'send_message', arguments: { room_id, content: 'Agreed on 30-day net.' } })

      // Wait for both sides to clear consolidation and return to active.
      await waitFor(async () => {
        const sA = await a.callTool({ name: 'get_room_state', arguments: { room_id } })
        const stA = JSON.parse(parseToolText(sA as { content: unknown })) as { state: string; current_round: number }
        const sB = await b.callTool({ name: 'get_room_state', arguments: { room_id } })
        const stB = JSON.parse(parseToolText(sB as { content: unknown })) as { state: string; current_round: number }
        return stA.state === 'active' && stB.state === 'active' && stA.current_round >= 1 && stB.current_round >= 1
      }, 180_000, 'never returned to active after round 1')

      await a.callTool({ name: 'propose_done', arguments: { room_id, reason: 'aligned' } })
      await waitFor(async () => {
        const s = await b.callTool({ name: 'get_room_state', arguments: { room_id } })
        const st = JSON.parse(parseToolText(s as { content: unknown })) as { state: string }
        return st.state === 'active'
      }, 30_000, 'B did not see propose_done')
      await b.callTool({ name: 'accept_done', arguments: { room_id } })

      const stateAResp = await a.callTool({ name: 'get_room_state', arguments: { room_id } })
      const stateA = JSON.parse(parseToolText(stateAResp as { content: unknown })) as { state: string }
      const stateBResp = await b.callTool({ name: 'get_room_state', arguments: { room_id } })
      const stateB = JSON.parse(parseToolText(stateBResp as { content: unknown })) as { state: string }

      expect(['closing', 'closed']).toContain(stateA.state)
      expect(['closing', 'closed']).toContain(stateB.state)
    } finally {
      await a.close()
      await b.close()
    }
  }, 300_000)
})
