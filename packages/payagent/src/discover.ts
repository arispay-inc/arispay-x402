/**
 * payagent — discover.
 *
 * Thin wrapper over `POST /v1/marketplace/discover`. Lets an agent find
 * listings that match a capability + budget cap without pulling in the
 * agentmarketplace SDK or the MCP server. Returns ranked candidates with
 * enough metadata to issue a follow-up paid call via `payFetchDelegated`.
 *
 * Types here intentionally duplicate (rather than import) the ones in
 * `agentmarketplace`. `payagent` is standalone and publishable outside
 * the monorepo — per packages/payagent/CLAUDE.md it must not depend on
 * other workspace packages.
 */

export type DiscoverTransport = "mcp-stdio" | "mcp-http" | "http-x402" | "http";

export type DiscoverCategory =
  | "inference"
  | "data"
  | "media"
  | "search"
  | "social"
  | "infrastructure"
  | "trading"
  | "other";

export type DiscoverSource = "arispay" | "bazaar" | "other";

export interface DiscoverInput {
  /** Exact capability string, e.g. "flight-booking". */
  capability?: string;
  /** Free-text intent; server keyword-matches name/description/capabilities/tags. */
  intent?: string;
  /** Maximum acceptable price in integer cents. Free listings always pass. */
  budgetCentsMax?: number;
  transport?: DiscoverTransport;
  category?: DiscoverCategory;
  /** Max results. Server caps at 50. Default 20. */
  limit?: number;
}

export interface DiscoverPricing {
  model: "free" | "x402" | "apikey" | "subscription";
  amount?: number;
  currency?: string;
  per?: "call" | "session" | "month";
}

export interface DiscoverEndpoint {
  transport: DiscoverTransport;
  url?: string;
  command?: string;
  args?: string[];
  envKeys?: string[];
}

export interface DiscoverCandidate {
  slug: string;
  name: string;
  description?: string;
  tags?: string[];
  capabilities?: string[];
  endpoint: DiscoverEndpoint;
  pricing?: DiscoverPricing;
  homepage?: string;
  publisher?: string;
  category?: DiscoverCategory;
  source?: DiscoverSource;
  originUrl?: string;
  verified?: boolean;
  installCount?: number;
  healthy?: boolean;
  /** Server ranking score; higher is better. See Contract 11 in root CLAUDE.md. */
  score: number;
}

export interface DiscoverResult {
  candidates: DiscoverCandidate[];
  query: DiscoverInput;
}

export interface DiscoverOptions {
  /** Override the marketplace base URL. Useful for dev + self-hosted. */
  marketplaceUrl?: string;
  /** Override the fetch implementation. Handy for tests. */
  fetch?: typeof globalThis.fetch;
  /** Optional AbortSignal to cancel the request. */
  signal?: AbortSignal;
}

const DEFAULT_MARKETPLACE_URL = "https://api.arispay.app/v1/marketplace";

/**
 * Call `POST /v1/marketplace/discover` and return ranked candidates.
 *
 * Budget is in integer cents; free listings always pass the budget filter.
 * The caller can follow up by issuing a paid request to a candidate's
 * `endpoint.url` via `payFetchDelegated`.
 *
 * @example
 * ```ts
 * import { discover, payFetchDelegated } from 'payagent';
 *
 * const { candidates } = await discover({
 *   capability: 'flight-search',
 *   budgetCentsMax: 5,
 * });
 * const top = candidates[0];
 * if (top?.endpoint.url) {
 *   const fetch402 = payFetchDelegated({ arispayUrl, apiKey });
 *   const res = await fetch402(top.endpoint.url);
 * }
 * ```
 */
export async function discover(
  input: DiscoverInput = {},
  opts: DiscoverOptions = {},
): Promise<DiscoverResult> {
  const baseUrl = (opts.marketplaceUrl ?? DEFAULT_MARKETPLACE_URL).replace(/\/$/, "");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const res = await fetchImpl(`${baseUrl}/discover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`payagent discover failed (${res.status}): ${text || res.statusText}`);
  }
  return (await res.json()) as DiscoverResult;
}
