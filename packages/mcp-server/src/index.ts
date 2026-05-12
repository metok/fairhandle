import { config as dotenvConfig } from 'dotenv'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import Fastify from 'fastify'
import { RoomRegistry } from './room-registry.js'
import { TOOL_SPECS } from './tools.js'

dotenvConfig({ path: resolve(homedir(), '.fairhandle', '.env') })

const ROLE_LABEL = process.env.FH_ROLE_LABEL ?? 'unnamed'
const HTTP_PORT = parseInt(process.env.FH_HTTP_PORT ?? '5173', 10)

async function main(): Promise<void> {
  const registry = new RoomRegistry({ role_label: ROLE_LABEL })

  // ---- HTTP endpoint for web UI ----
  const fastify = Fastify({ logger: false })
  fastify.get('/api/rooms', () => ({ rooms: registry.list() }))
  fastify.get<{ Params: { room_id: string } }>('/api/rooms/:room_id/state', async (req) => {
    return registry.getDecryptedState(req.params.room_id)
  })
  fastify.get<{ Params: { room_id: string } }>('/api/rooms/:room_id/transcript', async (req) => {
    return registry.getDecryptedTranscript(req.params.room_id)
  })
  fastify.get<{ Params: { room_id: string } }>('/api/rooms/:room_id/chain', async (req) => {
    return registry.getChain(req.params.room_id)
  })
  await fastify.listen({ host: '127.0.0.1', port: HTTP_PORT })

  // ---- MCP stdio ----
  const server = new Server(
    { name: 'fairhandle', version: '0.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: Object.entries(TOOL_SPECS).map(([name, spec]) => ({
      name,
      description: spec.description,
      inputSchema: spec.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    try {
      const result = await registry.handleTool(name, (args as Record<string, unknown> | undefined) ?? {})
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    } catch (e) {
      return {
        content: [{ type: 'text' as const, text: `error: ${(e as Error).message}` }],
        isError: true,
      }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((e: unknown) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
