# Changelog

## 0.7.2

### Patch Changes

- de3c99e: Point repository/homepage/bugs metadata at the public source repository (arispay-inc/arispay-x402) — npm links now resolve publicly.
- Updated dependencies [de3c99e]
  - payagent@2.14.1

## 0.7.1

### Patch Changes

- cc1263a: Re-supported: restored the Changesets release path, refreshed metadata (repository/homepage/license), and documented the publisher surface (publish, claim, validate). No API changes.

## 0.7.0 — 2026-04-24

Discovery foundation (SCOPE.md M1). Adds an agent-native discovery API,
listing categories mirroring Coinbase Agentic.market, and a provenance
field that lays the ground for the Bazaar aggregator in M2.

### Added

- `HttpMarketplaceClient.discover(input)` — POSTs
  `/v1/marketplace/discover` with an optional `capability`, `intent`,
  `budgetCentsMax`, `transport`, and `category`. Returns
  `DiscoverCandidate[]` with the server-side ranking score exposed so
  agents can reason about why a listing won.
- `HttpMarketplaceClient.listCategories()` / `.listCapabilities()` —
  enumerate the marketplace taxonomy from the agent side.
- `ListingCategory` / `ListingSource` string-literal types. Categories
  are `inference | data | media | search | social | infrastructure |
trading | other`, matching Agentic.market's seven-category set plus
  the explicit `"other"` fallback.
- `AgentListing.source`, `AgentListing.category`, `AgentListing.originUrl`
  — populated on every listing the API returns; `source` is `"arispay"`
  for rows we own and `"bazaar"` for rows ingested by the upcoming
  aggregator job.
- `PublishAgentInput.category` — publishers can set their listing's
  category in `agent.json`; auto-classified if left blank.
- `MarketplaceSearchQuery.category` / `.source` — browse-side filters
  on `GET /v1/marketplace/agents`.

### Ranking contract

`scoreDiscoverCandidate` (exported from `apps/api`) weights:

- +500 exact capability match
- +200 paid listing within the caller's budget
- +100 verified publisher
- +min(installCount, 500)
- +50 per intent keyword hit (name / description / capabilities / tags)
- −800 unhealthy paid listing

These weights are the agent-facing contract — loosening them without a
version bump breaks downstream expectations.

## 0.6.0 — 2026-04-19

The Phase 1 release: close the "you need a dashboard signup to publish a
paid listing" funnel, add one-command paid calls, and put a human-facing
web surface on the product.

### Added

- `agentmarketplace init` wizard now routes users by intent (use paid
  agents / publish a paid endpoint / just browse) instead of asking for a
  key up front.
- `agentmarketplace merchant signup` — create a publisher account,
  receive an `ap_live_` key and verification link, all from the CLI. No
  dashboard signup in the critical path.
- `agentmarketplace try <slug>` — one command to create a low-limit
  agent, fund if short, and execute a paid call with settlement metadata
  on the response.
- `agentmarketplace claim <slug>` — claim an unclaimed listing via a
  `/.well-known/arispay-claim.txt` file on the listing's homepage.
- `agentmarketplace whoami --claim-token` — prints the SHA-256 claim
  token for the active developer key.
- `publish` scaffolds `agent.json` interactively if missing and runs an
  endpoint preflight (HEAD + 5s timeout) before upload. `--force` skips.
- Public listing pages, merchant profiles, and email verification served
  from `https://agentmarketplace.arispay.app/` with OpenGraph + Twitter
  card metadata.
- `WEB_BASE_URL` exported from the library; `formatListing` now prints
  a `view:` URL; publish prints the public URL on success.
- `AgentEndpoint.argPrompts` — publishers can declare `{{TOKEN}}`
  placeholders with description / example / required. Installer prompts
  for each and also heuristically flags legacy styles
  (`/path/to/...`, `YOUR_API_KEY`, `<path>`).
- Daily server-side health probe on every http / http-x402 / mcp-http
  listing. `healthy`, `lastCheckedAt`, `lastCheckError` surfaced in the
  API payload and in CLI output. Unhealthy paid listings drop in ranking
  but remain visible.
- Paid-first search ranking on the first page (weighted, not a hard
  partition — high-install free listings can still outrank low-install
  paid ones).

### Changed

- `install` validates `--client=<id>` against the known set before the
  transport gate, so typos are caught on http / http-x402 listings too.
- `tool search` is hidden from `--help` and marked `[experimental]`
  until tool-level indexing ships. Re-expose with
  `AGENTMARKETPLACE_EXPERIMENTAL=1`.
- Public marketplace search/get filter out listings from CLI publishers
  who have not yet clicked their verification email. Escape with
  `?includeUnverified=1`.
- Config format `~/.agentmarketplace/config.json` extended (additive —
  existing users unaffected) with `developerKey`, `merchantId`, and a
  per-slug `tryAgents` map for `try <slug>` reuse.

### Dependencies

- Added `vitest` as a dev dependency; `pnpm test` now runs 20 unit tests.

### Infra

- `arispay-x402-demo` (the canned paid seller) now sets
  `mimeType: "application/json"` + a full `outputSchema` on the 402
  response so strict clients don't lint it.

### Pending deploy checklist

- Apply two Prisma migrations:
  - `20260419120000_marketplace_publisher_verification`
  - `20260419130000_marketplace_listing_health`
- Point the `agentmarketplace.arispay.app` DNS at the `apps/web`
  Railway service (no new service needed — host-based middleware routes
  the traffic to the `marketplace-web` route group).
- Set `RESEND_API_KEY` + `EMAIL_FROM` on the api service if not already
  present (reuses the magic-link integration).
- Optional: set `AGENTMARKETPLACE_WEB_URL` on the api service if you
  need to override the web host.

## 0.5.1

Previous release. See git history.
