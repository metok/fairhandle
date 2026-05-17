# fairhandle Plan 9: The mediator as an MCP-server process + three-party eval

> **For agentic workers:** execute task-by-task with `superpowers:subagent-driven-development`
> (or `superpowers:executing-plans`). One commit per task. TDD: failing test before
> implementation.

**Goal:** Run the neutral mediator (built in Plan 8 at the domain layer) as its own
MCP-server process, so a real three-node localhost negotiation works, and extend the
eval/demo so two real LLM agents can negotiate through a mediator.

**Why:** Plan 8 proved the mediator works in-process (the three-party e2e converges all
three Merkle log heads). But the MCP server, the WebSocket channel, and the eval
framework still only know the two-peer topology. Until the mediator runs as a real
process the eval cannot exercise it with real agents — which is the gap that matters for
"does this actually work end to end."

**Architecture:**
- The WebSocket transport today is strictly point-to-point (`WebSocketServerChannel`
  accepts exactly one client). Plan 9 adds a **broadcasting hub**: the room initiator
  (peer A) hosts a hub that accepts two clients (peer B and the mediator) and fans every
  envelope out to all other participants. This mirrors `createBroadcastChannels` from
  `channel-memory`, but over WebSocket.
- The mediator runs as a third MCP-server process. It has **no LLM agent driving it** —
  its consolidation work is automatic, driven by a background loop, exactly as the peers'
  consolidation is today.
- Bootstrapping order: the mediator process starts first and exposes its public key; the
  initiator creates the room with `mediator_pubkey` set in the config; both the other
  peer and the mediator join over the hub.

**Tech stack:** TypeScript strict, pnpm workspaces, Vitest, `ws` (WebSocket),
`@modelcontextprotocol/sdk`, the existing fairhandle domain + adapters.

**Working directory:** `~/projects/metok/fairhandle/`

**Success criterion:** an automated in-process integration test wires three
`RoomRegistry` instances (peerA, peerB, mediator) over an injected broadcast channel with
a stub LLM and drives a full mediated negotiation to a closed deal with all three Merkle
log heads matching — no real processes, no API key. Plus a process-level three-node
integration test (gated like the existing `cross-process.e2e.test.ts`) and an
`eval`/`demo` path that can drive a three-party negotiation with real agents when an
Anthropic key is present.

**Discipline:** TDD — failing test before implementation. One commit per task. The
existing two-peer path (no mediator) MUST stay behaviorally identical: every existing
test green, and Claude Desktop's two-peer flow unaffected.

---

## Task 1: Broadcasting WebSocket hub

**Files:** `packages/adapters/channel-ws/src/hub.ts` (create),
`packages/adapters/channel-ws/src/index.ts` (export it), test under
`packages/adapters/channel-ws/test/`.

- [ ] Add `WebSocketHubChannel implements ChannelPort`. Constructor `{ port?: number }`
      (default `0` = auto-assign, host `127.0.0.1`). `listen(): Promise<number>` resolves
      the bound port.
- [ ] It accepts MULTIPLE clients (unlike `WebSocketServerChannel`, which rejects a
      second). Track a `Set<WebSocket>` of connected clients.
- [ ] `send(env)` — the hub host's own outbound envelope: send `env` to ALL connected
      clients. If no client is connected yet, buffer it (mirror `WebSocketServerChannel`'s
      queue, then flush per new client on connection).
- [ ] On a client message: parse the `Envelope`, then (a) deliver it to the hub's local
      `onReceive` handlers (so the hub host's `Room` ingests it) AND (b) forward it to
      every OTHER connected client. Never echo a client's envelope back to that same
      client.
- [ ] `onReceive` / `close` mirror `WebSocketServerChannel`'s semantics.
- [ ] Do NOT modify `WebSocketServerChannel` or `WebSocketClientChannel` — the two-peer
      path keeps using them unchanged. `WebSocketClientChannel` already works as a hub
      client with no change (it sends to / receives from one socket).

Failing test (real WebSocket on localhost, single process): start a hub, connect two
`WebSocketClientChannel`s to it; an envelope sent by the hub reaches both clients; an
envelope sent by client 1 reaches the hub's handlers and client 2 but NOT client 1; an
envelope from client 2 reaches the hub and client 1. Mirror how the existing channel-ws
test awaits delivery.

Commit: `feat(channel-ws): broadcasting hub channel for three-party rooms`

---

## Task 2: Invite carries the mediator pubkey

**Files:** `packages/mcp-server/src/invite.ts`, `room-registry.ts`, test.

The joiner currently rebuilds config via `defaultRoomConfig()` and relies on it matching
the initiator's. A mediator room has a non-default `mediator_pubkey`, so the joiner must
receive it.

- [ ] Extend the invite payload encoded by `encodeInvite` / decoded by `decodeInvite`
      with `mediator_pubkey: string | null`. Keep backward compatibility: a decoded
      legacy invite with no field yields `null`.
- [ ] `joinRoom` builds its `RoomConfig` as `{ ...defaultRoomConfig(), mediator_pubkey:
      invite.mediator_pubkey ?? null }` instead of a bare `defaultRoomConfig()`. The
      `config_hash` committed in the invite must be computed over the SAME config object
      (including `mediator_pubkey`) on both sides — verify `hashRoomConfig` covers it.

Failing test: `encodeInvite`/`decodeInvite` round-trips a `mediator_pubkey`; a decoded
invite without the field yields `null`; a `joinRoom`-built config carries the invite's
`mediator_pubkey`.

Commit: `feat(mcp-server): invite code carries the mediator pubkey`

---

## Task 3: Mediator identity + `get_mediator_identity` tool

**Files:** `packages/mcp-server/src/room-registry.ts`, `src/tools.ts`, test.

- [ ] Add a lazily-created, cached mediator keypair to `RoomRegistry` (an
      `Ed25519SignatureAdapter` keypair). A private getter
      `getMediatorKeypair(): Promise<{ pubkey, ... }>` creates it on first call and
      returns the same one thereafter.
- [ ] Add a `get_mediator_identity` MCP tool (spec in `tools.ts`, handler routed through
      `RoomRegistry.handleTool`) that returns `{ pubkey: string }` from
      `getMediatorKeypair()`.
- [ ] This tool is how the eval harness learns the mediator's pubkey BEFORE it calls
      `create_room` on the initiator — the room config must commit to `mediator_pubkey`
      at creation time.

Failing test: `get_mediator_identity` returns a syntactically valid pubkey, and two calls
return the SAME pubkey (the keypair is cached).

Commit: `feat(mcp-server): mediator identity + get_mediator_identity tool`

---

## Task 4: `create_room` accepts a mediator pubkey and hosts a hub

**Files:** `packages/mcp-server/src/room-registry.ts`, `src/tools.ts`, test.

- [ ] `create_room` accepts an optional `mediator_pubkey?: string` argument (add to the
      tool spec in `tools.ts`). When present, the created `RoomConfig` sets
      `mediator_pubkey` to it; when absent, `mediator_pubkey: null` (unchanged two-peer
      behavior).
- [ ] When `mediator_pubkey` is set, the initiator hosts a `WebSocketHubChannel` (Task 1)
      instead of `WebSocketServerChannel`. When absent, it keeps hosting
      `WebSocketServerChannel` exactly as today. The `RoomHandle` stores the channel
      either way (both satisfy `ChannelPort`).
- [ ] The returned invite encodes the room's `mediator_pubkey` (Task 2).
- [ ] Do NOT yet change the consolidation loop — that is Task 6. After Task 4 a
      mediator-configured room can be created and will sit in `waiting` (it needs the
      mediator to join, Task 5).

Failing test (registry-level, see Task 5 for channel injection — if injection lands
first reuse it, otherwise test the config/invite outcome): `createRoom({ mediator_pubkey
})` produces a room whose `config.mediator_pubkey` equals the argument and an invite that
decodes with that `mediator_pubkey`; `createRoom()` with no argument is unchanged
(`mediator_pubkey: null`, point-to-point server).

Commit: `feat(mcp-server): create_room configures a mediator and hosts a hub`

---

## Task 5: Channel injection + `join_as_mediator`

**Files:** `packages/mcp-server/src/room-registry.ts`, `src/tools.ts`, test.

This task makes the registry testable in-process AND adds the mediator-join path.

- [ ] **Channel + LLM injection.** `RoomRegistry` currently hardcodes
      `new WebSocketServerChannel()` / `new WebSocketClientChannel()` /
      `new AnthropicLLMAdapter()`. Add optional injectable factories to the
      `RoomRegistry` constructor config: a channel factory (given a role, returns the
      `ChannelPort` to use) and an LLM factory. Default the factories to the current real
      behavior so production is unchanged. Tests pass `createBroadcastChannels(3)`
      channels and a `ScriptedLLMAdapter`.
- [ ] Add a `join_as_mediator` MCP tool + `RoomRegistry.joinAsMediator(args: {
      invite_code: string })`. It: decodes the invite; connects to the initiator's hub as
      a client (a `WebSocketClientChannel`, or the injected channel in tests); creates a
      `Room` with the SAME config (including `mediator_pubkey` from the invite); registers
      `onReceive`; waits until both peers have joined the room
      (`room.participants` shows two `role: 'peer'` entries); calls
      `room.handleMediatorJoin({ pubkey: <cached mediator pubkey>, signature })`;
      broadcasts the resulting `mediator_join` envelope; stores a `RoomHandle` flagged as
      the mediator.
- [ ] `joinAsMediator` must use the keypair from `getMediatorKeypair()` (Task 3) so the
      pubkey matches `config.mediator_pubkey`.

Failing test (in-process, injected `createBroadcastChannels(3)` + stub adapters): three
registries — initiator `createRoom({ mediator_pubkey })`, joiner `joinRoom`, mediator
`joinAsMediator` — drive all three rooms to `state === 'active'` with the mediator seated
as a `role: 'mediator'` participant in all three.

Commit: `feat(mcp-server): join_as_mediator + injectable channel/LLM factories`

---

## Task 6: Mediator-aware consolidation loops

**Files:** `packages/mcp-server/src/room-registry.ts`, test.

The current `driveLoop(room_id, handle, node)` runs the Plan-7 two-peer consolidation
(`runOwnConsolidation` + `attemptMerge`). Plan 9 adds the mediator-room behavior while
preserving the no-mediator path.

- [ ] **No-mediator rooms:** the existing `driveLoop` (Plan-7
      `runOwnConsolidation`/`attemptMerge`) stays and runs unchanged when the room has no
      mediator.
- [ ] **Peer in a mediator room** — a new loop: wait for `state === 'consolidating'`;
      wait for `room.pending_consolidation != null` (the mediator's proposal arrived);
      call `room.reviewConsolidation({ agent_id: myAgentId, llm, signature })`; broadcast
      the resulting `consolidation_accept`/`consolidation_dispute` envelope; wait for the
      round to resolve (`state !== 'consolidating'`); repeat. The peer never calls
      `runOwnConsolidation`/`attemptMerge` in a mediator room.
- [ ] **Mediator** — a new loop: wait for `state === 'consolidating'`; call
      `room.runMediatorConsolidation({ llm, signature })`; broadcast the
      `consolidation_proposal`; wait until either every peer has accepted
      (`room.peers().every(p => room.roundAccepts.includes(p.agent_id))`) or the round
      left `consolidating` (a dispute/deadlock the domain already resolved); if all
      accepted, call `room.runMediatorMerge({ signature })` and broadcast the
      `consolidation_merge`; repeat until `closing`/`closed`.
- [ ] Pick the loop by room role: the mediator handle runs the mediator loop; a peer
      handle runs the mediator-room peer loop when `config.mediator_pubkey != null`, else
      the existing no-mediator loop. Keep the three loop bodies as separate, clearly named
      functions rather than one tangled function.
- [ ] **Fix `myIdx`.** `joinRoom` computes `myIdx` from
      `room.participants.indexOf(...)`. With a mediator in `participants` this can be
      wrong. Compute it from the peer-only list (`room.peers()` index, 0 or 1) so the
      `send_message` turn predicate (`current_turn_index % 2 === myIdx`) stays correct.

Failing test (in-process, three registries over injected `createBroadcastChannels(3)` +
`ScriptedLLMAdapter`): drive a full mediated negotiation through the tools — both peers
`send_message` for two rounds, the loops auto-run mediator consolidation + peer reviews +
mediator merge each round, then `propose_done`/`accept_done`; assert all three rooms
reach `closing`/`closed`, `current_artifact` is set and identical, and all three
`log.getHeadHash()` values match. Add a dispute variant: one peer's stubbed
`auditConsolidation` returns `faithful: false` for a round and the negotiation still
continues.

Commit: `feat(mcp-server): mediator-driven consolidation loop for three-party rooms`

---

## Task 7: Three-party eval harness + scenario

**Files:** `packages/eval/src/harness.ts`, `src/scenarios/bakery.ts` (or a new
scenario module), `src/run.ts`, test.

- [ ] Add `runMediatorScenarioOnce` (or a `withMediator` option on `runScenarioOnce`)
      that spawns THREE MCP-server child processes (peerA, peerB, mediator) instead of
      two. Bootstrapping order: spawn the mediator process; `get_mediator_identity` ->
      mediator pubkey; spawn peerA, `create_room({ role_label, mediator_pubkey })`;
      spawn peerB, `join_room({ invite_code })`; `join_as_mediator({ invite_code })` on
      the mediator; `waitForActive`; then run the two agents (`runAgent`) concurrently as
      today. The mediator process has NO agent — its loop runs autonomously.
- [ ] The mediator MCP process needs its own storage dir and HTTP port; pass distinct
      `FH_ROLE_LABEL` / `FH_HTTP_PORT` env like the peers.
- [ ] `run.ts` gains a way to select the mediator scenario (e.g. an `EVAL_MEDIATOR=1`
      env var or a CLI flag). The two-peer eval path stays the default and unchanged.
- [ ] Reuse the existing bakery briefs for the two agents — the agents negotiate exactly
      as before; only the consolidation topology differs.

Failing test: a structural test of the harness wiring that does NOT require an API key —
e.g. the harness builds the correct three-process spawn descriptors / bootstrapping
sequence (assert on the constructed transports/args), or a `--dry-run` of `run.ts` with
`EVAL_MEDIATOR=1` lists three processes. The real-agent run is verified manually with a
key (see Task 8).

Commit: `feat(eval): three-party eval harness driving a mediated negotiation`

---

## Task 8: Process-level integration test + demo + regression check

**Files:** `packages/e2e/test/mediator-cross-process.e2e.test.ts` (create),
`packages/eval/src/demo.ts`, verification.

- [ ] Add a process-level integration test that spawns three real MCP-server processes
      over real WebSocket and drives a mediated negotiation with STUB scripted LLMs (no
      Anthropic key) — script the consolidator + `auditConsolidation` via env-injected
      stub config if the server supports it, otherwise gate the test the same way the
      existing `packages/e2e/test/cross-process.e2e.test.ts` is gated
      (`describe.skip` / env flag). Match that file's structure and skip convention
      exactly — do not make CI depend on real processes or a key.
- [ ] Extend `demo.ts` so it can run the three-party mediated scenario (same live
      transcript/chain polling as today) when the mediator scenario is selected.
- [ ] Regression: run `pnpm typecheck && pnpm test && pnpm test:e2e` and confirm the
      whole suite is green, including every existing two-peer test. Run one no-mediator
      eval scenario locally if a key is available to confirm the two-peer path still
      negotiates (note in the report whether this was possible).

Failing test: the new `mediator-cross-process.e2e.test.ts` (gated/skipped like
`cross-process.e2e.test.ts`); when un-skipped it spawns three processes and asserts a
converged, closed three-party negotiation.

Commit: `test(e2e): three-process mediated negotiation + demo wiring`

---

## Task 9: MILESTONES + README

**Files:** `MILESTONES.md`, `README.md`.

- [ ] Add row 9 to `MILESTONES.md` describing Plan 9: the mediator as its own MCP-server
      process, broadcasting WebSocket hub, three-party eval/demo.
- [ ] Add the matching row to the `README.md` "Project status" table.
- [ ] Full pipeline green: `pnpm typecheck && pnpm test && pnpm test:e2e`.
- [ ] Commit `docs: mark Plan 9 complete`. (Branch integration + push handled by
      `superpowers:finishing-a-development-branch`.)

Commit: `docs: mark Plan 9 complete`

---

## Watch for (fragile spots)

- **Chain linearity over a real network.** Three processes append to one linear Merkle
  log. The protocol is turn-serialized and every action is gated on a `waitFor`
  predicate over that participant's own `Room` state, so a participant never produces
  event N+1 before applying event N. The hub must forward envelopes in arrival order and
  must not drop them. Do not introduce concurrency that lets two participants append at
  once.
- **No self-echo.** The hub must never send a client's envelope back to that same
  client, or that client's `applyRemote` will reject a duplicate / diverged hash.
- **`myIdx` must be peer-relative.** With a mediator in `participants`, indexing turn
  order off `participants` is wrong — use the `peers()`-relative index.
- **The no-mediator path is sacred.** `WebSocketServerChannel`, the Plan-7
  `driveLoop`, and the two-peer eval must behave byte-for-byte as before. Mediator
  behavior is strictly additive, selected by `config.mediator_pubkey != null`.
- **Bootstrapping order.** The mediator's pubkey must exist before `create_room` (the
  config hash commits to it). The harness must call `get_mediator_identity` first.

## Deferred to a later plan

- `invite_mediator` / `accept_mediator` — pulling a mediator into a room mid-negotiation
  by mutual consent.
- The full deadlock escalation ladder (deadlock notice -> cooling-off -> mediation pass
  -> escalate-to-humans -> walk-away to BATNA), policy pre-committed in `RoomConfig`.
- Unifying `WebSocketServerChannel` into `WebSocketHubChannel` (a hub with one client is
  behaviorally a point-to-point server); kept separate here to protect the proven
  two-peer path.

## Plan 9 done

The neutral mediator runs as its own MCP-server process. A real three-node localhost
negotiation — two peers plus a mediator, each its own process, connected over a
broadcasting WebSocket hub — consolidates and closes with all three Merkle log heads
matching. The eval and demo can drive a three-party mediated negotiation with real LLM
agents.
