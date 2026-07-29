/**
 * `syncAgents()` — server-authoritative wallet listing for end-user surfaces.
 *
 * The MCP `list_agents` tool and the CLI `payagent agent list` command both
 * need the same thing: "what wallets do I own, what's in each, and what
 * limits apply?" Reading `~/.payagent/config.json` alone is the wrong
 * answer — a new machine or a wiped cache shows zero wallets even though
 * the server knows about all of them. That blindness is exactly how end-
 * users end up minting fresh agents and orphaning funded ones.
 *
 * This helper:
 *   1. Hits `GET /v1/agents?withDelegation=1` with the developer key.
 *   2. Optionally fans out `GET /v1/agents/:id/x402-balance` per agent so
 *      the caller can render live USDC balances. Default: balance off
 *      (cheap list); pass `{ includeBalance: true }` to opt in.
 *   3. Writes the server result back into the local cache via
 *      `upsertManyFromServer`, preserving any locally-cached agent API key
 *      that the server can't return (it stores only the hash).
 *
 * Returns the merged view so callers don't need a follow-up `listAgents()`
 * on disk.
 */

import {
  DEFAULT_ARISPAY_URL,
  type StoredAgent,
  getApiKey,
  getArispayUrl,
  upsertManyFromServer,
} from "./config-store.js";
import { type AgentSummary, DelegationClient } from "./delegation.js";

export interface SyncAgentsOptions {
  /** Override the developer API key. Falls back to env / config store. */
  apiKey?: string;
  /** Override the base URL. Falls back to env / config store / default. */
  arispayUrl?: string;
  /**
   * When true, fan out balance checks per agent (parallel). Each balance
   * call is an on-chain read via the server's CDP path, so this adds N
   * round-trips. Default false to keep the cheap list cheap.
   */
  includeBalance?: boolean;
  /** Forwarded to `DelegationClient.listAgents`. */
  name?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface SyncedAgent extends AgentSummary {
  /** USDC balance (6-decimal base units). Only populated when `includeBalance` was set. */
  usdcBalance?: string;
}

export interface SyncAgentsResult {
  agents: SyncedAgent[];
  total: number;
  limit: number;
  offset: number;
}

export class MissingDevKeyForSyncError extends Error {
  constructor() {
    super("syncAgents: developer API key required (set ARISPAY_API_KEY or run `payagent init`).");
    this.name = "MissingDevKeyForSyncError";
  }
}

export async function syncAgents(options: SyncAgentsOptions = {}): Promise<SyncAgentsResult> {
  const apiKey = getApiKey(options.apiKey);
  if (!apiKey) throw new MissingDevKeyForSyncError();
  const baseUrl = getArispayUrl(options.arispayUrl) || DEFAULT_ARISPAY_URL;

  const client = new DelegationClient(baseUrl, apiKey);
  const list = await client.listAgents({
    name: options.name,
    status: options.status,
    limit: options.limit,
    offset: options.offset,
  });

  let agents: SyncedAgent[] = list.agents;

  if (options.includeBalance && agents.length) {
    // Fan out balance lookups in parallel. One failure per agent shouldn't
    // poison the whole list — the agent stays in the result with an
    // undefined balance so the caller can render "balance unavailable".
    const balances = await Promise.allSettled(agents.map((a) => client.getBalance(a.agentId)));
    agents = agents.map((a, i) => {
      const settled = balances[i];
      if (settled?.status === "fulfilled") {
        return { ...a, usdcBalance: settled.value.usdcBalance };
      }
      return a;
    });
  }

  // Rehydrate the local cache. Network is narrowed back to the CLI's
  // expected enum at the boundary; unknown values get dropped to keep
  // the local file consistent with the SDK's narrower type.
  const knownNetworks: ReadonlyArray<StoredAgent["network"]> = [
    "base",
    "base-sepolia",
    "ethereum",
    "polygon",
  ];
  const stored: StoredAgent[] = agents.map((a) => {
    const network = (knownNetworks as readonly string[]).includes(a.network)
      ? (a.network as StoredAgent["network"])
      : undefined;
    return {
      agentId: a.agentId,
      name: a.name,
      walletAddress: a.walletAddress,
      apiKey: "", // server has only the hash; preserved-from-local in upsertManyFromServer
      limits: {
        perTx: a.limits.maxPerTx,
        daily: a.limits.maxDaily,
        monthly: a.limits.maxMonthly,
      },
      allowedDomains: a.allowedDomains,
      network,
      createdAt: a.createdAt,
    };
  });
  upsertManyFromServer(stored);

  return { agents, total: list.total, limit: list.limit, offset: list.offset };
}
