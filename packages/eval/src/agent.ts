import Anthropic from '@anthropic-ai/sdk'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

/**
 * The five negotiation tools, with `room_id` stripped — the harness injects the
 * fixed room id on every call so the model cannot get it wrong.
 */
const NEGOTIATION_TOOLS: Anthropic.Tool[] = [
  {
    name: 'send_message',
    description:
      'Send a negotiation message. Only call this when get_room_state shows state "active" and it is your turn.',
    input_schema: {
      type: 'object',
      properties: { content: { type: 'string', description: 'Your negotiation message.' } },
      required: ['content'],
    },
  },
  {
    name: 'propose_done',
    description: 'Signal the negotiation is complete. The counterparty must accept.',
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
  },
  {
    name: 'accept_done',
    description: "Accept the counterparty's proposal to close the room.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'leave_room',
    description: 'Walk away from the negotiation without a deal.',
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
  },
  {
    name: 'get_room_state',
    description:
      'Inspect the room: state, whose turn, current round, and the consolidated artifact so far.',
    input_schema: { type: 'object', properties: {} },
  },
]

export interface RunAgentOptions {
  anthropic: Anthropic
  model: string
  mcp: Client
  /** System prompt — the scenario brief. */
  system: string
  roomId: string
  /** Hard cap on model turns. */
  maxSteps?: number
}

function textOf(result: unknown): string {
  const content = (result as { content?: unknown }).content
  const blocks = (content as Array<{ type: string; text?: string }> | undefined) ?? []
  return blocks.map((b) => b.text ?? '').join('') || '(no text)'
}

async function roomState(mcp: Client, roomId: string): Promise<{ state: string } | null> {
  try {
    const r = await mcp.callTool({ name: 'get_room_state', arguments: { room_id: roomId } })
    return JSON.parse(textOf(r)) as { state: string }
  } catch {
    return null
  }
}

function isTerminalState(state: string | undefined): boolean {
  return state === 'closed' || state === 'closing'
}

/**
 * Drive one negotiating agent: an Anthropic tool-use loop over the fairhandle
 * MCP tools. Returns when the room reaches a terminal state or maxSteps is hit.
 */
export async function runAgent(opts: RunAgentOptions): Promise<void> {
  const { anthropic, model, mcp, system, roomId, maxSteps = 40 } = opts
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content:
        'The negotiation room is open. It may not be your turn yet. Always call get_room_state ' +
        'first to see the state, whose turn it is, and the consolidated artifact, then act. ' +
        'Negotiate to a fair settlement within your mandate.',
    },
  ]

  for (let step = 0; step < maxSteps; step++) {
    const before = await roomState(mcp, roomId)
    if (isTerminalState(before?.state)) return

    const resp = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system,
      tools: NEGOTIATION_TOOLS,
      messages,
    })
    messages.push({ role: 'assistant', content: resp.content })

    const toolUses = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    if (toolUses.length === 0) {
      if (isTerminalState((await roomState(mcp, roomId))?.state)) return
      messages.push({
        role: 'user',
        content:
          'The negotiation is not finished. Call get_room_state, then continue negotiating or close the room.',
      })
      continue
    }

    const results: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      const args = { ...(tu.input as Record<string, unknown>), room_id: roomId }
      try {
        const r = await mcp.callTool({ name: tu.name, arguments: args })
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: textOf(r) })
      } catch (e) {
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: `error: ${(e as Error).message}`,
          is_error: true,
        })
      }
    }
    messages.push({ role: 'user', content: results })
  }
}
