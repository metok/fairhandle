export interface ToolSpec {
  description: string
  inputSchema: Record<string, unknown>
}

export const TOOL_SPECS: Record<string, ToolSpec> = {
  create_room: {
    description:
      'Create a new fairhandle negotiation room. Returns the invite code to send to your counterparty out-of-band. ' +
      'When mediator_pubkey is set, the room expects a neutral mediator (with that pubkey) to join and the host binds a broadcasting hub instead of a point-to-point server.',
    inputSchema: {
      type: 'object',
      properties: {
        role_label: { type: 'string', description: 'Display name for this peer (e.g. "Alice" or "PeerA").' },
        opening_artifact: { type: 'string', description: 'Optional initial markdown draft to seed the negotiation.' },
        mediator_pubkey: { type: 'string', description: 'Pubkey of the neutral mediator server. Obtain via get_mediator_identity on the mediator server before calling create_room.' },
      },
      required: ['role_label'],
    },
  },
  join_room: {
    description: 'Join an existing fairhandle room by invite code.',
    inputSchema: {
      type: 'object',
      properties: {
        invite_code: { type: 'string', description: 'fh1:... invite code from the room creator.' },
        role_label: { type: 'string', description: 'Display name for this peer.' },
      },
      required: ['invite_code', 'role_label'],
    },
  },
  send_message: {
    description:
      'Send a negotiation message in a room where it is currently your turn. The other peer will see the message and the system will consolidate after both have sent.',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string' },
        content: { type: 'string', description: 'Your negotiation message in plain text.' },
      },
      required: ['room_id', 'content'],
    },
  },
  propose_done: {
    description: 'Signal you believe the negotiation is complete; the other party must accept.',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string' },
        reason: { type: 'string', description: 'Short rationale for closing the negotiation.' },
      },
      required: ['room_id', 'reason'],
    },
  },
  accept_done: {
    description: 'Accept the counterparty\'s proposal to close the room. Transitions the room to closed.',
    inputSchema: {
      type: 'object',
      properties: { room_id: { type: 'string' } },
      required: ['room_id'],
    },
  },
  leave_room: {
    description: 'Walk away from the negotiation; closes the room without a deal.',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['room_id', 'reason'],
    },
  },
  get_room_state: {
    description:
      'Inspect a room: state, whose turn, current round, the consolidated artifact, and ' +
      'the full transcript of every message exchanged so far. Read the counterparty\'s ' +
      'messages from the transcript field before responding.',
    inputSchema: {
      type: 'object',
      properties: { room_id: { type: 'string' } },
      required: ['room_id'],
    },
  },
  get_mediator_identity: {
    description:
      'Return this server\'s mediator pubkey. Call this BEFORE create_room when configuring a mediated room — the initiator commits to this pubkey in the room config.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  join_as_mediator: {
    description:
      'Join this server (acting as a mediator) to a room. Call this AFTER both peers have called `create_room`/`join_room`. Uses the pubkey returned by `get_mediator_identity`.',
    inputSchema: {
      type: 'object',
      properties: {
        invite_code: { type: 'string', description: 'fh1:... invite code from the room creator.' },
      },
      required: ['invite_code'],
    },
  },
}
