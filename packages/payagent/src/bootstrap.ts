/**
 * payagent — `bootstrapAgent()` headless one-shot.
 *
 * Hits the unauthenticated `POST /v1/bootstrap` endpoint, which mints a
 * developer account, an Organization, an `ap_live_` developer key, an
 * Agent (CDP wallet provisioned), and an agent-scoped key — all in one
 * call. Persists the result to `~/.payagent/config.json` so subsequent
 * CLI invocations (`payagent agent fund`, `payagent pay`) and MCP tool
 * calls pick up the same credentials.
 *
 * This is the library twin of `payagent quickstart` (CLI) and
 * `bootstrap_agent` (MCP tool). All three share this primitive.
 *
 * Defaults (sandbox-style limits, override-able):
 *   - perTx:   $0.50  (50 cents)
 *   - daily:   $10    (1000 cents)
 *   - monthly: $100   (10000 cents)
 *
 * The CLI surfaces these in its output; agents calling
 * `bootstrapAgent({ email, name: 'polar' })` cold get a working agent
 * with conservative caps.
 *
 * After this returns, fund the wallet:
 *   - Send USDC on the returned `network` to `walletAddress`, or
 *   - If `fund: <USD>` was passed and the deployment has Coinbase Onramp
 *     wired (`ARISPAY_ONRAMP_PROVIDER=coinbase`), the response carries a
 *     `fundingUrl` you can hand to a human to complete fiat → USDC.
 */

import {
  DEFAULT_ARISPAY_URL,
  type StoredAgent,
  loadConfig,
  saveAgent,
  saveConfig,
  setApiKey,
  upsertManyFromServer,
} from "./config-store.js";
import {
  type BalanceResponse,
  type CreateX402AgentResponse,
  DelegationClient,
  type HostedTopupOptions,
  type HostedTopupResponse,
} from "./delegation.js";
import { type PayFetchFn, payFetchDelegated } from "./fetch-delegated.js";

export interface BootstrapAgentConfig {
  /** Lowercased email. Server validates shape and rejects duplicates with a different sign-in method. */
  email: string;
  /** Optional human name. Falls back to email local-part. */
  name?: string;
  /** Optional org / workspace name. Falls back to `<name>'s Team`. */
  orgName?: string;
  /** Local agent name. Defaults to `default`. */
  agentName?: string;
  /** Optional override of the conservative defaults. All values in cents. */
  limits?: {
    perTx?: number;
    daily?: number;
    monthly?: number;
  };
  /** Domains the agent may pay. Empty = unrestricted at ArisPay. */
  allowedDomains?: string[];
  /** Optional metadata label (surfaces on the dashboard). */
  agentType?: string;
  description?: string;
  /**
   * If set, the server pre-mints a Coinbase Onramp URL preset to this
   * USD amount. Requires `ARISPAY_ONRAMP_PROVIDER=coinbase` on the API.
   * Falls back gracefully when not configured — `fundingUrl` will be
   * absent and `fundingUrlError` populated.
   */
  fund?: number;
  /** Optional override for the ArisPay base URL. */
  arispayUrl?: string;
  /** Optional client identifier — written to the API-key label for support. */
  clientId?: string;
  /** If true, do not persist credentials/agent to `~/.payagent/config.json`. Default false. */
  ephemeral?: boolean;
}

/** Pairing handoff metadata for the BuyForMe phone surface. */
export interface BootstrapPairing {
  /** Phone-openable URL embedding the single-use code. Print as QR. */
  url: string;
  /** ISO timestamp the URL is treated as valid until. */
  expiresAt: string;
  /** Payload to encode in the QR. Today identical to `url`; reserved for a future `buyforme://` deep link. */
  qrPayload: string;
}

/** One wallet under the developer org, returned in the bootstrap response. */
export interface BootstrapExistingAgent {
  agentId: string;
  name: string;
  walletAddress: string;
  network: string;
  limits: { maxPerTx: number; maxDaily: number; maxMonthly: number };
  allowedDomains: string[];
  custody: "delegated";
  suspended: boolean;
  /** ISO timestamp of first on-chain deposit; null until funded. */
  fundedAt: string | null;
  createdAt: string;
}

export interface BootstrapAgentResult {
  // Developer credentials
  developerKey: string;
  userId: string;
  orgId: string;
  orgName: string;
  email: string;
  // Agent credentials
  agentId: string;
  agentName: string;
  agentApiKey: string;
  walletAddress: string;
  network: "base" | "base-sepolia" | "ethereum" | "polygon";
  limits: { perTx: number; daily: number; monthly: number };
  allowedDomains: string[];
  custody: "delegated";
  status: "pending_funding" | "active";
  environment: "production";
  /**
   * True when the server reused an existing agent on `(orgId, agentName)`
   * rather than creating a new one. Recovery flows can use this to decide
   * whether to print "welcome back" or "wallet provisioned" messaging.
   */
  reused: boolean;
  /**
   * Every wallet under the just-resolved org. On a fresh signup this is a
   * single-element array; on re-bootstrap from a wiped local cache it's
   * everything the user owns — so callers (CLI, MCP) can rehydrate the
   * local `~/.payagent/config.json` in one shot rather than orphaning
   * funded wallets they never knew were there.
   */
  existingAgents: BootstrapExistingAgent[];
  /**
   * Pairing URL + expiry for the BuyForMe phone handoff. Print as a QR
   * + clickable link so the user can land in the PWA already signed in
   * (rather than retyping their email on the phone).
   *
   * Absent only when running against an older API that pre-dates the
   * Phase-5 pairing route; the CLI / MCP fall back to "sign in with
   * your email on the phone" if undefined.
   */
  pairing?: BootstrapPairing;
  // Optional funding
  fundingUrl?: string;
  fundingExpiresAt?: string;
  fundingProvider?: string;
  fundingUrlError?: string;
  /** Pre-bound `payFetchDelegated` configured with this agent's key. */
  fetch: PayFetchFn;
  /** One-shot on-chain balance + fundedAt. */
  getBalance: () => Promise<BalanceResponse>;
  /** Resolves once the wallet first receives USDC, or rejects on timeout. */
  waitUntilFunded: (options?: {
    intervalMs?: number;
    timeoutMs?: number;
  }) => Promise<BalanceResponse>;
  /** Mint a fresh Coinbase Onramp URL post-bootstrap. */
  getFundingLink: (options?: HostedTopupOptions) => Promise<HostedTopupResponse>;
}

interface BootstrapServerResponse {
  developerKey: string;
  userId: string;
  orgId: string;
  orgName: string;
  email: string;
  agentId: string;
  agentName: string;
  agentApiKey: string;
  walletAddress: string;
  network: string;
  limits: { maxPerTx: number; maxDaily: number; maxMonthly: number };
  allowedDomains: string[];
  custody: string;
  status: string;
  environment: string;
  reused?: boolean;
  existingAgents?: BootstrapExistingAgent[];
  pairing?: BootstrapPairing;
  fundingUrl?: string;
  fundingExpiresAt?: string;
  fundingProvider?: string;
  fundingUrlError?: string;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export class BootstrapError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "BootstrapError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Provision a developer + agent in one network call. No prior credentials
 * required — this is the cold-start primitive.
 */
export async function bootstrapAgent(config: BootstrapAgentConfig): Promise<BootstrapAgentResult> {
  const baseUrl = (config.arispayUrl ?? DEFAULT_ARISPAY_URL).replace(/\/$/, "");

  const body: Record<string, unknown> = {
    email: config.email,
    clientId: config.clientId ?? "payagent-cli",
  };
  if (config.name) body.name = config.name;
  if (config.orgName) body.orgName = config.orgName;
  if (config.agentName) body.agentName = config.agentName;
  if (config.limits?.perTx !== undefined) body.maxPerTx = config.limits.perTx;
  if (config.limits?.daily !== undefined) body.maxDaily = config.limits.daily;
  if (config.limits?.monthly !== undefined) body.maxMonthly = config.limits.monthly;
  if (config.allowedDomains?.length) body.allowedDomains = config.allowedDomains;
  if (config.agentType) body.agentType = config.agentType;
  if (config.description) body.description = config.description;
  if (config.fund !== undefined) body.fund = config.fund;

  const res = await fetch(`${baseUrl}/v1/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = (await safeJson(res)) as ApiErrorBody | undefined;
    const code = errBody?.error?.code ?? "BOOTSTRAP_FAILED";
    const message = errBody?.error?.message ?? `${res.statusText} (HTTP ${res.status})`;
    throw new BootstrapError(res.status, code, message);
  }

  const server = (await res.json()) as BootstrapServerResponse;

  const network = (server.network as BootstrapAgentResult["network"]) ?? "base";
  const limits = {
    perTx: server.limits.maxPerTx,
    daily: server.limits.maxDaily,
    monthly: server.limits.maxMonthly,
  };

  const existingAgents = server.existingAgents ?? [];

  // Persist credentials + the new agent so the rest of the CLI/MCP just
  // works against the shared config store.
  if (!config.ephemeral) {
    setApiKey(server.developerKey);
    if (config.arispayUrl && config.arispayUrl !== DEFAULT_ARISPAY_URL) {
      const cfg = loadConfig();
      saveConfig({ ...cfg, arispayUrl: config.arispayUrl });
    }
    const stored: StoredAgent = {
      agentId: server.agentId,
      name: server.agentName,
      walletAddress: server.walletAddress,
      apiKey: server.agentApiKey,
      limits,
      allowedDomains: server.allowedDomains,
      network,
      createdAt: new Date().toISOString(),
    };
    saveAgent(stored);

    // Rehydrate every OTHER wallet the user owns under this org. Without
    // this, a user on a new machine who re-bootstraps gets back the named
    // agent but stays blind to any prior wallets — exactly the orphan-
    // wallet scenario we're protecting against. The merge preserves any
    // locally-cached agent API key (server has only the hash); newly
    // surfaced agents land with an empty `apiKey` and need an explicit
    // `create_agent` / re-bootstrap to mint a usable key.
    const knownNetworks: ReadonlyArray<StoredAgent["network"]> = [
      "base",
      "base-sepolia",
      "ethereum",
      "polygon",
    ];
    const others = existingAgents
      .filter((a) => a.agentId !== server.agentId)
      .map<StoredAgent>((a) => {
        const net = (knownNetworks as readonly string[]).includes(a.network)
          ? (a.network as StoredAgent["network"])
          : undefined;
        return {
          agentId: a.agentId,
          name: a.name,
          walletAddress: a.walletAddress,
          apiKey: "",
          limits: {
            perTx: a.limits.maxPerTx,
            daily: a.limits.maxDaily,
            monthly: a.limits.maxMonthly,
          },
          allowedDomains: a.allowedDomains,
          network: net,
          createdAt: a.createdAt,
        };
      });
    if (others.length) {
      upsertManyFromServer(others);
    }
  }

  // Build the runtime handle. Management calls use the developer key
  // (org-scoped); paid HTTP calls use the agent-scoped key.
  const devClient = new DelegationClient(baseUrl, server.developerKey);
  const boundFetch = payFetchDelegated({
    arispayUrl: baseUrl,
    apiKey: server.agentApiKey,
  });

  const synthetic: CreateX402AgentResponse = {
    agentId: server.agentId,
    walletAddress: server.walletAddress,
    apiKey: server.agentApiKey,
    status: server.status === "active" ? "active" : "pending_funding",
    limits: server.limits,
    allowedDomains: server.allowedDomains,
    network,
  };

  return {
    developerKey: server.developerKey,
    userId: server.userId,
    orgId: server.orgId,
    orgName: server.orgName,
    email: server.email,
    agentId: server.agentId,
    agentName: server.agentName,
    agentApiKey: server.agentApiKey,
    walletAddress: server.walletAddress,
    network,
    limits,
    allowedDomains: server.allowedDomains,
    custody: "delegated",
    status: synthetic.status,
    environment: "production",
    reused: server.reused ?? false,
    existingAgents,
    pairing: server.pairing,
    fundingUrl: server.fundingUrl,
    fundingExpiresAt: server.fundingExpiresAt,
    fundingProvider: server.fundingProvider,
    fundingUrlError: server.fundingUrlError,
    fetch: boundFetch,
    getBalance: () => devClient.getBalance(server.agentId),
    waitUntilFunded: (options) => devClient.pollUntilFunded(server.agentId, options),
    getFundingLink: (options) => devClient.getHostedTopup(server.agentId, options),
  };
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.clone().json();
  } catch {
    return undefined;
  }
}
