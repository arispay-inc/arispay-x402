/**
 * payagent — `launchAgent()` sugar.
 *
 * Composes `DelegationClient.createX402Agent` + `payFetchDelegated` +
 * balance polling into a single call that returns a self-contained
 * agent handle:
 *
 * ```ts
 * const hermes = await launchAgent({
 *   name: 'hermes',
 *   limits: { perTx: 5000, daily: 50000, monthly: 200000 }, // cents
 * });
 * console.log(`Fund: ${hermes.walletAddress}`);
 * await hermes.waitUntilFunded();
 * const res = await hermes.fetch('https://api.example.com/premium');
 * ```
 *
 * Developer API key resolution order:
 *   1. `config.arispayApiKey` argument
 *   2. `ARISPAY_API_KEY` env var
 *   3. `~/.payagent/config.json` (written by `payagent init`)
 *
 * If none is available, `launchAgent` throws with a prompt pointing at
 * `npx payagent init`.
 *
 * Side effect: on success, the launched agent is persisted to the same
 * config store so the CLI and MCP tools can look it up by name later.
 */

import {
  type StoredAgent,
  getApiKey,
  getArispayUrl,
  getAgent as readStoredAgent,
  saveAgent,
} from "./config-store.js";
import {
  type BalanceResponse,
  type CreatePaymentOptions,
  type CreateX402AgentResponse,
  DelegationClient,
  type HostedTopupOptions,
  type HostedTopupResponse,
  type PaymentResponse,
  type SetUserLimitsOptions,
  type SpendLimitResponse,
  type X402AgentConfig,
} from "./delegation.js";
import { type PayFetchFn, payFetchDelegated } from "./fetch-delegated.js";

export interface LaunchAgentConfig {
  /** Human name — also the local lookup key in the config store. */
  name: string;
  /** Per-tx / daily / monthly caps in integer cents. */
  limits: {
    perTx: number;
    daily: number;
    monthly: number;
  };
  /** Domains the agent is allowed to pay. Empty = unrestricted at ArisPay. */
  allowedDomains?: string[];
  /** EVM network. Defaults to `base` (mainnet). */
  network?: "base" | "base-sepolia" | "ethereum" | "polygon";
  /** Optional metadata label, surfaces on the dashboard. */
  agentType?: string;
  description?: string;
  /** Override for the developer API key. Falls back to env + config file. */
  arispayApiKey?: string;
  /** Override for the ArisPay base URL. */
  arispayUrl?: string;
  /** If true, do not persist the resulting agent to `~/.payagent/config.json`. Default false. */
  ephemeral?: boolean;
}

export interface LaunchedAgent {
  agentId: string;
  name: string;
  walletAddress: string;
  /** Agent-scoped API key — returned by ArisPay exactly once. Store it. */
  apiKey: string;
  status: "pending_funding" | "active";
  limits: { perTx: number; daily: number; monthly: number };
  allowedDomains: string[];
  network: string;
  /** Pre-bound `payFetchDelegated` configured with this agent's key. */
  fetch: PayFetchFn;
  /** One-shot on-chain balance + fundedAt. */
  getBalance: () => Promise<BalanceResponse>;
  /** Resolves once the wallet first receives USDC, or rejects on timeout. */
  waitUntilFunded: (options?: {
    intervalMs?: number;
    timeoutMs?: number;
  }) => Promise<BalanceResponse>;
  /**
   * Request a hosted Coinbase Onramp URL for this agent. The end-user
   * opens the returned link in a browser, completes card / Apple Pay,
   * and Coinbase deposits USDC straight into the agent's CDP wallet.
   * Throws `HostedTopupNotConfiguredError` if the deployment hasn't set
   * `ARISPAY_ONRAMP_PROVIDER` — callers can fall back to the wallet address.
   */
  getFundingLink: (options?: HostedTopupOptions) => Promise<HostedTopupResponse>;
  /**
   * Per-end-user spend override for this agent. Passes `agentId` automatically.
   * Use `DelegationClient.setUserLimits` directly if you need to address a
   * different agent's limits.
   */
  setUserLimits: (
    endUserId: string,
    options: Omit<SetUserLimitsOptions, "agentId">,
  ) => Promise<SpendLimitResponse>;
  /**
   * Create a payment from this agent through `POST /v1/payments`. Picks the
   * rail server-side (card, crypto, mpp, or balance) based on the agent's
   * mode and whether a `userId` is supplied.
   *
   * For x402-priced API calls, use `.fetch(url)` instead — that's the right
   * tool for buying a single HTTP resource via the 402 challenge flow.
   */
  pay: (options: CreatePaymentOptions) => Promise<PaymentResponse>;
}

export class MissingArisPayApiKeyError extends Error {
  constructor() {
    super(
      "No ArisPay API key found. Set ARISPAY_API_KEY in your environment or run `npx payagent init`.",
    );
    this.name = "MissingArisPayApiKeyError";
  }
}

/**
 * Launch a new agent end-to-end: create it on ArisPay, persist the returned
 * credentials locally, and return a handle with `.fetch`, `.getBalance`,
 * `.waitUntilFunded`.
 *
 * Does not wait for funding — that's the caller's choice. Marketing: "a
 * wallet address arrives in ~two seconds; funding is whatever rail you pick."
 */
export async function launchAgent(config: LaunchAgentConfig): Promise<LaunchedAgent> {
  const apiKey = getApiKey(config.arispayApiKey);
  if (!apiKey) throw new MissingArisPayApiKeyError();

  const baseUrl = getArispayUrl(config.arispayUrl);
  const client = new DelegationClient(baseUrl, apiKey);

  const createConfig: X402AgentConfig = {
    name: config.name,
    agentType: config.agentType,
    maxPerTx: config.limits.perTx,
    maxDaily: config.limits.daily,
    maxMonthly: config.limits.monthly,
    allowedDomains: config.allowedDomains,
    description: config.description,
    network: config.network,
  };

  const created = await client.createX402Agent(createConfig);

  if (!config.ephemeral) {
    const stored: StoredAgent = {
      agentId: created.agentId,
      name: config.name,
      walletAddress: created.walletAddress,
      apiKey: created.apiKey,
      limits: {
        perTx: created.limits.maxPerTx,
        daily: created.limits.maxDaily,
        monthly: created.limits.maxMonthly,
      },
      allowedDomains: created.allowedDomains,
      network: (config.network ?? "base") as StoredAgent["network"],
      createdAt: new Date().toISOString(),
    };
    saveAgent(stored);
  }

  return buildLaunchedAgent({
    name: config.name,
    baseUrl,
    created,
  });
}

/**
 * Rehydrate a previously-launched agent from `~/.payagent/config.json`.
 * Useful for the CLI's `agent balance <name>` and MCP's `get_balance` tool.
 *
 * Returns `undefined` if the agent isn't in the local store.
 */
export function getLaunchedAgent(
  name: string,
  overrides: { arispayUrl?: string } = {},
): LaunchedAgent | undefined {
  const stored = readStoredAgent(name);
  if (!stored) return undefined;
  const baseUrl = getArispayUrl(overrides.arispayUrl);

  // Reconstruct the shape DelegationClient.createX402Agent would have returned.
  const synthetic: CreateX402AgentResponse = {
    agentId: stored.agentId,
    walletAddress: stored.walletAddress,
    apiKey: stored.apiKey,
    status: "pending_funding",
    limits: {
      maxPerTx: stored.limits.perTx,
      maxDaily: stored.limits.daily,
      maxMonthly: stored.limits.monthly,
    },
    allowedDomains: stored.allowedDomains ?? [],
    network: stored.network,
  };

  return buildLaunchedAgent({
    name,
    baseUrl,
    created: synthetic,
  });
}

function buildLaunchedAgent(input: {
  name: string;
  baseUrl: string;
  created: CreateX402AgentResponse;
}): LaunchedAgent {
  const { name, baseUrl, created } = input;

  // Balance polling uses the developer key, not the agent key, because the
  // balance endpoint is scoped by the org that owns the agent.
  const devKey = getApiKey();
  if (!devKey) throw new MissingArisPayApiKeyError();
  const client = new DelegationClient(baseUrl, devKey);

  const boundFetch = payFetchDelegated({
    arispayUrl: baseUrl,
    apiKey: created.apiKey,
  });

  return {
    agentId: created.agentId,
    name,
    walletAddress: created.walletAddress,
    apiKey: created.apiKey,
    status: created.status,
    limits: {
      perTx: created.limits.maxPerTx,
      daily: created.limits.maxDaily,
      monthly: created.limits.maxMonthly,
    },
    allowedDomains: created.allowedDomains,
    network: created.network ?? "base",
    fetch: boundFetch,
    getBalance: () => client.getBalance(created.agentId),
    waitUntilFunded: (options) => client.pollUntilFunded(created.agentId, options),
    getFundingLink: (options) => client.getHostedTopup(created.agentId, options),
    setUserLimits: (endUserId, options) =>
      client.setUserLimits(endUserId, { ...options, agentId: created.agentId }),
    pay: (options) => client.createPayment(created.agentId, options),
  };
}
