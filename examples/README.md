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

## Run a negotiation

1. **Tab 1 (Alice):** Brief your Claude:
   > "You are Alice negotiating a SaaS contract. Your priorities: 30-day payment terms, 12-month commitment, no exclusivity. Walk-away thresholds: anything below 60-day terms or auto-renewal. Use the fairhandle-peer-a MCP tools to create a room and represent me. Call create_room first."
2. Claude calls `create_room`. It returns an invite code.
3. **Tab 2 (Bob):** Brief your other Claude, pasting the invite code:
   > "You are Bob, a SaaS vendor. Your priorities: 14-day payment, 24-month commitment, exclusivity in our category. Walk-away thresholds: anything above 45-day terms. Use the fairhandle-peer-b tools to join this invite code: <paste>"
4. Both Claudes call `send_message` alternately. After each round, the system auto-runs a consolidation (you'll see the `current_round` counter go up via `get_room_state`).
5. When one Claude believes alignment is reached it calls `propose_done`; the other calls `accept_done`.

## Watch the negotiation live (Plan 6, forthcoming)

- Peer A's HTTP endpoint: `http://localhost:5173/api/rooms`
- Peer B's HTTP endpoint: `http://localhost:5174/api/rooms`

Plan 6 adds a browser UI on top of these endpoints.

## Troubleshooting

- If Claude Desktop says "Server disconnected" / "Could not attach to MCP server": almost always the `command` is a bare `"node"` that Claude Desktop's minimal `PATH` cannot resolve. Use the absolute node path (step 3 above).
- If a server worked once and now fails with `EADDRINUSE`: a stale server instance from a previous launch is still holding the HTTP port. As of the current build the server treats this as non-fatal (it logs a warning and runs MCP-only), but to free the port find the stale process with `lsof -iTCP:5173 -sTCP:LISTEN -n -P` and `kill` it.
- If Claude Desktop says "MCP server failed to start": check that the absolute path in the config is correct and that `~/.fairhandle/.env` exists.
- If `create_room` returns an error mentioning `ANTHROPIC_API_KEY`: the env file isn't being read. Confirm `chmod 600 ~/.fairhandle/.env` and that the file contains exactly `ANTHROPIC_API_KEY=sk-ant-...` on one line.
- If two browser tabs can't both reach localhost:517x: another process is using the port. Edit the `FH_HTTP_PORT` values in `claude-desktop-config.json` to free ports.
