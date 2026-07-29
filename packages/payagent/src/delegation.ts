/**
 * payagent — DelegationClient.
 *
 * Thin client for the ArisPay delegation API. Lets an integration
 * provision an x402 payer agent (wallet + API key + spend limits),
 * then poll until the wallet is funded before attempting payments.
 *
 * ArisPay returns the API key exactly once at creation — store it
 * securely; the server only stores its SHA-256 hash.
 *
 * @example
 * ```ts
 * const client = new DelegationClient('https://api.arispay.app', process.env.ARISPAY_API_KEY);
 * const agent = await client.createX402Agent({
 *   name: 'hermes-prod',
 *   agentType: 'hermes',
 *   maxPerTx: 100,       // cents
 *   maxDaily: 1000,
 *   maxMonthly: 10000,
 *   allowedDomains: ['api.arcticx.ai'],
 * });
 * console.log('Fund this wallet with USDC on Base:', agent.walletAddress);
 * await client.pollUntilFunded(agent.agentId);
 * ```
 */

export interface X402AgentConfig {
  name: string;
  agentType?: string;
  /** Per-transaction cap in cents. */
  maxPerTx: number;
  /** Daily cap in cents. */
  maxDaily: number;
  /** Monthly cap in cents. */
  maxMonthly: number;
  /** Domains the agent is allowed to pay. Empty = unrestricted on ArisPay side. */
  allowedDomains?: string[];
  description?: string;
  /** EVM network label. Default: 'base' (mainnet). */
  network?: "base" | "base-sepolia" | "ethereum" | "polygon";
}

export interface CreateX402AgentResponse {
  agentId: string;
  walletAddress: string;
  /** API key for this agent — returned ONCE. Store it. */
  apiKey: string;
  status: "pending_funding" | "active";
  limits: { maxPerTx: number; maxDaily: number; maxMonthly: number };
  allowedDomains: string[];
  custody?: "delegated" | "self";
  network?: string;
}

export interface BalanceResponse {
  walletAddress: string;
  /** USDC balance in 6-decimal base units, as a string. */
  usdcBalance: string;
  /** CAIP-2 network identifier. */
  network: string;
  /** ISO timestamp when the wallet first received funds; null until funded. */
  fundedAt: string | null;
}

/**
 * Wallet view of one agent — what `GET /v1/agents?withDelegation=1` returns
 * per row, flattened from the server's `AgentResponse.x402` block. Limits
 * are the authoritative `AgentDelegation` values (not the agent-level
 * defaults), so callers using this to render a "your wallets" surface are
 * looking at the same numbers the x402 signer enforces.
 */
export interface AgentSummary {
  agentId: string;
  name: string;
  walletAddress: string;
  network: string;
  limits: { maxPerTx: number; maxDaily: number; maxMonthly: number };
  allowedDomains: string[];
  custody: "delegated" | "self";
  suspended: boolean;
  /** ISO timestamp of first on-chain deposit; null until funded. */
  fundedAt: string | null;
  /** ISO timestamp of `Agent.createdAt`. */
  createdAt: string;
}

export interface ListAgentsOptions {
  /** Filter by name substring (server-side, case-insensitive). */
  name?: string;
  /** Filter by `Agent.status`. */
  status?: string;
  /** Max results. Server caps at 100. Default 50. */
  limit?: number;
  /** Pagination offset. Default 0. */
  offset?: number;
}

export interface ListAgentsResponse {
  agents: AgentSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface RenameAgentResponse {
  agentId: string;
  name: string;
  walletAddress?: string;
  network?: string;
}

/** Response of `POST /v1/agents/:id/x402-key/rotate`. */
export interface RotateX402KeyResponse {
  agentId: string;
  walletAddress: string;
  network: string;
  /** New plaintext agent key. Returned once — persist it immediately. */
  apiKey: string;
  apiKeyPrefix: string;
  /** False when the previous credential's ApiKey row could not be identified
   *  (some legacy delegations). The old key can no longer sign either way,
   *  but when false it may still authenticate to non-signing org API routes
   *  until that ApiKey is revoked manually. */
  previousKeyRevoked: boolean;
}

/**
 * Patch shape for `PATCH /v1/agents/:id`. Every field optional — only
 * the keys explicitly set are forwarded. Limit fields are cents
 * (money-is-integer-cents); pass `null` to clear an agent-level default
 * back to "inherit". `allowedDomains: []` means unrestricted; passing
 * a populated array replaces the existing set wholesale.
 *
 * On `suspended`, the server requires an existing AgentDelegation row
 * (i.e. the agent must be an x402 payer). The kill-switch toggles the
 * `AgentDelegation.suspended` boolean which the x402 signer enforces.
 */
export interface UpdateAgentPatch {
  name?: string;
  description?: string;
  callbackUrl?: string;
  defaultMaxPerTransaction?: number | null;
  defaultMaxDaily?: number | null;
  defaultMaxMonthly?: number | null;
  sweepThreshold?: number | null;
  allowedDomains?: string[];
  suspended?: boolean;
}

/**
 * One row in the activity feed (`GET /v1/agents/:id/payments` and
 * `GET /v1/payments?scope=org`). Lean shape — the receipt page fetches
 * the full Payment via `GET /v1/payments/:id` and renders shape-aware
 * detail there.
 */
export interface PaymentFeedItem {
  id: string;
  createdAt: string;
  /** `pending` | `processing` | `succeeded` | `failed` | `requires_action`. */
  status: string;
  /** `card` | `crypto` | `balance` | `x402` | `mpp` — depends on settlement path. */
  rail: string;
  amount: number;
  currency: string;
  merchantUrl: string | null;
  merchantName: string | null;
  memo: string;
  errorCode: string | null;
  txHash: string | null;
  x402FacilitatorTx: string | null;
  fiservTxId: string | null;
  agent: { id: string; name: string } | null;
}

export interface PaymentsFeedResponse {
  payments: PaymentFeedItem[];
  nextCursor: string | null;
}

export interface PaymentsFeedQueryOptions {
  status?: string;
  rail?: string;
  cursor?: string;
  /** Server caps at 100. Default 25. */
  limit?: number;
}

/**
 * Server response is the standard `AgentResponse` with delegation
 * hydrated (the route always hydrates the full delegation row in the
 * PATCH response so callers can refresh their cache without a follow-up
 * GET — see Contract 3 in CLAUDE.md).
 */
export interface UpdateAgentResponse {
  id: string;
  name: string;
  description: string | null;
  status: string;
  mode: string;
  x402?: {
    walletAddress: string;
    network: string;
    maxPerTx: number;
    maxDaily: number;
    maxMonthly: number;
    allowedDomains: string[];
    custody: "delegated" | "self";
    suspended: boolean;
    fundedAt: string | null;
  };
}

export interface HostedTopupResponse {
  /** Browser-openable URL that lets an end-user top up this agent's wallet. */
  fundingUrl: string;
  /** ISO timestamp the URL is treated as valid until. */
  expiresAt: string;
  /** Which onramp the URL points at (`coinbase` today). */
  provider: "coinbase" | "fiserv" | "stripe";
  /** Destination address — useful as a fallback if the user wants to send USDC manually. */
  walletAddress: string;
  /** Short network label (`base`, `base-sepolia`, ...). */
  network: string;
}

export interface HostedTopupOptions {
  /** Preset amount, in dollars (USDC is 1:1 USD on the onramp). Optional. */
  amount?: number;
}

/** Raised when the server returns 501 because `ARISPAY_ONRAMP_PROVIDER` is unset. */
export class HostedTopupNotConfiguredError extends Error {
  readonly walletAddress?: string;
  readonly network?: string;
  constructor(message: string, walletAddress?: string, network?: string) {
    super(message);
    this.name = "HostedTopupNotConfiguredError";
    this.walletAddress = walletAddress;
    this.network = network;
  }
}

// ── End-user helpers (Phase 3) ─────────────────────────────────────────────

export interface EndUserResponse {
  id: string;
  externalId: string;
  email?: string | null;
  hasPaymentMethod: boolean;
  hasWallet: boolean;
  cardLast4?: string | null;
  cardBrand?: string | null;
  walletAddress?: string | null;
  walletChain?: string | null;
  createdAt: string;
}

export interface CreateEndUserOptions {
  externalId: string;
  email?: string;
  /** If true, return the existing user instead of erroring when externalId collides. */
  findOrCreate?: boolean;
}

export interface CardSetupSessionResponse {
  /** Plaintext token — returned exactly once. The SDK uses it to poll status. */
  token: string;
  /** Hosted URL the end-user opens in a browser. */
  setupUrl: string;
  /** ISO timestamp. The session is single-use and expires in 15 minutes server-side. */
  expiresAt: string;
}

export type CardSetupStatus =
  | "pending"
  | "tokenized"
  | "verifying"
  | "completed"
  | "expired"
  | "failed"
  | "not_found";

export interface CardSetupStatusResponse {
  status: CardSetupStatus;
  cardLast4?: string;
  cardBrand?: string;
  completedAt?: string;
}

export type WalletChain = "ethereum" | "base" | "polygon" | "solana";

export interface AttachWalletOptions {
  walletAddress: string;
  chain: WalletChain;
}

export interface WalletPaymentMethodResponse {
  walletAddress: string;
  chain: WalletChain;
  spenderAddress: string;
  usdcContractAddress: string;
}

export interface WalletStatusResponse {
  walletAddress: string;
  chain: WalletChain;
  spenderAddress: string;
  usdcContractAddress: string;
  /** USDC balance in 6-decimal base units, as a string. */
  usdcBalance: string;
  /** USDC allowance granted to ArisPay's spender, as a string. */
  usdcAllowance: string;
  allowanceSufficient: boolean;
  ready: boolean;
}

export interface SetUserLimitsOptions {
  agentId: string;
  /** Per-transaction cap in cents. Null/undefined = inherit agent default. */
  maxPerTransaction?: number | null;
  maxDaily?: number | null;
  maxMonthly?: number | null;
  /** Merchant Category Codes the agent is allowed to pay for this user. */
  allowedMerchantCategories?: string[];
  /** Merchant Category Codes explicitly blocked. */
  blockedMerchantCategories?: string[];
}

export interface SpendLimitResponse {
  id: string;
  endUserId: string;
  agentId: string;
  maxPerTransaction: number | null;
  maxDaily: number | null;
  maxMonthly: number | null;
  allowedMCCs: string[];
  blockedMCCs: string[];
}

// ── Payments (Phase 3b) ────────────────────────────────────────────────────

export type PaymentRail = "card" | "crypto" | "balance" | "mpp" | "x402";
export type PaymentStatus = "succeeded" | "processing" | "requires_action" | "failed";

export interface PaymentNextAction {
  type: "three_ds_method" | "three_ds_challenge";
  methodForm?: string;
  challengeUrl?: string;
  challengePayload?: string;
}

export interface CreatePaymentOptions {
  /** Integer cents. Required. Always USD-denominated. */
  amount: number;
  /** ISO-4217 currency code. 'USD' is the only rail-supported value today. */
  currency?: string;
  /** Short human-readable memo — stored on the Payment row, surfaced in webhooks + audit. */
  memo: string;
  /** Required for platform-mode (user-scoped) payments. Agent-internal id. */
  userId?: string;
  /**
   * Force a specific rail. Default:
   *   - Autonomous agents (no userId) → `balance`
   *   - Platform agents (with userId) → `card`
   * Use `x402` from `agent.fetch()` paths instead — `agent.pay()` is for
   * card / crypto / MPP / balance flows through `POST /v1/payments`.
   */
  rail?: PaymentRail;
  merchantUrl?: string;
  merchantName?: string;
  merchantCategoryCode?: string;
  /**
   * PayGate-registered merchant id (`mer_...`). When set, the payment is
   * routed through that merchant: trust-tier gate is enforced before
   * authorize/capture, and (for Clover-connected merchants) the Clover
   * order mirror fires after capture. Optional — without it, the payment
   * is just a regular agent → URL transaction.
   */
  merchantId?: string;
  /** Globally unique. Auto-generated if omitted. */
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  /** For crypto rail: token + chain + recipient. */
  token?: string;
  chain?: WalletChain;
  recipientAddress?: string;
}

/**
 * Spend-limit headroom on successful payment responses. Integer cents;
 * counters include the payment they ride on. Null caps = no limit enforced
 * for that period. Server-optional — absent on older API deployments.
 */
export interface PaymentSpendInfo {
  amountCents: number;
  dailySpend: number;
  monthlySpend: number;
  limits: { maxPerTx: number | null; maxDaily: number | null; maxMonthly: number | null };
  remainingDaily: number | null;
  remainingMonthly: number | null;
}

export interface PaymentResponse {
  id: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  rail: PaymentRail;
  merchantUrl?: string | null;
  merchantName?: string | null;
  memo: string;
  agentId: string;
  userId?: string | null;
  tapNonce?: string;
  cardNetwork?: string;
  txHash?: string;
  chain?: string;
  token?: string;
  x402Chain?: string;
  x402PayeeAddress?: string;
  x402PaymentHeader?: string;
  x402FacilitatorTx?: string;
  paymentMode: "platform" | "autonomous";
  createdAt: string;
  error?: { code: string; message: string };
  nextAction?: PaymentNextAction;
  spend?: PaymentSpendInfo;
}

// ── Wallet-centric sub-wallets (non-x402) ─────────────────────────────────

export interface CreateWalletOptions {
  name: string;
  description?: string;
  perTx?: number;
  daily?: number;
  monthly?: number;
  allowedDomains?: string[];
}

export interface WalletResponse {
  id: string;
  name: string;
  description: string | null;
  status: string;
  balance: number;
  balanceCurrency: string;
  limits: {
    perTx: number | null;
    daily: number | null;
    monthly: number | null;
  };
  createdAt: string;
}

export interface WalletListResponse {
  wallets: WalletResponse[];
}

export interface WalletBalanceResponse {
  wallet: WalletResponse;
  fundingAccounts: Array<{
    id: string;
    currency: string;
    balance: number;
    kind: string;
    accountIdentifier: string | null;
    provider: string | null;
  }>;
}

/**
 * Time-ordered unique id for idempotency. Not cryptographically random —
 * just enough to avoid collisions across concurrent SDK callers in a single
 * process. Shape: `payagent-<base36 timestamp>-<6-char base36 random>`.
 */
function randomIdempotencyKey(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 0xfffffff)
    .toString(36)
    .padStart(6, "0");
  return `payagent-${ts}-${rnd}`;
}

function paymentsFeedQuery(
  opts: PaymentsFeedQueryOptions,
  base: Record<string, string> = {},
): string {
  const params = new URLSearchParams(base);
  if (opts.status) params.set("status", opts.status);
  if (opts.rail) params.set("rail", opts.rail);
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  return params.toString();
}

export class DelegationClient {
  private readonly baseUrl: string;
  private readonly authToken: string;

  constructor(baseUrl: string, authToken: string) {
    if (!baseUrl) throw new Error("DelegationClient: baseUrl is required");
    if (!authToken) throw new Error("DelegationClient: authToken is required");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.authToken = authToken;
  }

  /** Create an x402 payer agent. Returns wallet address + one-time API key. */
  async createX402Agent(config: X402AgentConfig): Promise<CreateX402AgentResponse> {
    return this.request<CreateX402AgentResponse>("POST", "/v1/agents/x402", config);
  }

  /** Create a wallet-centric sub-wallet (no on-chain x402 wallet). */
  async createWallet(options: CreateWalletOptions): Promise<WalletResponse> {
    return this.request<WalletResponse>("POST", "/v1/wallets", options);
  }

  /** List sub-wallets for the authenticated developer user. */
  async listWallets(): Promise<WalletListResponse> {
    return this.request<WalletListResponse>("GET", "/v1/wallets");
  }

  /** Get a sub-wallet plus its master funding-account balances. */
  async getWalletBalance(walletId: string): Promise<WalletBalanceResponse> {
    return this.request<WalletBalanceResponse>("GET", `/v1/wallets/${encodeURIComponent(walletId)}/balance`);
  }

  /** Fetch the on-chain USDC balance for a delegation's wallet. */
  async getBalance(agentId: string): Promise<BalanceResponse> {
    return this.request<BalanceResponse>(
      "GET",
      `/v1/agents/${encodeURIComponent(agentId)}/x402-balance`,
    );
  }

  /**
   * Per-wallet activity feed. Cursor-paginated, newest first, scoped
   * to the agent's org. Use for "show recent activity on this wallet"
   * surfaces (BuyForMe wallet detail, future CLI `payagent payments`).
   */
  async listAgentPayments(
    agentId: string,
    options: PaymentsFeedQueryOptions = {},
  ): Promise<PaymentsFeedResponse> {
    const params = paymentsFeedQuery(options);
    const path = `/v1/agents/${encodeURIComponent(agentId)}/payments${params ? `?${params}` : ""}`;
    return this.request<PaymentsFeedResponse>("GET", path);
  }

  /**
   * Cross-wallet activity feed for the developer key's org. The
   * `scope=org` query parameter is required server-side — we pass it
   * for the caller because it's the only meaningful scope today.
   */
  async listOrgPayments(options: PaymentsFeedQueryOptions = {}): Promise<PaymentsFeedResponse> {
    const params = paymentsFeedQuery(options, { scope: "org" });
    return this.request<PaymentsFeedResponse>("GET", `/v1/payments?${params}`);
  }

  /**
   * Server-authoritative wallet listing — every agent under the developer
   * key's org that has an x402 wallet. Use this from the MCP / CLI rather
   * than reading `~/.payagent/config.json` directly: the local file is a
   * cache that goes stale (new machine, re-bootstrap), and a stale cache
   * is how end-users end up minting fresh wallets and orphaning their
   * funded ones. Balance is intentionally NOT included — fan out to
   * `getBalance(agentId)` only for wallets you actually need to display
   * live, to keep the list call cheap.
   */
  async listAgents(options: ListAgentsOptions = {}): Promise<ListAgentsResponse> {
    const params = new URLSearchParams({ withDelegation: "1" });
    if (options.name) params.set("name", options.name);
    if (options.status) params.set("status", options.status);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    const raw = await this.request<{
      agents: Array<{
        id: string;
        name: string;
        x402?: {
          walletAddress: string;
          network: string;
          maxPerTx: number;
          maxDaily: number;
          maxMonthly: number;
          allowedDomains: string[];
          custody: "delegated" | "self";
          suspended: boolean;
          fundedAt: string | null;
        };
        createdAt: string;
      }>;
      total: number;
      limit: number;
      offset: number;
    }>("GET", `/v1/agents?${params.toString()}`);

    // Drop agents that have no `AgentDelegation` row — they're not x402
    // payers and don't have a wallet to surface in this view.
    const agents: AgentSummary[] = raw.agents
      .filter((a) => a.x402)
      .map((a) => ({
        agentId: a.id,
        name: a.name,
        walletAddress: a.x402!.walletAddress,
        network: a.x402!.network,
        limits: {
          maxPerTx: a.x402!.maxPerTx,
          maxDaily: a.x402!.maxDaily,
          maxMonthly: a.x402!.maxMonthly,
        },
        allowedDomains: a.x402!.allowedDomains,
        custody: a.x402!.custody,
        suspended: a.x402!.suspended,
        fundedAt: a.x402!.fundedAt,
        createdAt: a.createdAt,
      }));

    return { agents, total: raw.total, limit: raw.limit, offset: raw.offset };
  }

  /**
   * Rename an agent. Server enforces per-org name uniqueness (the bootstrap
   * recovery path keys on `(orgId, name)`, so duplicate names would silently
   * flip which agent the next bootstrap reuses). Throws on a 409 conflict.
   *
   * Thin wrapper over `updateAgent({ name })` kept for compatibility and
   * because rename is the most-common patch from the CLI/MCP surface.
   */
  async renameAgent(agentId: string, newName: string): Promise<RenameAgentResponse> {
    const updated = await this.updateAgent(agentId, { name: newName });
    return {
      agentId: updated.id,
      name: updated.name,
      walletAddress: updated.x402?.walletAddress,
      network: updated.x402?.network,
    };
  }

  /**
   * General-purpose agent patch — rename, limits, allowedDomains, and
   * the suspend kill-switch all flow through here. The patch is sent
   * as-is to `PATCH /v1/agents/:id`; only the keys you set are touched.
   * Server enforces:
   *   - name uniqueness per org (409 on conflict)
   *   - maxPerTx ≤ maxDaily ≤ maxMonthly (400 on violation)
   *   - `suspended` requires an existing AgentDelegation row (400 otherwise)
   *
   * Returns the hydrated agent (including the refreshed `x402` block)
   * so callers can update their local cache without a follow-up GET.
   */
  async updateAgent(agentId: string, patch: UpdateAgentPatch): Promise<UpdateAgentResponse> {
    return this.request<UpdateAgentResponse>(
      "PATCH",
      `/v1/agents/${encodeURIComponent(agentId)}`,
      patch,
    );
  }

  /**
   * Rotate an x402 agent's delegation key — the recovery path when the
   * agent key from `createX402Agent` / bootstrap is lost. The server mints
   * a fresh agent key and returns the new plaintext ONCE — it is never
   * recoverable afterwards, so persist it immediately. Wallet, network,
   * limits, allowedDomains, spend counters, and suspension are untouched.
   *
   * Revocation of the previous credential is two-layered and the second
   * layer is CONDITIONAL: the old key always stops working for delegated
   * signing, and its org ApiKey record is additionally revoked when the
   * server can identify it — reported via `previousKeyRevoked`. When
   * `previousKeyRevoked` is `false` (some legacy delegations), the old key
   * can no longer sign but MAY STILL AUTHENTICATE to non-signing org API
   * routes until you revoke that ApiKey manually (dashboard → API keys).
   *
   * Requires a developer management credential (or a dashboard session).
   * Agent-scoped keys are rejected with 403 — an agent key cannot rotate
   * itself or any sibling agent. A concurrent rotation of the same agent
   * returns 409 `ROTATION_CONFLICT` for the loser; the winner's key is
   * unaffected.
   */
  async rotateX402Key(agentId: string): Promise<RotateX402KeyResponse> {
    return this.request<RotateX402KeyResponse>(
      "POST",
      `/v1/agents/${encodeURIComponent(agentId)}/x402-key/rotate`,
    );
  }

  /**
   * Request a hosted top-up URL (Coinbase Onramp, etc.) for this agent.
   *
   * Returns `{ fundingUrl, provider, walletAddress, network, expiresAt }`.
   * The caller (CLI, MCP, bot) shares the URL with an end-user who pays
   * with card / Apple Pay / bank transfer; the onramp deposits USDC
   * straight into the agent's CDP wallet. ArisPay never touches the funds.
   *
   * Throws `HostedTopupNotConfiguredError` (with 501 status) when the
   * deployment hasn't set `ARISPAY_ONRAMP_PROVIDER`, so callers can
   * gracefully fall back to "send USDC manually to this address".
   */
  async getHostedTopup(
    agentId: string,
    options: HostedTopupOptions = {},
  ): Promise<HostedTopupResponse> {
    const body: Record<string, unknown> = {};
    if (options.amount !== undefined) body.amount = options.amount;
    try {
      return await this.request<HostedTopupResponse>(
        "POST",
        `/v1/agents/${encodeURIComponent(agentId)}/hosted-topup`,
        body,
      );
    } catch (err) {
      // Re-type a 501 into a dedicated error so callers can branch cleanly.
      if (err instanceof Error && /\(501\)/.test(err.message)) {
        throw new HostedTopupNotConfiguredError(err.message);
      }
      throw err;
    }
  }

  /**
   * Poll `getBalance` until the wallet shows non-zero USDC (i.e. `fundedAt` latches).
   *
   * @param agentId The agent ID returned from createX402Agent.
   * @param options.intervalMs Poll interval (default 5000).
   * @param options.timeoutMs Give up after this many ms (default 10 minutes). Pass 0 for no timeout.
   */
  async pollUntilFunded(
    agentId: string,
    options: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<BalanceResponse> {
    const interval = options.intervalMs ?? 5000;
    const timeout = options.timeoutMs ?? 10 * 60 * 1000;
    const deadline = timeout > 0 ? Date.now() + timeout : Number.POSITIVE_INFINITY;

    while (true) {
      const balance = await this.getBalance(agentId);
      if (balance.fundedAt || BigInt(balance.usdcBalance || "0") > 0n) {
        return balance;
      }
      if (Date.now() + interval > deadline) {
        throw new Error(
          `pollUntilFunded: timed out after ${timeout}ms waiting for funding of ${agentId}`,
        );
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  // ── End-user helpers (Phase 3) ───────────────────────────────────────────

  /** Create (or find-or-create) an end-user. `externalId` is your own id for this customer. */
  async createEndUser(options: CreateEndUserOptions): Promise<EndUserResponse> {
    return this.request<EndUserResponse>("POST", "/v1/users", options);
  }

  /** Fetch an end-user by internal id. */
  async getEndUser(id: string): Promise<EndUserResponse> {
    return this.request<EndUserResponse>("GET", `/v1/users/${encodeURIComponent(id)}`);
  }

  /** Fetch an end-user by the developer's external id. */
  async getEndUserByExternalId(externalId: string): Promise<EndUserResponse> {
    return this.request<EndUserResponse>(
      "GET",
      `/v1/users/by-external/${encodeURIComponent(externalId)}`,
    );
  }

  /**
   * Create a hosted card-setup session for an end-user. Returns a URL you share
   * with the end-user; they open it in a browser, enter their card, and ArisPay's
   * hosted page handles tokenization + 3DS. Poll `getCardSetupStatus` or
   * `pollCardSetup` to detect completion.
   */
  async createCardSetupSession(options: {
    endUserId: string;
    agentId?: string;
  }): Promise<CardSetupSessionResponse> {
    return this.request<CardSetupSessionResponse>("POST", "/v1/card-setup-sessions", options);
  }

  /** One-shot status check for a card-setup session. */
  async getCardSetupStatus(token: string): Promise<CardSetupStatusResponse> {
    return this.request<CardSetupStatusResponse>(
      "GET",
      `/v1/card-setup-sessions/${encodeURIComponent(token)}/status`,
    );
  }

  /**
   * Poll `getCardSetupStatus` until the session reaches a terminal state
   * (`completed`, `expired`, `failed`, or `not_found`) or the timeout elapses.
   */
  async pollCardSetup(
    token: string,
    options: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<CardSetupStatusResponse> {
    const interval = options.intervalMs ?? 3000;
    const timeout = options.timeoutMs ?? 15 * 60 * 1000;
    const deadline = timeout > 0 ? Date.now() + timeout : Number.POSITIVE_INFINITY;
    const terminal: CardSetupStatus[] = ["completed", "expired", "failed", "not_found"];

    while (true) {
      const status = await this.getCardSetupStatus(token);
      if (terminal.includes(status.status)) {
        return status;
      }
      if (Date.now() + interval > deadline) {
        throw new Error(
          `pollCardSetup: timed out after ${timeout}ms waiting for card-setup session`,
        );
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  /** Attach a USDC wallet to an end-user as a payment method (non-custodial rail). */
  async attachWallet(
    endUserId: string,
    options: AttachWalletOptions,
  ): Promise<WalletPaymentMethodResponse> {
    return this.request<WalletPaymentMethodResponse>(
      "POST",
      `/v1/users/${encodeURIComponent(endUserId)}/payment-methods`,
      { type: "wallet", ...options },
    );
  }

  /**
   * Set per-user, per-agent spend limits. Overrides the agent defaults for
   * this specific end-user + agent pair.
   */
  async setUserLimits(
    endUserId: string,
    options: SetUserLimitsOptions,
  ): Promise<SpendLimitResponse> {
    return this.request<SpendLimitResponse>(
      "PUT",
      `/v1/users/${encodeURIComponent(endUserId)}/limits`,
      options,
    );
  }

  /** Current wallet state for a wallet-attached end-user: balance, allowance, readiness. */
  async getWalletStatus(endUserId: string): Promise<WalletStatusResponse> {
    return this.request<WalletStatusResponse>(
      "GET",
      `/v1/users/${encodeURIComponent(endUserId)}/wallet-status`,
    );
  }

  /**
   * Create a payment from an agent (and optionally an end-user) to a merchant.
   * Picks the rail server-side based on `rail`, agent mode, and whether a
   * `userId` is supplied. Autonomous agents pay from their ledger balance by
   * default; platform agents pay via their end-user's card (or crypto / MPP).
   *
   * For x402-priced API calls, use `agent.fetch(url)` instead — that path
   * handles the 402 challenge + signing transparently and is the right tool
   * for buying a single HTTP resource.
   *
   * An `idempotencyKey` is auto-generated if not provided. Callers who need
   * end-to-end idempotency across retries should supply their own.
   */
  async createPayment(agentId: string, options: CreatePaymentOptions): Promise<PaymentResponse> {
    const body = {
      agentId,
      userId: options.userId,
      amount: options.amount,
      currency: options.currency ?? "USD",
      memo: options.memo,
      merchantUrl: options.merchantUrl,
      merchantName: options.merchantName,
      merchantCategoryCode: options.merchantCategoryCode,
      merchantId: options.merchantId,
      rail: options.rail,
      idempotencyKey: options.idempotencyKey ?? randomIdempotencyKey(),
      metadata: options.metadata,
      token: options.token,
      chain: options.chain,
      recipientAddress: options.recipientAddress,
    };
    return this.request<PaymentResponse>("POST", "/v1/payments", body);
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (!res.ok) {
      const message =
        (parsed &&
          typeof parsed === "object" &&
          "error" in parsed &&
          (parsed as { error?: { message?: string } }).error?.message) ||
        (typeof parsed === "string" ? parsed : res.statusText);
      throw new Error(`ArisPay ${method} ${path} failed (${res.status}): ${message}`);
    }

    return parsed as T;
  }
}
