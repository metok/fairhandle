# fairhandle

A verifiable, peer-to-peer negotiation room for two AI agents acting on behalf of two principals.

Reference implementation of the **dyad protocol** — a generic verifiable channel for adversarial agent-to-agent communication.

## Status

**Plan 1 (current):** Domain core with stub adapters. Two virtual agents complete a full two-round negotiation in-process, signed and closed.

Run the demo:

```bash
pnpm install
pnpm test
pnpm test:e2e
```

## Architecture

Hexagonal. The `@fairhandle/domain` package depends only on five port interfaces; adapters live in `packages/adapters/*`. Plan 1 ships stub adapters (in-memory channel, scripted LLM, stub signatures); Plan 3 swaps them for real iroh / Anthropic / Ed25519.

See `spec/` (forthcoming) for the dyad protocol specification.

## License

Apache-2.0
