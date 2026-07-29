# paygate

## 5.4.0

### Minor Changes

- 501b8e8: Add `npx paygate init` — scaffold a working x402 seller (Express, Fastify, Next.js, Hono, Cloudflare Workers, or FastAPI) with the ArisPay facilitator as the default, Bazaar discovery metadata, and a non-interactive mode for agents/CI.
  Tarball hygiene: compiled test files no longer ship in the published package, and the MIT LICENSE file is now included.

## 5.3.3

### Patch Changes

- 91e7100: npm discoverability metadata: add `facilitator` / `x402-facilitator` keywords to paygate so npm search for an x402 facilitator surfaces the SDK (default facilitator: facilitator.arispay.app); point payagent `homepage`/`repository`/`bugs` at the ArisPay monorepo instead of the retired `arispay-inc/payagent` mirror. No code changes. (buyforme got the same metadata fix in-repo, but it is changeset-ignored — it ships on its next manual `pnpm publish`.)

## 5.3.2

### Patch Changes

- c826990: README: describe the default facilitator (facilitator.arispay.app) accurately — non-custodial (verifies signed payment authorizations, submits settlement, funds move directly from buyer to seller), no facilitator fee, and the launch-period relay-gas fronting stated plainly with its ≥30-day change notice (replacing the contradictory "no gas subsidy" phrasing). No code changes.

## 5.3.1

### Patch Changes

- 6f48c55: docs: link facilitator.arispay.app from the SDK READMEs — an inbound link so human server-operators and crawlers reach the facilitator's discovery site. paygate gains a "Facilitator" section (it settles there by default: open, USDC + EURC, no fee/no subsidy); payagent's facilitator reference now links the live service (source moved to a secondary link); payagent-mcp lists it under Related.

## 5.3.0

### Minor Changes

- 7af86cb: New `selfSettle` config option: submit settlements from your own funded key. The SDK verifies the payment via the facilitator (free — no chain writes), then submits the EIP-3009 `transferWithAuthorization` itself from `selfSettle.privateKey`; the facilitator's `/settle` is never called. You pay chain gas (~$0.001 per settle on Base) and nobody else — the never-sponsor / never-charge policy's direct-payout path. Replay protection is the on-chain EIP-3009 nonce. `selfSettle.rpcUrl` overrides the default public Base RPCs (`eip155:8453` / `eip155:84532`); other networks require it. New settle error codes: `SELF_SETTLE_CONFIG`, `SELF_SETTLE_ERROR`, `SETTLEMENT_REVERTED`.

  Self-settle requires `ethers` (v6), declared as an **optional peer dependency** — the facilitator path never loads it, so existing installs are unaffected; merchants using `selfSettle` install `ethers` themselves and get a clear error if it's missing.

## 5.2.0

### Minor Changes

- bef10ca: Add `currency: "EUR"` config option — routes can now settle in Circle EURC
  instead of USDC. `priceCents` means integer EUR cents when set (same 10^4
  cents→base-units factor; EURC has 6 decimals like USDC). v2-shim path
  resolves on-chain-verified EURC addresses for Base mainnet and Base Sepolia
  (other networks need an explicit `asset`); v3 path selects the merchant
  manifest rail with `assetName: "EURC"` and errors clearly when the merchant
  has no EUR rail. New exported type `PaygateCurrency`. Default behavior
  (currency omitted) is unchanged.

### Patch Changes

- da0772d: npm discoverability pass: descriptions and keywords tuned for the queries
  agents and coding assistants actually make ("pay for api", "agent wallet",
  "monetize api", "eurc"/"euro"). paygate and @arispay/payagent-mcp
  descriptions now lead with the USD + EUR settlement capability. Metadata
  only — no code changes.

## 5.1.0

### Minor Changes

- b3296a9: Emit the canonical x402 challenge wire format alongside the legacy header.

  The 402 response now carries:

  - `payment-required: <base64(JSON)>` — the canonical header that 95.3%
    of Bazaar-listed x402 endpoints emit (audited 2026-04-30; see
    `docs/x402-wire-format-audit.md`). base64 encoding also dodges the
    Latin1 `ByteString` constraint on Node response headers, so a
    description containing non-ASCII characters (em dashes, smart quotes,
    Unicode currency names) no longer 500s the response.
  - `Access-Control-Expose-Headers: payment-required, x-payment-response, www-authenticate`
    so browser-based agents (Anthropic MCP-in-browser, Chrome WebMCP)
    can read the challenge cross-origin. Most live x402 endpoints don't
    bother; we do.
  - `WWW-Authenticate: x402` — RFC 7235 challenge advertisement.

  The legacy `X-Payment-Requirements` header (paygate's pre-v5.1 name)
  is preserved for one minor cycle as a deprecated alias. It will be
  removed in paygate v6 — agents reading the legacy header should switch
  to `payment-required` before then.

  No public API change for callers (Express + Fastify adapters
  automatically iterate `challenge.headers` and emit all entries).
  Existing payagent versions reading `X-Payment-Requirements` continue
  to work; the new canonical emit is purely additive.

## 5.0.0

### Major Changes

- 9429fe3: Align x402 wire shape with v2 spec: `amount` over `maxAmountRequired`.

  **`paygate` (major)**: 402 challenges and bodies sent to the facilitator's
  `/settle` now use the v2 field name `amount` instead of `maxAmountRequired`.
  This matches what `@x402/core` v2.8 reads, which is what
  `facilitator.arispay.app` (the default facilitator) expects. Merchants on
  v2.x will continue to work against an old facilitator emitting the legacy
  shape, but to settle through `facilitator.arispay.app` they must upgrade.

  **`payagent` (minor)**: Reading is now amount-first with a
  `maxAmountRequired` fallback, so legacy sellers still emitting the v1
  name continue to work. `X402Accept` exposes `amount: string` as the
  canonical field; `maxAmountRequired?: string` is kept as a deprecated
  read-only alias to avoid breaking TS consumers. `AgfacFlatRequirements`
  accepts either name and normalizes on parse.

  Why now: `@x402/core` v2.8 reads `paymentRequirements.amount`. With the
  legacy field name on the wire, settlement crashed with
  `Cannot convert undefined to a BigInt`.

  Defense-in-depth: `apps/facilitator` adds a `normalizeRequirements` shim
  that maps incoming `maxAmountRequired` to `amount` before handing the
  request to `@x402/core`, so any third-party seller still on an older
  `paygate` SDK keeps settling through `facilitator.arispay.app`.

## 4.0.1

### Patch Changes

- e6aa83c: Refresh PayGate merchant guidance around the v3 `merchantId` SDK flow and hosted x402 proxy.

## 4.0.0

### Major Changes

- 70d02f2: v3 — one config knob. Merchants pass `merchantId` (from
  paygate.arispay.app signup) and the SDK fetches wallet + network +
  trust policy from the ArisPay capability manifest on boot. Replaces
  v2's `wallet` + `network` + `asset` flags.

  Breaking changes:

  - `PaygateConfig.merchantId` is the new required field.
  - `RoutePrice.priceCents` (integer cents) replaces `price` (floating
    dollars). `priceCents: 10` is $0.10. Floats are rejected with a
    clear error.
  - Fastify route-config key renamed: `config.paygate.priceCents`
    (previously `config.x402.price`).
  - Settlement receipt moves from a JSON body mutation to the
    `X-Paygate-Receipt` response header. Body stays byte-identical for
    non-JSON merchants (images, binary, streams).

  Non-breaking additions:

  - Merchant-capability cache (5-min TTL, stale-on-5xx).
  - Trust-tier awareness — the 402 response now advertises the
    merchant's `trustMinTier`. Enforcement on the hosted-proxy path is
    live; SDK-path enforcement lands in a follow-up.

  Compat shim:

  - v2 callers (`wallet` + `network` + `price`) keep working. The shim
    emits a console warning on first use. Shim is removed in v4.

  Runtime deps:

  - `ethers` dropped — v3 never used it. Runtime deps are now zero.

  Migration: see paygate.arispay.app/docs#v3-migration.

## 2.1.0

### Minor Changes

- 1129721: Bump to x402 protocol v2 in 402 challenges and facilitator `/settle` calls.

  Previously paygate emitted `x402Version: 1` with CAIP-2 network identifiers (e.g. `"eip155:8453"`). `@x402/core`'s v1 scheme is keyed on short network names (`"base"`, `"ethereum"`, etc.) — upstream and in-repo facilitators could not route settle calls because neither the exact-match Set nor the derived regex pattern included a CAIP-2 entry. Settlement silently failed with a generic `{ success: false }` (no `errorReason`), which paygate surfaced as `Payment settlement failed`.

  v2 uses CAIP-2 natively, so our existing network representation matches `ExactEvmScheme`'s registration without any per-merchant remapping. EIP-3009 payloads — which ArisPay's CDP-backed `/v1/x402/authorize` already emits — are forwarded unchanged through `ExactEvmScheme.settle`'s Permit2/3009 auto-detect path.

  Merchants who override `facilitatorUrl` to a v1-only facilitator (not the ArisPay default) must confirm that facilitator advertises `x402Version: 2` in `/supported` before upgrading.
