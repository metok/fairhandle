# fairhandle Plan 7: Material-equivalence consolidation + transcript visibility

**Goal:** Make real two-agent negotiations reach a deal instead of deadlocking. The
live demo (Plan 6 follow-up) and the eval harness surfaced two blockers:

1. **Every round disputes.** Each peer runs its own independent Anthropic
   consolidator. `verifyStructuralAgreement` requires the two consolidated
   artifacts to match *structurally* (same clause-type set, same statuses, same
   open_issues, same agreed-clause text). Two independent LLM consolidations of
   the same transcript never match structurally, so every round becomes a
   `consolidation_dispute`; three in a row triggers a deadlock.
2. **Agents negotiate half-blind.** The `get_room_state` MCP tool returns the
   consolidated artifact but not the raw transcript. Since artifacts never merge
   (blocker 1), an agent can never see what the counterparty actually said.

**Fix:** Replace structural-identity consolidation checking with **LLM-judged
material equivalence** — two artifacts agree if they capture materially the same
agreed terms, open issues, and contested points, regardless of wording, ordering,
labels, or span offsets. Add transcript visibility to `get_room_state`.

This preserves bilateral verification (each peer still independently consolidates
and the counterparty can still reject), but stops cosmetic divergence from
blocking consensus. A fully canonical / TEE-attested consolidator stays future
work (spec §3.7); this plan is the pragmatic unblock.

**Working directory:** `~/projects/metok/fairhandle/`

**Success criterion:** `pnpm --filter @fairhandle/eval demo` reaches at least one
`consolidation_merge` and can close as a `deal`; the bakery eval produces non-zero
`deal` outcomes. All existing unit + e2e tests still pass.

**Discipline:** TDD — failing test before implementation. One commit per task.

---

## Task 1: LLM port — `verifyArtifactEquivalence`

**Files:** `packages/domain/src/ports/llm.ts`

Add to the `LLMPort` interface a method that judges whether two consolidated
artifacts are materially equivalent.

```typescript
export interface ArtifactEquivalenceInput {
  transcript_since_last_consolidation: Message[]
  previous_artifact: Artifact | null
  artifact_a: Artifact
  artifact_b: Artifact
}

export interface ArtifactEquivalenceOutput {
  equivalent: boolean
  /** When not equivalent, the material differences. */
  divergences: string[]
}
```

Add `verifyArtifactEquivalence(input: ArtifactEquivalenceInput): Promise<ArtifactEquivalenceOutput>`
to `LLMPort`. Export the new types. Typecheck will fail until Tasks 2-3 implement
it in the adapters — that is expected; do Tasks 1-3 together before running tests.

Commit: `feat(domain): LLMPort.verifyArtifactEquivalence for material consolidation checking`

---

## Task 2: llm-stub — scriptable equivalence verdict

**Files:** `packages/adapters/llm-stub/src/index.ts`, test.

Extend `ScriptedLLMConfig` with `artifactEquivalence?: ArtifactEquivalenceOutput`
(default `{ equivalent: true, divergences: [] }`). Implement
`verifyArtifactEquivalence` to return a `structuredClone` of it.

Failing test first: a stub configured with `artifactEquivalence: { equivalent:
false, divergences: ['fee differs'] }` returns that verdict; default config
returns `equivalent: true`.

Commit: `feat(llm-stub): scriptable artifact-equivalence verdict`

---

## Task 3: llm-anthropic — real equivalence audit

**Files:** `packages/adapters/llm-anthropic/src/index.ts`

Implement `verifyArtifactEquivalence` with a real Anthropic call. Prompt sketch:

> Two AI scribes independently consolidated the SAME negotiation round into draft
> documents A and B. Ignore all differences of wording, formatting, clause
> ordering, section labels, and character offsets. Judge ONLY whether A and B
> capture materially the same agreed terms, the same open issues, and the same
> contested points. Two drafts that record the same deal in different prose are
> equivalent. Return ONLY JSON: {"equivalent": true|false, "divergences": ["..."]}

Pass both artifacts' markdown + overlays + open_issues in the user message.
Reuse the JSON-extraction fallback already used by `runConsolidator`. On parse
failure return `{ equivalent: false, divergences: ['grader returned no JSON'] }`.

Run `pnpm --filter @fairhandle/llm-anthropic typecheck`.

Commit: `feat(llm-anthropic): real material-equivalence audit`

---

## Task 4: domain — `verifyConsolidationAgreement`

**Files:** `packages/domain/src/consolidation/verifier.ts`, index, test.

Add a new function alongside `verifyStructuralAgreement` (do NOT delete the old
one yet — Task 6 removes it once the Room no longer uses it):

```typescript
export interface ConsolidationVerifyInput {
  a: ConsolidatorOutput
  b: ConsolidatorOutput
  llm: LLMPort
  low_node_id: 'A' | 'B'
  transcript: Message[]
  previous_artifact: Artifact | null
}

export async function verifyConsolidationAgreement(
  input: ConsolidationVerifyInput,
): Promise<VerifyResult>
```

It calls `llm.verifyArtifactEquivalence`. If `equivalent` → `outcome: 'agreed'`,
`canonical_from_peer: low_node_id`. Else → `outcome: 'disputed'` with the
`divergences` recorded in the `disagreement` field (reuse the existing
`VerifyResult` shape; put divergences into a `semantic_divergences: string[]`
field — extend the disagreement type).

Failing test first: stub LLM with `artifactEquivalence: { equivalent: true }`
→ agreed; with `{ equivalent: false }` → disputed.

Commit: `feat(domain): verifyConsolidationAgreement (material-equivalence based)`

---

## Task 5: Room — use the material verifier in `attemptMerge`

**Files:** `packages/domain/src/room/room.ts`

`attemptMerge` currently calls `verifyStructuralAgreement({ a, b, llm, low_node_id })`.
Switch it to `verifyConsolidationAgreement`, which also needs `transcript` and
`previous_artifact`:

```typescript
const verifyResult = await verifyConsolidationAgreement({
  a, b, llm: input.llm, low_node_id: input.low_node_id,
  transcript: this.lastRoundMessages(),
  previous_artifact: this.current_artifact,
})
```

All downstream merge/dispute/deadlock logic is unchanged (it keys off
`verifyResult.outcome`). Update the import.

The existing Plan 1 Task 23 + Plan 2 dispute/deadlock tests drive `attemptMerge`
via `ScriptedLLMAdapter`. They previously relied on structural divergence to
produce disputes. They must now set the stub's `artifactEquivalence`:
- Tests expecting a **merge**: default config is fine (`equivalent: true`).
- Tests expecting a **dispute** (`room-consecutive-disputes`, `room-deadlock-*`,
  `dispute.e2e`, `deadlock-best-effort.e2e`): set
  `artifactEquivalence: { equivalent: false, divergences: ['scripted dispute'] }`.

Update those test files. Run `pnpm --filter @fairhandle/domain test` and
`pnpm test:e2e` until green.

Commit: `feat(domain): Room consolidation uses material-equivalence verification`

---

## Task 6: remove dead structural verifier

**Files:** `packages/domain/src/consolidation/verifier.ts`, index, test.

Once Task 5 is green and nothing references `verifyStructuralAgreement`, delete
it and its test file (`verifier.test.ts` keeps only the
`verifyConsolidationAgreement` cases from Task 4). Keep `runVerifier` on `LLMPort`
only if still used; if unused, remove it from the port + both adapters.

Run full `pnpm test`. Commit: `refactor(domain): drop structural verifier, superseded by material equivalence`

---

## Task 7: MCP — transcript in `get_room_state`

**Files:** `packages/mcp-server/src/room-registry.ts`, `tools.ts`

In `RoomRegistry.getRoomState`, add a `transcript` field to the returned object —
the same array `getDecryptedTranscript` produces (agent_id, content, turn_index,
round_index). Update the `get_room_state` tool description in `TOOL_SPECS` to
state that it returns the full message transcript.

Verify: boot a server, exercise via the existing `two-servers.e2e` (still green).

Commit: `feat(mcp-server): get_room_state returns the message transcript`

---

## Task 8: eval + demo — brief the agents, re-run

**Files:** `packages/eval/src/scenarios/bakery.ts`, `agent.ts`

Update both bakery briefs: add a line that `get_room_state` returns the full
transcript of messages exchanged so far, and the agent should read the
counterparty's messages there before responding. Update the agent loop's opening
user message similarly.

Run `pnpm --filter @fairhandle/eval demo` — confirm it reaches `consolidation_merge`
and can close as a `deal`. Run `EVAL_RUNS=3 pnpm --filter @fairhandle/eval eval` —
confirm non-zero `deal` outcomes. Update `packages/eval/README.md` to remove the
"known finding" deadlock note (or replace it with the resolved status).

Commit: `feat(eval): agents read the transcript; bakery negotiations reach deals`

---

## Task 9: MILESTONES + tag

Update `MILESTONES.md` (add row 7). Full pipeline: `pnpm typecheck && pnpm test && pnpm test:e2e`.
Commit `docs: mark Plan 7 complete`, tag `plan-7-milestone`, push `main`.

---

## Plan 7 done

Real negotiations consolidate and close. The structural-identity bottleneck is
gone; agents can see the transcript. Fully canonical / TEE-attested consolidation
remains future work.
