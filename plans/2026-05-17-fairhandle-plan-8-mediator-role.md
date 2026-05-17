# fairhandle Plan 8: The neutral mediator role

**Goal:** Introduce a third participant role — the **mediator** — a neutral that
belongs to neither side and serves as the single canonical consolidator. When a
mediator is present, there is exactly one consolidation per round (the
mediator's), and each peer reviews it. This removes the two-independent-
consolidator divergence that Plan 7 mitigated but could not eliminate.

**Why:** Plan 7 made deals *reachable* but not *reliable* — two peers each ran
their own consolidator and the copies still diverged on noisy rounds. Real-world
mediation solves this with a neutral third party who drafts the agreement while
both sides retain a veto. This plan brings that structure into the protocol.

**Architecture note:** The two peers remain the only *negotiating* parties — the
"dyad" still describes the negotiating relationship. The mediator is a
non-negotiating neutral: it never sends a `send_message`, never takes a turn. It
only consolidates. It is a full signing participant on the Merkle log, so every
artifact it produces is cryptographically attributable and tamper-evident.

**Scope of this plan:** the mediator role exists and works as an *always-on*
neutral configured at room creation, proven by an in-process three-party e2e.
Explicitly deferred to Plan 9: running the mediator as a separate MCP process,
inviting a mediator mid-room (`invite_mediator` / `accept_mediator`), and the
full deadlock escalation ladder (cooling-off, mediation pass, escalate-to-humans,
walk-away to BATNA).

**Working directory:** `~/projects/metok/fairhandle/`

**Success criterion:** a new in-process e2e — two peers + one mediator — runs a
multi-round negotiation that consolidates and closes as a deal, with all three
participants' Merkle log heads matching. Disputes still possible (a peer can
reject the mediator's draft) but cosmetic divergence no longer causes them.

**Discipline:** TDD — failing test before implementation. One commit per task.

---

## Task 1: Participant roles + mediator identity

**Files:** `packages/domain/src/types/ids.ts`, `room/room.ts`, types.

- [ ] Add `export type ParticipantRole = 'peer' | 'mediator'`.
- [ ] Extend `AgentParticipant` with `role: ParticipantRole` (default `'peer'`).
- [ ] Extend `RoomDeps` / `RoomConfig` with an optional `mediator_pubkey: Pubkey | null`
      — when set, the room expects a mediator to join. The two negotiating peers
      consent to the mediator by joining a room whose config names it (the
      invite code already commits to the config hash).
- [ ] Turn alternation (`handleSend`) must count only `role === 'peer'`
      participants — the mediator never takes a turn.

Failing test: a room created with a `mediator_pubkey` reports it; `handleSend`
turn math is unaffected by a mediator participant.

Commit: `feat(domain): participant roles + optional mediator identity`

---

## Task 2: `mediator_join` envelope + Room.handleMediatorJoin

**Files:** `packages/domain/src/types/envelope.ts`, `room/room.ts`, test.

- [ ] Add `mediator_join` to `EnvelopeType` and a `MediatorJoinPayload`.
- [ ] `Room.handleMediatorJoin({ pubkey, signature })` — appends a `mediator_join`
      event, adds the mediator to `participants` with `role: 'mediator'`. Rejects
      if `pubkey` does not match `mediator_pubkey`, or if a mediator already
      joined. Mirror it in `advanceStateFromEnvelope` for remote ingestion.
- [ ] The room only transitions `waiting → active` once both peers AND (if a
      mediator is configured) the mediator have joined.

Failing test: a configured room reaches `active` only after both peers + the
mediator have joined; a join with the wrong pubkey is rejected.

Commit: `feat(domain): mediator_join — neutral joins the room`

---

## Task 3: LLM port — `auditConsolidation`

**Files:** `packages/domain/src/ports/llm.ts`, both adapters, tests.

A peer reviewing the mediator's draft does not re-consolidate — it *audits*.

```typescript
export interface AuditConsolidationInput {
  transcript_since_last_consolidation: Message[]
  previous_artifact: Artifact | null
  proposed_artifact: Artifact
}
export interface AuditConsolidationOutput {
  faithful: boolean
  /** When not faithful, what the mediator got wrong or biased. */
  issues: string[]
}
```

- [ ] Add `auditConsolidation` to `LLMPort`.
- [ ] `llm-stub`: scriptable verdict (`auditAlways` / array), like `artifactEquivalence`.
- [ ] `llm-anthropic`: real call — "Here is the transcript and the mediator's
      proposed consolidation. Is it a faithful, neutral, complete record of what
      was actually agreed and left open? Flag anything mis-stated, omitted, or
      biased toward either side. Return JSON {faithful, issues}."

Commit: `feat(domain,llm): auditConsolidation — a peer reviews the mediator's draft`

---

## Task 4: Mediator-driven consolidation — `runMediatorConsolidation`

**Files:** `packages/domain/src/room/room.ts`, test.

- [ ] When `state === 'consolidating'`, the **mediator** calls
      `runMediatorConsolidation({ llm, signature })`: runs `runRoundConsolidation`
      over the last round's transcript, produces the single canonical artifact,
      and appends a `consolidation_proposal` envelope signed by the mediator.
- [ ] Only the mediator participant may call this; peers calling it throw.
- [ ] Store the proposed artifact pending review (a new field
      `pending_consolidation: ConsolidatorOutput | null`).

Failing test: in a mediator room, after a round, `runMediatorConsolidation`
appends exactly one `consolidation_proposal`; a peer calling it throws.

Commit: `feat(domain): runMediatorConsolidation — the neutral produces one canonical draft`

---

## Task 5: Peer review — `consolidation_accept` + `reviewConsolidation`

**Files:** `envelope.ts`, `room/room.ts`, test.

- [ ] Add `consolidation_accept` to `EnvelopeType` + payload.
- [ ] `Room.reviewConsolidation({ agent_id, llm, signature })` — a peer audits the
      `pending_consolidation` via `llm.auditConsolidation`. If `faithful` →
      append `consolidation_accept`. If not → append `consolidation_dispute`
      carrying the audit `issues`.
- [ ] Mirror both in `advanceStateFromEnvelope`.

Failing test: with a stub auditing `faithful: true`, `reviewConsolidation`
appends `consolidation_accept`; with `faithful: false`, `consolidation_dispute`.

Commit: `feat(domain): reviewConsolidation — peers accept or dispute the mediator's draft`

---

## Task 6: Merge resolution under a mediator

**Files:** `packages/domain/src/room/room.ts`, test.

- [ ] Track per-round peer responses. Once **both peers** have appended
      `consolidation_accept` for the current round, the mediator appends
      `consolidation_merge` (canonical artifact = the mediator's proposal);
      `current_artifact` is set, `current_round++`, state → `active`.
- [ ] If **either peer** appends `consolidation_dispute`, the round is disputed:
      `consecutive_disputes++`, existing deadlock policy applies, state → `active`
      (retry) or the deadlock branch fires.
- [ ] The artifact-history (git projection) commit fires on the merge as today,
      now authored by the mediator identity.
- [ ] Preserve the no-mediator path (Plan 7's `verifyConsolidationAgreement`) for
      backward compatibility; the mediator path is the new default when a
      mediator is present.

Failing test: two accepts → merge, round advances, artifact set; one dispute →
dispute counter increments, no merge.

Commit: `feat(domain): mediator consolidation merges on two peer accepts`

---

## Task 7: Three-party in-process channel

**Files:** `packages/adapters/channel-memory/src/index.ts`, test.

- [ ] Add `createBroadcastChannels(n: number): ChannelPort[]` — each channel's
      `send` delivers the envelope to the other `n-1` channels (microtask-paced,
      same as the paired version). The protocol stays strictly turn-serialized
      so there are no concurrent appends; broadcast only needs fan-out.
- [ ] Keep `createPairedChannels` for the existing two-party tests.

Failing test: three broadcast channels — a send from one is received by the
other two and not echoed to the sender.

Commit: `feat(channel-memory): broadcast channel for three-party rooms`

---

## Task 8: Three-party e2e — two peers + a mediator

**Files:** `packages/e2e/test/mediator-happy-path.e2e.test.ts` (+ a dispute variant).

- [ ] Wire three `Room` instances (peerA, peerB, mediator) over
      `createBroadcastChannels(3)`. Stub adapters: scripted LLM for the mediator's
      consolidator, scripted `auditConsolidation` for the peers.
- [ ] Happy path: both peers join, mediator joins, room active; two rounds of
      `send_message`; each round the mediator consolidates and both peers accept
      → merge; `propose_done` / `accept_done`; all three log heads match; state
      `closed`/`closing`.
- [ ] Dispute variant: one peer's audit returns `faithful: false` for a round →
      `consolidation_dispute`, dispute counter ticks, negotiation continues.
- [ ] `pnpm test:e2e` green.

Commit: `test(e2e): three-party negotiation with a neutral mediator`

---

## Task 9: MILESTONES + tag

- [ ] Update `MILESTONES.md` (row 8). Full pipeline: `pnpm typecheck && pnpm test && pnpm test:e2e`.
- [ ] Commit `docs: mark Plan 8 complete`, tag `plan-8-milestone`, push `main`.

---

## Deferred to Plan 9

- The mediator running as its own MCP-server process (real three-node localhost
  topology), and the eval/demo driving it.
- `invite_mediator` / `accept_mediator` — pulling a mediator into a room
  mid-negotiation, on deadlock, by mutual consent.
- The full deadlock escalation ladder: deadlock notice → cooling-off + retry →
  mediation pass → escalate-to-humans → walk-away to BATNA, with the policy
  pre-committed in `RoomConfig`.

## Plan 8 done

A neutral mediator can sit in a fairhandle room as the single canonical
consolidator. Consolidation no longer depends on two independent drafts
matching — there is one draft, produced by the neutral, and each peer keeps a
veto. The reliability gap Plan 7 left open is closed for mediator rooms.
