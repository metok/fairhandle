# @fairhandle/eval

An evaluation harness that drives **real LLM agents** through a full fairhandle
negotiation and grades the outcome.

Each run:

1. Spawns two `fairhandle-mcp` servers (peer A + peer B).
2. Hands off a room (A creates, B joins) over the MCP tools.
3. Drives two negotiating agents — Anthropic tool-use loops, one per peer — each
   given a scenario brief and the five negotiation tools.
4. Grades the closed room: did it reach closure, do the Merkle heads match, what
   was the outcome (`deal` / `walk_away` / `deadlock` / `incomplete`), and — for a
   `deal` — an LLM grader checks whether every settled term landed inside the
   scenario's overlap zone.
5. Reports a pass-rate over N runs (negotiations are stochastic, so the result is
   a rate, not a boolean).

## Running

Requires `ANTHROPIC_API_KEY` in `~/.fairhandle/.env`.

```bash
EVAL_RUNS=3 pnpm --filter @fairhandle/eval eval
# options (env vars):
#   EVAL_RUNS          number of runs            (default 3)
#   EVAL_AGENT_MODEL   model for the agents      (default claude-haiku-4-5)
#   EVAL_GRADER_MODEL  model for the LLM grader  (default claude-haiku-4-5)
```

The only scenario shipped is `bakery-logo` — a bakery owner hiring a freelance
logo designer, four terms with a real overlap zone. Add scenarios under
`src/scenarios/`.

## Known finding

The eval drove a real architectural change. Originally each MCP server ran its
own consolidator and rounds were checked for *structural identity* — two
independent LLM consolidations never match structurally, so every round disputed
and negotiations always deadlocked.

Plan 7 replaced that with **material-equivalence** checking (an LLM judges whether
the two artifacts capture the same terms, ignoring wording/structure). This
unblocked deals — a full bakery negotiation now consolidates and closes as a deal
(`pnpm --filter @fairhandle/eval demo` shows it end-to-end).

It is not yet *reliable*: two independent consolidators plus a stochastic
equivalence-judge still diverge on some rounds, so the bakery pass-rate is
variable. The reliable fix — a single canonical "producer + auditor" consolidator
(one peer consolidates, the other audits faithfulness rather than re-deriving) —
is the next architectural step, aligned with `spec/` §3.7.
