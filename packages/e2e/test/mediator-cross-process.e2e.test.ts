import { describe, it, expect } from 'vitest'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const enabled = process.env.RUN_REAL_LLM === '1'

const here = dirname(fileURLToPath(import.meta.url))
const MCP_BIN = resolve(here, '..', '..', '..', 'mcp-server', 'bin', 'fairhandle-mcp')

function randomPort(): number {
  return 19000 + Math.floor(Math.random() * 1000)
}

function textOf(result: unknown): string {
  const content = (result as { content?: unknown }).content
  const blocks = (content as Array<{ type: string; text?: string }> | undefined) ?? []
  return blocks.map((b) => b.text ?? '').join('')
}

function makeTransport(roleLabel: string, port: number): StdioClientTransport {
  return new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN],
    env: { ...process.env, FH_ROLE_LABEL: roleLabel, FH_HTTP_PORT: String(port) } as Record<string, string>,
  })
}

describe.skipIf(!enabled)('E2E mediator cross-process (real LLM, real transport)', () => {
  it('three processes complete a 1-round mediated negotiation over WebSocket', async () => {
    const portA = randomPort()
    const portB = portA + 1
    const portM = portA + 2

    const mcpM = new Client({ name: 'test-m', version: '0' }, { capabilities: {} })
    const mcpA = new Client({ name: 'test-a', version: '0' }, { capabilities: {} })
    const mcpB = new Client({ name: 'test-b', version: '0' }, { capabilities: {} })

    try {
      // Bootstrap: mediator identity -> create_room -> join_room -> join_as_mediator
      await mcpM.connect(makeTransport('Mediator', portM))
      const { pubkey: mediator_pubkey } = JSON.parse(
        textOf(await mcpM.callTool({ name: 'get_mediator_identity' })),
      ) as { pubkey: string }

      await mcpA.connect(makeTransport('PeerA', portA))
      const created = await mcpA.callTool({
        name: 'create_room',
        arguments: { role_label: 'Alice', mediator_pubkey },
      })
      const { room_id, invite_code } = JSON.parse(textOf(created)) as {
        room_id: string
        invite_code: string
      }

      await mcpB.connect(makeTransport('PeerB', portB))
      await mcpB.callTool({
        name: 'join_room',
        arguments: { invite_code, role_label: 'Bob' },
      })

      await mcpM.callTool({
        name: 'join_as_mediator',
        arguments: { invite_code },
      })

      const waitForActive = async (mcp: Client, rid: string): Promise<void> => {
        const start = Date.now()
        for (;;) {
          const s = JSON.parse(
            textOf(await mcp.callTool({ name: 'get_room_state', arguments: { room_id: rid } })),
          ) as { state: string }
          if (s.state === 'active' || s.state === 'consolidating') return
          if (Date.now() - start > 30_000) throw new Error(`room never became active (state=${s.state})`)
          await new Promise((r) => setTimeout(r, 300))
        }
      }

      await waitForActive(mcpA, room_id)

      // Drive one round: A sends, B sends (background loops handle consolidation + peer review)
      await mcpA.callTool({
        name: 'send_message',
        arguments: { room_id, content: 'I propose 30-day net payment terms with a 2% early-pay discount.' },
      })
      await mcpB.callTool({
        name: 'send_message',
        arguments: { room_id, content: 'Agreed on 30-day net. The 2% discount works for us.' },
      })

      // Wait for round 1 to complete (mediator consolidates, peers review, mediator merges)
      const waitForRound = async (mcp: Client, rid: string, round: number): Promise<void> => {
        const start = Date.now()
        for (;;) {
          const s = JSON.parse(
            textOf(await mcp.callTool({ name: 'get_room_state', arguments: { room_id: rid } })),
          ) as { state: string; current_round: number }
          if (s.current_round >= round && (s.state === 'active' || s.state === 'closing' || s.state === 'closed')) return
          if (Date.now() - start > 120_000) throw new Error(`round ${round} never completed (state=${s.state}, round=${s.current_round})`)
          await new Promise((r) => setTimeout(r, 500))
        }
      }

      await waitForRound(mcpA, room_id, 1)

      // Propose and accept done
      await mcpA.callTool({
        name: 'propose_done',
        arguments: { room_id, reason: 'aligned' },
      })
      await mcpB.callTool({
        name: 'accept_done',
        arguments: { room_id },
      })

      const waitForClosing = async (mcp: Client, rid: string): Promise<void> => {
        const start = Date.now()
        for (;;) {
          const s = JSON.parse(
            textOf(await mcp.callTool({ name: 'get_room_state', arguments: { room_id: rid } })),
          ) as { state: string }
          if (s.state === 'closing' || s.state === 'closed') return
          if (Date.now() - start > 30_000) throw new Error(`room never reached closing (state=${s.state})`)
          await new Promise((r) => setTimeout(r, 300))
        }
      }

      await waitForClosing(mcpA, room_id)
      await waitForClosing(mcpB, room_id)

      // Assert: all three rooms converge to identical state
      type RoomStateResult = {
        state: string
        head_hash: string | null
        artifact: { markdown: string } | null
        current_round: number
      }
      const getState = async (mcp: Client): Promise<RoomStateResult> =>
        JSON.parse(textOf(await mcp.callTool({ name: 'get_room_state', arguments: { room_id } }))) as RoomStateResult

      const stateA = await getState(mcpA)
      const stateB = await getState(mcpB)
      const stateM = await getState(mcpM)

      expect(stateA.state === 'closing' || stateA.state === 'closed').toBe(true)
      expect(stateB.state === 'closing' || stateB.state === 'closed').toBe(true)

      expect(stateA.head_hash).not.toBeNull()
      expect(stateA.head_hash).toBe(stateB.head_hash)
      expect(stateA.head_hash).toBe(stateM.head_hash)

      expect(stateA.current_round).toBeGreaterThanOrEqual(1)
      expect(stateB.current_round).toBe(stateA.current_round)
      expect(stateM.current_round).toBe(stateA.current_round)

      expect(stateA.artifact).not.toBeNull()
      expect(stateB.artifact).not.toBeNull()
      expect(stateM.artifact).not.toBeNull()
    } finally {
      await mcpA.close().catch(() => {})
      await mcpB.close().catch(() => {})
      await mcpM.close().catch(() => {})
    }
  }, 300_000)
})
