# payagent

## 2.15.0

### Minor Changes

- b10ce72: New public surface: `DelegationClient.rotateX402Key(agentId)` — wraps the new
  `POST /v1/agents/:id/x402-key/rotate` recovery endpoint. Mints a fresh agent
  key for an x402 delegation whose key was lost. The previous credential
  always stops working for delegated signing; its org ApiKey record is
  additionally revoked when the server can identify it, reported via
  `previousKeyRevoked`. When `previousKeyRevoked` is `false` (some legacy
  delegations), the old key can no longer sign but may still authenticate to
  non-signing org API routes until it is revoked manually. The new plaintext
  is returned once. Wallet, network, limits, allowedDomains, spend counters
  and suspension are untouched. Requires a developer management credential —
  agent-scoped keys cannot rotate themselves or sibling agents. Adds the
  `RotateX402KeyResponse` type.

### Patch Changes

- 3305b38: Fix: `payFetchDelegated` now sends the signed payment on the
  version-appropriate header. The x402 v2 wire protocol renamed the request
  header — upstream `@x402/*` v2 middlewares read only `PAYMENT-SIGNATURE`,
  so a v2 payload sent as `X-PAYMENT` was silently treated as unpaid (402
  with empty body; the facilitator was never contacted). v2 challenges now
  get both `PAYMENT-SIGNATURE` and `X-PAYMENT`; v1 behavior is unchanged.

## 2.14.1

### Patch Changes

- de3c99e: Point repository/homepage/bugs metadata at the public source repository (arispay-inc/arispay-x402) — npm links now resolve publicly.

## 2.14.0

### Minor Changes

- 52b38ba: Add `payagent discover` and `payagent inspect` CLI commands and the `inspectChallenge` public export: read-only catalog search (`POST /v1/marketplace/discover`) and 402-challenge inspection ahead of `payagent pay`. Discovery is free — no API key, no payment, no cached authorizations; amounts are integer cents in data, with `$X.YY` / `€X.YY` formatting only at the display edge. A `facilitator` field in a challenge body is surfaced as server-declared only.

## 2.13.4

### Patch Changes

- 91e7100: npm discoverability metadata: add `facilitator` / `x402-facilitator` keywords to paygate so npm search for an x402 facilitator surfaces the SDK (default facilitator: facilitator.arispay.app); point payagent `homepage`/`repository`/`bugs` at the ArisPay monorepo instead of the retired `arispay-inc/payagent` mirror. No code changes. (buyforme got the same metadata fix in-repo, but it is changeset-ignored — it ships on its next manual `pnpm publish`.)

## 2.13.3

### Patch Changes

- 9a11597: docs: sync fee framing to the never-charge policy and make the facilitator discoverable from the agent skill. payagent's README no longer says the facilitator "sponsors gas" (it doesn't — agents sign off-chain, the seller submits and pays chain gas). `@arispay/skill`'s SKILL.md now references `facilitator.arispay.app` as read-only discovery context (USDC + EURC on Base; `payagent` still handles all settlement).

## 2.13.2

### Patch Changes

- 6f48c55: docs: link facilitator.arispay.app from the SDK READMEs — an inbound link so human server-operators and crawlers reach the facilitator's discovery site. paygate gains a "Facilitator" section (it settles there by default: open, USDC + EURC, no fee/no subsidy); payagent's facilitator reference now links the live service (source moved to a secondary link); payagent-mcp lists it under Related.

## 2.13.1

### Patch Changes

- 072044e: Local-signer mode: emit v2 `PaymentPayload.resource` as a `ResourceInfo` object (`{ url }`) per the spec, so payments catalog correctly with bazaar discovery extraction.

## 2.13.0

### Minor Changes

- 7ec4663: Add permissionless local-signer mode: `payFetchLocal({ privateKey })` signs EIP-3009 payments in-process with any funded key — no ArisPay account, API key, or provisioning required. Also: `PAYAGENT_PRIVATE_KEY` one-liner path in the CLI, `payagent/vercel` + `payagent/langchain` accept either signing mode, optional client-side `maxPerTxBaseUnits` cap. Delegated-custody mode is unchanged.

## 2.12.2

### Patch Changes

- da0772d: npm discoverability pass: descriptions and keywords tuned for the queries
  agents and coding assistants actually make ("pay for api", "agent wallet",
  "monetize api", "eurc"/"euro"). paygate and @arispay/payagent-mcp
  descriptions now lead with the USD + EUR settlement capability. Metadata
  only — no code changes.

## 2.12.1

### Patch Changes

- 1131112: Add `payagent connect <CODE>` command for linking an existing BuyForMe wallet to the local config without creating a new wallet.

## 2.12.0

### Minor Changes

- 370c06f: Activity feed surface on `DelegationClient`:

  - `listAgentPayments(agentId, opts?)` — per-wallet activity via `GET /v1/agents/:id/payments`. Cursor-paginated, newest first, `status` / `rail` filters.
  - `listOrgPayments(opts?)` — cross-wallet activity via `GET /v1/payments?scope=org`. Same pagination contract; the SDK passes `scope=org` for the caller.

  New exported types: `PaymentFeedItem`, `PaymentsFeedResponse`, `PaymentsFeedQueryOptions`.

- f95b93f: BuyForMe phone-pairing handoff (Phase 5 of `docs/buyforme-app.md`).

  **`payagent`** — `BootstrapAgentResult` now carries an optional `pairing` block:

  ```ts
  pairing?: {
    url: string;        // Phone-openable; encode as QR
    expiresAt: string;  // 10-minute TTL by default
    qrPayload: string;  // Reserved for a future `buyforme://` deep link; today = url
  }
  ```

  New exported type `BootstrapPairing`. `payagent quickstart` prints the QR + URL on the terminal after bootstrap, so the user can land on `buyforme.arispay.app` already signed in without retyping their email.

  Absent only when running against an older API that pre-dates the Phase-5 pairing route.

  **`@arispay/payagent-mcp`** — the `bootstrap_agent` tool now surfaces the pairing URL in the tool result so AI hosts (Claude Desktop, Cursor, etc.) can pass it to the user.

- 87f1e96: New `DelegationClient.updateAgent(agentId, patch)` method for the general-purpose `PATCH /v1/agents/:id` surface. Accepts `name`, `description`, `callbackUrl`, `defaultMax*`, `sweepThreshold`, `allowedDomains`, and the new `suspended` kill-switch in one call. Returns the hydrated agent (including the refreshed `x402` block) so callers can update their local cache without a follow-up GET.

  `renameAgent` is now a thin wrapper over `updateAgent({ name })`. Behavior unchanged.

- 97a2a85: Server-authoritative wallet listing, agent rename, and bootstrap rehydration — eliminates the orphan-wallet failure mode where a user on a new machine (or with a wiped `~/.payagent/config.json`) was blind to wallets they already owned, and could mint a fresh one on top of funded ones.

  **SDK (`payagent`):**

  - `DelegationClient.listAgents(opts?)` — hits `GET /v1/agents?withDelegation=1`, returns one row per x402 wallet with authoritative `walletAddress`, `network`, limits, `allowedDomains`, `suspended`, `fundedAt`. Balance is fanned out separately via `getBalance(agentId)` to keep the list call cheap.
  - `DelegationClient.renameAgent(agentId, newName)` — PATCHes `/v1/agents/:id`. Server enforces per-org name uniqueness with a 409.
  - `syncAgents({ includeBalance? })` — high-level helper combining `listAgents` + per-wallet balance fanout (optional) + `upsertManyFromServer` write-back to the local cache. Preserves locally-held agent API key plaintexts (the server only stores the SHA-256 hash, so it cannot return them).
  - `upsertManyFromServer(agents)` + `renameStoredAgent(oldName, newName)` exported from the config store.
  - `bootstrapAgent()` result now carries `reused: boolean` and `existingAgents: BootstrapExistingAgent[]` — every wallet under the resolved org. Rehydrates the local cache automatically so a re-bootstrap from a wiped machine recovers the full wallet set, not just the named one.
  - `payagent agent list` is now server-first (`--local` to opt out, `--balance` to fan out balance checks).
  - New `payagent agent rename <old> <new>` subcommand.

  **MCP (`@arispay/payagent-mcp`):**

  - `list_agents` rewritten to call `syncAgents()`. Now returns every wallet under the developer key's org with limits, allowedDomains, and `fundedAt`. Optional `withBalance: true` fans out per-wallet on-chain balance. Falls back to local-cache-only when no developer key is set (preserves legacy `ARISPAY_AGENT_KEY` flow).
  - New `rename_agent({ name, newName })` tool — server-side rename plus local-cache mirror.

## 2.11.0

### Minor Changes

- 15645e4: Add `merchantId` option to `DelegationClient.createPayment` and a `--merchant-id` flag to `payagent pay-merchant`. When set, the payment routes through a PayGate-registered merchant: the API enforces the merchant's `trustMinTier` floor before authorize/capture, and (for Clover-connected merchants) the post-capture order mirror runs. Optional and additive — without it, behavior is unchanged.

## 2.10.0

### Minor Changes

- 98a196f: Read the canonical `payment-required` header (base64) as the primary
  402 challenge source, with fallbacks for variant header names and
  paygate's pre-5.1 legacy emit.

  The 402 parser now tries headers in this order before falling back to
  the body:

  1. `payment-required` — canonical, 95.3% of live x402 endpoints
  2. `x-payment-required` — variant, ~10% of endpoints
  3. `x-payment-requirements` — paygate ≤ 5.0 (one in-house emit)

  Each header value is decoded as base64 first (canonical wire format),
  then parsed as raw JSON if base64 decoding doesn't yield JSON. This
  handles both the canonical encoding and paygate's pre-5.1 raw-JSON
  emit.

  No public API change. The parser was already reading
  `payment-required` as primary; this PR adds the variant + legacy
  fallbacks and tests, audited against 128 live Bazaar-listed
  endpoints (see /docs/x402-wire-format-audit.md in the monorepo).

## 2.9.0

### Minor Changes

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

## 2.8.2

### Patch Changes

- f2bbfd9: Improve PayAgent first-run guidance with status/readiness output, clearer funding handoff, and updated Hermes skill instructions.

## 2.8.1

### Patch Changes

- cfaa200: Fix `payagent doctor` API probe — was hitting `GET /v1/agents/x402` which is POST-only and returns 404 even against perfectly valid keys, making the diagnostic always print "API returned 404 for the stored key" when auth was actually fine. Switched to `GET /v1/agents?limit=1` — 200 = key accepted, 401 = revoked.

## 2.8.0

### Minor Changes

- 9aac5a4: Headless one-shot signup + agent provisioning. Cold-start in a single command — no browser, no prior dashboard account.

  **`payagent` (CLI + SDK)**:

  - New `payagent quickstart --email you@example.com --name polar [--fund 25]` command. Calls the new `POST /v1/bootstrap` endpoint and persists everything to `~/.payagent/config.json`.
  - New `bootstrapAgent({ email, name })` library export — same primitive for in-code use. Returns a ready-to-use agent handle with `.fetch`, `.getBalance`, `.waitUntilFunded`, `.getFundingLink`.
  - New `payagent doctor` command — single-shot diagnostic for binary path, version, key validity, locally-stored agents.
  - `payagent agent create` UX polish: positional name (`payagent agent create polar`), conservative default limits ($0.50/tx, $10/day, $100/month) when none supplied, interactive TTY prompts when only some are.
  - Best-effort version-staleness nudge on every command (opt-out: `PAYAGENT_NO_UPDATE_CHECK=1`). Hard-warns when running a major-version-old binary against the live API.
  - CLI error formatter now scrubs internal route fragments (`/x402-balance`, `/v1/agents/:id/x402-balance`, ...) from user-facing messages and suggests `payagent doctor` / `payagent init` on 401.

  **`@arispay/payagent-mcp`**:

  - New `bootstrap_agent` tool — full developer + agent provisioning in one MCP call. Lets Claude Desktop / Cursor spin up a working agent without ever leaving the host.

  Both packages keep the existing API surface; this is purely additive.

## 2.7.0

### Minor Changes

- 58bfcf5: Add `discover()` — capability-indexed + budget-bounded search over the agent marketplace.

  Wraps `POST /v1/marketplace/discover`. Lets an agent find listings that match a
  capability (or free-text intent) within a USD-cent budget cap and then follow up
  with `payFetchDelegated` against the top candidate's `endpoint.url`.

  ```ts
  import { discover, payFetchDelegated } from "payagent";

  const { candidates } = await discover({
    capability: "flight-search",
    budgetCentsMax: 5,
  });
  ```

  New public exports: `discover`, `DiscoverInput`, `DiscoverResult`,
  `DiscoverCandidate`, `DiscoverEndpoint`, `DiscoverPricing`,
  `DiscoverTransport`, `DiscoverCategory`, `DiscoverSource`, `DiscoverOptions`.

  The candidate shape (including `score`, `source`, `category`, `originUrl`)
  is frozen within the minor — see Component Contract 11 in root CLAUDE.md.

## 2.5.0

### Minor Changes

- 18d485a: Phase 2: Coinbase Onramp for hosted agent top-ups.

  **payagent 2.2.0** adds:

  - **`DelegationClient.getHostedTopup(agentId, { amount? })`** — hits the
    new `POST /v1/agents/:id/hosted-topup` endpoint and returns
    `{ fundingUrl, expiresAt, provider, walletAddress, network }`. Share the
    URL with an end-user; they pay with card / Apple Pay / bank transfer on
    Coinbase's hosted page, and Coinbase deposits USDC straight into the
    agent's CDP wallet. ArisPay never touches the funds.
  - **`HostedTopupNotConfiguredError`** — thrown on 501 responses so
    callers can fall back gracefully to "send USDC manually to this
    address" when the deployment hasn't configured an onramp.
  - **`agent.getFundingLink()`** on `LaunchedAgent`, pre-bound to the
    launched agent.
  - **`payagent agent fund NAME --hosted [AMOUNT]`** — CLI flag to print a
    Coinbase onramp URL instead of the wallet address + QR. Still polls
    until the deposit lands. Falls back silently to the manual flow when
    the API is unconfigured.

  **@arispay/payagent-mcp 2.2.0** extends the `fund_agent` tool with two
  optional params: `hosted: boolean` and `amount: number`. When `hosted`
  is true, the tool returns a Coinbase onramp URL so Claude / Cursor /
  Hermes can relay it to the end-user directly. When the deployment has
  no onramp configured, the tool returns a helpful manual fallback message
  instead of erroring.

  Server side (not part of this changeset — shipped via apps/api):

  - `POST /v1/agents/:id/hosted-topup` no longer returns a blanket 501 —
    when `ARISPAY_ONRAMP_PROVIDER=coinbase` + `COINBASE_ONRAMP_APP_ID` are
    set, it builds a real `https://pay.coinbase.com/buy/...` URL pre-filled
    with the agent's destination wallet, USDC, and Base (or whichever
    `X402_NETWORK` the deployment uses).

  No breaking changes to any existing API. Legacy env-var MCP mode still
  works. Safe to upgrade.

- 95bf10f: Headless launch flow — `npx payagent` CLI, `launchAgent()` SDK sugar, and four new MCP tools.

  **payagent 2.1.0** adds:

  - **`npx payagent` CLI.** A new `bin` entry exposes `init`, `logout`, `whoami`, `agent create|fund|balance|list|remove`, and `pay`. `init` runs an OAuth device-code flow against `POST /v1/auth/device/*` and persists the developer API key to `~/.payagent/config.json` (dir 0700, file 0600).
  - **`launchAgent(config)`** — a new functional entry point that composes `DelegationClient.createX402Agent` + `payFetchDelegated` into a single call returning `{ agentId, walletAddress, apiKey, fetch, getBalance, waitUntilFunded }`. `getLaunchedAgent(name)` rehydrates an agent from the local config store.
  - **Shared config store + device-code helpers.** Re-exported from the main entry so `@arispay/payagent-mcp` can use the same credentials and same flow. Env overrides: `ARISPAY_API_KEY`, `ARISPAY_URL`, `PAYAGENT_CONFIG_DIR`.
  - **`DelegationClient`, `payFetchDelegated`, adapters** — unchanged. No breaking API changes.

  **@arispay/payagent-mcp 2.1.0** adds four new MCP tools alongside the existing `pay_api` and `check_wallet`:

  - `create_agent({ name, perTx, daily, monthly, allowedDomains?, network?, agentType? })` — provisions an x402 agent via `launchAgent` and persists it to the shared config store.
  - `fund_agent({ name })` — returns the wallet address + funding instructions.
  - `get_balance({ name })` — USDC balance + `fundedAt` latch via the developer key.
  - `list_agents()` — enumerate locally-cached agents (no secrets in the response).

  `pay_api` and `check_wallet` gain an optional `agent` parameter. When `ARISPAY_AGENT_KEY` is unset, the MCP falls back to the shared config store, so agents created via the CLI (or the new `create_agent` MCP tool) are immediately usable.

  Legacy env-var mode (`ARISPAY_AGENT_KEY`, `PAYAGENT_WALLET`) remains supported — no migration required for existing MCP clients.

- 4280f24: Make `npx payagent pay <url>` the one-command headless entry point. On a cold machine with no prior setup, `pay` now self-bootstraps through three gates before it runs the paid fetch:

  1. **Auth** — if no developer key exists in `~/.payagent/config.json` (or the `ARISPAY_API_KEY` env var), runs the OAuth device-code flow inline: prints a verification URL + code to stderr and polls until approved.
  2. **Agent** — if the named agent (`--agent`, or the first locally-stored agent, or literal `default`) isn't in the local store, creates one via `launchAgent()` with conservative defaults: $5/tx, $20/day, $100/month, on Base mainnet, allowlisted to the URL's hostname.
  3. **Funding** — if the agent has 0 USDC, asks the API for a Coinbase Onramp URL (via the hosted-topup endpoint) and prints it to stderr. Falls back to the raw wallet address + QR when the deployment has no onramp configured. Polls `waitUntilFunded()` until a deposit lands.

  Only after all three gates pass does `pay` call `payFetchDelegated` and emit the HTTP response body. Progress and prompts go to **stderr**; the response body is the only thing on **stdout**, so `npx payagent pay URL | jq .` works cleanly.

  Previous behaviour (hard errors on missing auth / agent) is gone — the command no longer fails fast with "run `payagent init` first". The advanced subcommands (`init`, `agent create`, `agent fund`) still exist unchanged for users who want to configure things up front.

  New flags on `pay`:

  - `--per-tx`, `--daily`, `--monthly` — override the default $5/$20/$100 limits (in dollars)
  - `--network` — override `base` mainnet default (`base-sepolia`, `ethereum`, `polygon`)
  - `--domains` — override hostname-derived allowlist with a CSV
  - `--amount` — preset the Coinbase Onramp funding amount (USD)

  Also exports `derivePayDefaults()` and `parseAmountCents()` from a new `pay-defaults` module so consumers (and tests) can reuse the default-derivation logic.

  Why this matters: the primary user of payagent is an AI agent running in someone else's shell — a Hermes Telegram bot, a Claude Desktop MCP host, a cron job. Those callers cannot run an interactive `init` → `agent create` → `agent fund` sequence out of band. They have one command they're going to run, and it's `payagent pay <url>`. Now that works from zero.

- 4feec26: Make `payagent`'s signed payloads accepted by upstream x402 v2 merchants (CoinGecko, `@x402/next`-based servers, PaySponge gateway, stabletravel, …).

  x402 v2 merchants match a payment via `deepEqual(paymentRequirements, paymentPayload.accepted)` (`@x402/core`'s `findMatchingRequirements`). Previously the SDK reconstructed `accepted` from a normalised local view of the requirements, which:

  - added a `resource` field merchants don't put inside `accepts[i]`
  - omitted `maxTimeoutSeconds` that merchants do include
  - toggled between `amount` (v2 spec) and `maxAmountRequired` (v1 spec) inconsistently
  - emitted `network` as the short form (`"base"`) when v2 requires CAIP-2 (`"eip155:8453"`)
  - carried redundant top-level `scheme`/`network` fields some strict zod schemas reject

  Net effect: the merchant's deep-equal match silently failed and the response came back as `402` with an empty body. Confirmed against arcticx, CoinGecko, and stabletravel — all rejected before; with this fix, stabletravel returned the live Google Flights data and on-chain USDC settled on Base mainnet from the smoke agent.

  Public surface changes:

  - `parseRequirements()` now also returns `rawAccepts` — the byte-for-byte challenge `accepts[]` array, alongside the normalised `accepts`. Callers that already consume `accepts` are unaffected; `rawAccepts` is additive.
  - `payFetchDelegated()` forwards the chosen raw accept object to ArisPay's `/v1/x402/delegated-sign` as `acceptedRequirement`, so the server can echo it verbatim into `paymentPayload.accepted`.
  - New `PAYAGENT_DEBUG=1` env logs the decoded outgoing X-PAYMENT to stderr (no secrets — the header is already on the wire). Useful for diagnosing merchant rejects.

  Together with `paygate@2.1.0` (which separately bumped to x402 v2 in challenges + settle), this completes the upstream-merchant compatibility work.

- 609470a: Phase 3a: end-user helpers — create customers, attach cards / wallets, set per-user spend limits.

  **payagent 2.3.0** adds to `DelegationClient`:

  - `createEndUser({ externalId, email?, findOrCreate? })` — create or find-or-create a customer (PRD "User" / Prisma `EndUser`) under your developer org.
  - `getEndUser(id)` — fetch by ArisPay-internal id.
  - `createCardSetupSession({ endUserId, agentId? })` — returns `{ token, setupUrl, expiresAt }`. Hand `setupUrl` to the end-user; they enter their card on ArisPay's hosted page. Tokenization + 3DS handled server-side.
  - `getCardSetupStatus(token)` / `pollCardSetup(token, options?)` — one-shot check or poll until terminal (`completed` | `expired` | `failed` | `not_found`).
  - `attachWallet(userId, { walletAddress, chain })` — attach a USDC wallet (base / ethereum / polygon / solana) as a non-custodial rail.
  - `setUserLimits(userId, { agentId, maxPerTransaction?, maxDaily?, maxMonthly?, allowedMerchantCategories?, blockedMerchantCategories? })` — per-user-per-agent spend override. Integer cents.
  - `getWalletStatus(userId)` — USDC balance, allowance, sufficiency, readiness.

  `LaunchedAgent` gains a `setUserLimits(endUserId, options)` convenience that passes `agentId` automatically.

  **CLI** adds a new `user` command group:

  ```
  payagent user create --external-id tg:12345 [--email X] [--find-or-create]
  payagent user attach-card  USER_ID [--agent AGENT]
  payagent user attach-wallet USER_ID --address 0x... --chain base|ethereum|polygon|solana
  payagent user set-limits   USER_ID --agent NAME [--per-tx N] [--daily N] [--monthly N]
                                                  [--allowed-mcc CSV] [--blocked-mcc CSV]
  payagent user status       USER_ID
  ```

  `attach-card` polls the card-setup session and reports when the card is tokenized + 3DS-verified.

  **@arispay/payagent-mcp 2.3.0** gains four end-user tools:

  - `create_enduser({ externalId, email?, findOrCreate? })`
  - `attach_card_for_user({ userId, agentName? })` — returns the hosted URL for the AI agent to relay to the end-user.
  - `set_user_limits({ userId, agentName, perTx?, daily?, monthly?, allowedMcc?, blockedMcc? })`
  - `get_user_status({ userId })` — card + wallet + allowance readiness in one view.

  No new server endpoints; everything wraps existing `/v1/users/*`, `/v1/card-setup-sessions`, and `/v1/users/:id/{payment-methods,limits,wallet-status}`. No breaking changes.

  Prereq for Phase 3b, which will ship `agent.pay(intent)` with rail auto-selection.

- a5b0866: Phase 3b: multi-rail `agent.pay(intent)` for merchant payments.

  **payagent 2.4.0** adds:

  - `DelegationClient.createPayment(agentId, options)` — wraps
    `POST /v1/payments`. Picks the rail server-side (`card`, `crypto`,
    `mpp`, or `balance`) based on agent mode and whether a `userId` is
    supplied. Autonomous agents default to `balance`; platform agents to
    `card`. Explicit `rail` overrides.
  - `LaunchedAgent.pay(options)` — convenience on the agent handle that
    supplies `agentId` automatically.
  - Auto-generated `idempotencyKey` (`payagent-<ts>-<rand>`) if the caller
    doesn't provide one. Explicit keys are always respected.
  - New types exported: `CreatePaymentOptions`, `PaymentResponse`,
    `PaymentStatus`, `PaymentRail`, `PaymentNextAction`.

  **CLI** adds `payagent pay-merchant`:

  ```
  payagent pay-merchant URL --amount $5 --memo "flight booking" \
    [--user USER_ID] [--agent NAME] [--rail card|crypto|balance|mpp]
    [--merchant-name "..."] [--mcc 5411]
  ```

  Prints payment id, status, rail, amount, and any 3DS `nextAction`
  (challenge URL or device-fingerprint form) when `requires_action`.

  **@arispay/payagent-mcp 2.4.0** adds a `pay_merchant` tool with the
  same arguments, so Claude / Cursor / Hermes can create a merchant
  payment in-conversation.

  ## For x402 API calls use `.fetch()` instead

  `.pay()` is for server-side settled transactions through
  `/v1/payments` (card, crypto, MPP, balance). x402-priced HTTP
  resources still go through `agent.fetch(url)` / `payFetchDelegated`,
  which handles the 402 challenge + signing transparently. Both paths
  stay fully supported; the README and CLI help now call out the
  distinction.

  Zero server changes — every method wraps an existing route. No schema
  migration. No new dependencies.
