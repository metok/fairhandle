# fairhandle

[![CI](https://github.com/metok/fairhandle/actions/workflows/ci.yml/badge.svg)](https://github.com/metok/fairhandle/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](./.nvmrc)

A verifiable, peer-to-peer negotiation room for two AI agents acting on behalf of two principals.

When two parties each delegate a negotiation to an AI agent, neither side can see the other's reasoning, and neither can trust a transcript the other party could have edited. fairhandle is a reference implementation of the **dyad protocol**: a tamper-evident channel where two agents negotiate, a neutral scribe consolidates what they have agreed, and every step is recorded on a hash-linked log that any third party can verify after the fact.

## What it does

- **Two agents, two principals.** Each agent represents one human. Agents never share private instructions; they exchange only negotiation messages.
- **Strict-turn protocol.** Messages alternate. After every round a neutral consolidator (an LLM acting purely as a scribe) produces an updated draft artifact and marks each clause `agreed`, `open`, or `contested`.
- **Bilateral verification.** Both peers run the consolidation independently and cross-check the result. A structural disagreement is logged as a dispute rather than silently resolved.
- **Tamper-evident log.** Every envelope becomes an entry in a per-room Merkle log. Both peers' log heads must match after every event.
- **Git projection.** Each successful consolidation is also written as a deterministic, unsigned commit to a per-room `artifact.git` repository, with structured trailers linking the commit back to the chain.
- **Exportable + independently verifiable.** A closed room exports to a self-contained `.zip`. Anyone can run `fairhandle verify <bundle>` to re-check chain integrity, signatures, and the git-trailer cross-references — no trust in either party required.
- **Edge cases handled.** Consolidation disputes, deadlock detection (with `best_effort` and `escalate_to_humans` policies), voluntary walk-away, and turn/time hard limits.
- **Drivable by any MCP client.** An MCP server exposes the protocol as seven tools, so a real Claude (Desktop, Code, or any MCP-compatible client) can act as a peer.

## Architecture

A TypeScript pnpm monorepo with a strict hexagonal core.

```
packages/
  domain/              @fairhandle/domain  — pure protocol core, depends only on five port interfaces
  adapters/
    signature-stub/    deterministic test signatures
    signature-ed25519/ real Ed25519 (@noble/ed25519)
    channel-memory/    in-process paired channel
    channel-ws/        localhost WebSocket transport
    storage-memory/    in-memory event store
    storage-sqlite/    SQLite-backed event store
    storage-git/       git projection of consolidations (isomorphic-git)
    llm-stub/          scripted consolidator for tests
    llm-anthropic/     real Anthropic-backed consolidator + verifier
    clock-system/      system + deterministic test clocks
    identity-keychain/ file-backed key storage
  verifier/            @fairhandle/verifier  — `fairhandle verify` / `fairhandle export` CLI
  mcp-server/          @fairhandle/mcp-server — MCP server + local HTTP endpoint
  e2e/                 cross-package scenario tests
```

The `@fairhandle/domain` package imports zero adapter packages. Adapters depend only on domain types. This keeps the protocol logic testable in isolation and lets stubs and real adapters be swapped freely.

## Quickstart

Requires Node 22+ and pnpm 9.

```bash
git clone https://github.com/metok/fairhandle.git
cd fairhandle
pnpm install
pnpm typecheck
pnpm test         # unit tests across all packages
pnpm test:e2e     # in-process scenario tests (happy path, dispute, walk-away, deadlock)
```

To run the tests that hit the real Anthropic API, put a key at `~/.fairhandle/.env`:

```bash
mkdir -p ~/.fairhandle && chmod 700 ~/.fairhandle
echo "ANTHROPIC_API_KEY=sk-ant-..." > ~/.fairhandle/.env
chmod 600 ~/.fairhandle/.env
pnpm test:e2e:real   # two Node processes negotiate over WebSocket with a real consolidator
```

## Try it with Claude Desktop

Run a full two-agent negotiation between two tabs of Claude Desktop on one machine.

1. Configure two MCP server instances — see [`examples/README.md`](./examples/README.md) for the
   `claude_desktop_config.json` and setup steps.
2. Restart Claude Desktop. Two MCP servers (`fairhandle-peer-a`, `fairhandle-peer-b`) appear.
3. Brief one Claude as the buyer and one as the seller, then let them negotiate.
4. Watch it live: each MCP server serves a web UI at its local port — open
   `http://localhost:5173` (peer A) and `http://localhost:5174` (peer B). The
   `apps/observer` app frames both side-by-side as a third-party observer.

A worked example — a bakery owner hiring a freelance logo designer, with real overlap and clear
walk-away thresholds — is in [`examples/README.md`](./examples/README.md), ready to paste.

## Verifying a negotiation

Any closed room can be exported and checked by a third party with no trust in either peer:

```bash
# Re-check chain integrity, signatures, and git-trailer cross-references.
pnpm --filter @fairhandle/verifier exec fairhandle verify path/to/bundle.zip
```

The verifier confirms: the Merkle log is unbroken, each event's payload hash is correct, every
git commit's `dyad-merkle-event` trailer points to a real chain event, and (when `pubkeys.json`
is present) every signed envelope verifies.

## Project status

fairhandle is in active development. See [`MILESTONES.md`](./MILESTONES.md).

| Milestone | Status |
|---|---|
| Domain core + in-process happy path | shipped |
| Dispute / deadlock / walk-away / hard limits | shipped |
| Real adapters (Ed25519, SQLite, WebSocket, Anthropic) | shipped |
| Git projection + verifier CLI + export bundle | shipped |
| MCP server + Claude Desktop integration | shipped |
| Web UI (per-peer view + dual-pane observer) | shipped |

The current build is a localhost reference implementation. A real wide-area transport, a
trusted-execution consolidator, and an A2A binding are on the roadmap.

## Development

```bash
pnpm build        # build all packages
pnpm typecheck    # type-check the whole workspace
pnpm test         # all unit + in-process e2e tests
```

Contributions are welcome. The codebase follows test-driven development: every behavior change
lands with a test. Keep the domain package adapter-free, and prefer small, focused commits.

## Author

Built by [Mehmet Emin Tok](https://github.com/metok).

## License

[Apache-2.0](./LICENSE)
