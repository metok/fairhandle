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

Early runs surface a real architectural issue: each MCP server runs its **own
independent** Anthropic consolidator, and two independent LLM consolidations
rarely produce byte-identical structural output, so most rounds register a
structural dispute and negotiations tend to `deadlock` after three. This is the
canonical-consolidator problem described in `spec/` §3.7 — the protocol's design
answer is a single shared (TEE-attested or canonical-service) consolidator rather
than two independent ones. Until that lands, the bakery scenario's pass-rate is
low by design — the eval is correctly reporting a systemic gap, not noise.
