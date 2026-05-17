import { config as dotenvConfig } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
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

  // Serve the built web-ui SPA, if it has been built. Located at the repo's
  // apps/web-ui/dist relative to this source file (packages/mcp-server/src).
  const here = dirname(fileURLToPath(import.meta.url))
  const webUiDist = resolve(here, '..', '..', '..', 'apps', 'web-ui', 'dist')
  if (existsSync(webUiDist)) {
    await fastify.register(fastifyStatic, { root: webUiDist, prefix: '/' })
  } else {
    console.error(`fairhandle: web-ui not built (${webUiDist} missing); HTTP serves /api only`)
  }

  // The HTTP endpoint is secondary (web UI). A port collision — e.g. a stale
  // server instance from a previous Claude Desktop spawn — must NOT kill the
  // MCP stdio transport, which is the critical path Claude talks to.
  try {
    await fastify.listen({ host: '127.0.0.1', port: HTTP_PORT })
  } catch (e) {
    console.error(`fairhandle: HTTP endpoint unavailable on port ${HTTP_PORT} (${(e as Error).message}); continuing with MCP-only`)
  }

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
