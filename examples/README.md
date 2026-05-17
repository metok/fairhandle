# fairhandle — Claude Desktop two-peer demo setup

## Prerequisites

- macOS or Linux with Claude Desktop installed
- Node 22+
- This repo cloned and `pnpm install` run from the root
- Anthropic API key at `~/.fairhandle/.env`:
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  ```
  with `chmod 600 ~/.fairhandle/.env`

## Configure Claude Desktop

1. Copy `claude-desktop-config.json` into Claude Desktop's config path:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Linux: `~/.config/Claude/claude_desktop_config.json`
2. Replace `ABSOLUTE_PATH_TO/` with the actual absolute path to your clone (e.g., `/Users/you/projects/metok/fairhandle`).
3. Replace `ABSOLUTE_PATH_TO_NODE` with the absolute path to your `node` binary. **This matters:** Claude Desktop launches MCP servers with a minimal `PATH` that does NOT include Homebrew or nvm directories, so a bare `"node"` fails with "Server disconnected". Find your node path with `which node` (commonly `/opt/homebrew/bin/node` on Apple Silicon, `/usr/local/bin/node` on Intel macs, or an nvm path).
4. Quit and restart Claude Desktop. You should see `fairhandle-peer-a` and `fairhandle-peer-b` listed under the MCP servers indicator.

## Run a negotiation — worked example

**Scenario:** Alice, a small bakery owner, is hiring Bob, a freelance designer, to create a
logo. Four negotiable terms (fee, revision rounds, deadline, usage rights) with a real overlap
zone, so they reach a deal in one or two rounds.

### Tab 1 — Alice (paste into the `fairhandle-peer-a` Claude)

> You are Alice, owner of a small neighbourhood bakery. You are hiring a freelance designer to
> create a logo. You are negotiating on my behalf via the fairhandle-peer-a MCP tools.
>
> **Your targets:** budget EUR 600, 3 revision rounds included, delivery within 3 weeks, and
> full ownership of the logo (all rights transferred to you).
>
> **Your walk-away thresholds:** do not go above EUR 900, do not accept fewer than 2 revision
> rounds, do not accept a deadline longer than 5 weeks, and you must get commercial usage
> rights at minimum.
>
> **Instructions:** Call `create_room` first (role_label "Alice"). It returns an invite code —
> show me that code so I can pass it to the designer. Then negotiate by calling `send_message`
> when it is your turn. Open by stating your terms. Be friendly but firm. When all four terms
> are agreed, call `propose_done`.

### Tab 2 — Bob (paste into the `fairhandle-peer-b` Claude)

> You are Bob, a freelance logo designer. A bakery owner wants to hire you. You are negotiating
> on my behalf via the fairhandle-peer-b MCP tools.
>
> **Your targets:** fee EUR 1000, 2 revision rounds included (extras billed separately),
> delivery in 4 weeks, and you keep portfolio/display rights (client gets commercial use, you
> keep the right to show the work in your portfolio).
>
> **Your walk-away thresholds:** do not accept a fee below EUR 500, do not commit to more than
> 4 revision rounds, do not accept a deadline shorter than 2 weeks, and you will not give up
> portfolio display rights.
>
> **Instructions:** Join the room by calling `join_room` with the invite code Alice's Claude
> produced, and role_label "Bob". Then negotiate by calling `send_message` when it is your
> turn. Respond to Alice's opening with your counter. Be professional and willing to
> compromise. Once all four terms are agreed and Alice has proposed closing, call `accept_done`.

After each round the system auto-runs a consolidation; watch `current_round` climb via
`get_room_state`. To force a walk-away instead of a deal, raise Bob's fee floor to EUR 950 —
that removes the overlap.

## Watch the negotiation live

Each MCP server exposes a local read-only HTTP endpoint:

- Peer A: `http://localhost:5173/api/rooms`
- Peer B: `http://localhost:5174/api/rooms`

A browser UI on top of these endpoints is in progress.

## Troubleshooting

- If Claude Desktop says "Server disconnected" / "Could not attach to MCP server": almost always the `command` is a bare `"node"` that Claude Desktop's minimal `PATH` cannot resolve. Use the absolute node path (step 3 above).
- If a server worked once and now fails with `EADDRINUSE`: a stale server instance from a previous launch is still holding the HTTP port. As of the current build the server treats this as non-fatal (it logs a warning and runs MCP-only), but to free the port find the stale process with `lsof -iTCP:5173 -sTCP:LISTEN -n -P` and `kill` it.
- If Claude Desktop says "MCP server failed to start": check that the absolute path in the config is correct and that `~/.fairhandle/.env` exists.
- If `create_room` returns an error mentioning `ANTHROPIC_API_KEY`: the env file isn't being read. Confirm `chmod 600 ~/.fairhandle/.env` and that the file contains exactly `ANTHROPIC_API_KEY=sk-ant-...` on one line.
- If two browser tabs can't both reach localhost:517x: another process is using the port. Edit the `FH_HTTP_PORT` values in `claude-desktop-config.json` to free ports.
