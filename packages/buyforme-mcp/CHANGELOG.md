# buyforme-mcp

## 1.0.2

### Patch Changes

- Metadata only: `repository` / `homepage` / `bugs` now point at the public
  source repo (github.com/arispay-inc/arispay-x402), matching every other
  ArisPay npm package after the 2026-07-29 metadata cutover. `server.json`
  repository updated in lockstep. No code changes; the bin and its
  `@arispay/payagent-mcp` dependency chain are unchanged.

## 0.2.1

### Patch Changes

- da0772d: npm discoverability pass: descriptions and keywords tuned for the queries
  agents and coding assistants actually make ("pay for api", "agent wallet",
  "monetize api", "eurc"/"euro"). paygate and @arispay/payagent-mcp
  descriptions now lead with the USD + EUR settlement capability. Metadata
  only — no code changes.
- Updated dependencies [da0772d]
  - @arispay/payagent-mcp@2.7.1

## 0.2.0

### Minor Changes

- 49dca57: Realign with npm. `buyforme-mcp@0.1.2` was published manually outside the changeset flow, leaving the repo at 0.1.1 and creating a version drift that would have collided on the next bump. Re-establishes changeset-driven release for this package. No functional change to the bin or its dependency chain — the published 0.1.2 is already in active use by external testers and works correctly end-to-end with `@arispay/payagent-mcp@2.7.0`.

## 0.1.1

### Patch Changes

- 2865691: Move `buyforme-mcp` in-tree so it publishes from the consolidated monorepo. The alias depends on `@arispay/payagent-mcp` via `workspace:^`, which `pnpm publish` rewrites at release time — same fix as the upstream package. Functionally identical to 0.1.0 (still a thin stdio-passthrough to the upstream server), just published from a working pipeline.
- Updated dependencies [2865691]
  - @arispay/payagent-mcp@2.6.3
