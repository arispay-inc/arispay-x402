/**
 * call_agent + proxy_tool_call — invocation tool handlers.
 *
 * Kept out of index.ts so they can be unit-tested without starting the
 * stdio server (same pattern as `payagent-mcp`'s discover-tools.ts). All
 * IO is injected: the marketplace lookup (`getListing`), the plain fetch
 * (`fetchFn`), and the x402-paying fetch factory (`makePaidFetch` — only
 * ever invoked after the apiKey guard passes). This module imports only
 * TYPES from `agentmarketplace`, so tests need no built SDK.
 *
 * Money rule: listing prices are integer cents in data (`pricing.amount`).
 * These handlers never do arithmetic on amounts — payment settlement is
 * delegated to `payagent`'s payFetchDelegated.
 */
import type { AgentListing } from "agentmarketplace";

export interface ToolText {
  text: string;
  isError: boolean;
}

/** Minimal fetch shape shared by globalThis.fetch and payagent's PayFetchFn. */
export type FetchLike = (
  url: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> },
) => Promise<Response>;

export interface CallToolDeps {
  /** Marketplace lookup, e.g. `(slug) => client.get(slug)`. */
  getListing: (slug: string) => Promise<AgentListing | null>;
  /** Plain HTTP fetch for free endpoints and the install-count bump. */
  fetchFn: FetchLike;
  /**
   * Factory for the x402-paying fetch (payagent's payFetchDelegated).
   * Only called when the listing is x402-priced AND an apiKey is present.
   */
  makePaidFetch: () => FetchLike;
  /** ArisPay API key; absence blocks paid calls with a helpful error. */
  apiKey?: string;
  /** Registry base URL — used for the fire-and-forget install bump. */
  baseUrl: string;
}

export interface CallAgentParams {
  slug: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: string;
  headers?: Record<string, string>;
}

export async function runCallAgent(
  { slug, method, body, headers }: CallAgentParams,
  deps: CallToolDeps,
): Promise<ToolText> {
  try {
    const listing = await deps.getListing(slug);
    if (!listing) {
      return { text: `Not found: ${slug}`, isError: true };
    }
    if (listing.endpoint.transport !== "http" && listing.endpoint.transport !== "http-x402") {
      return {
        text: `Listing is transport=${listing.endpoint.transport}. Use install_agent for MCP servers.`,
        isError: true,
      };
    }
    const url = listing.endpoint.url;
    if (!url) {
      return { text: "Listing has no endpoint URL.", isError: true };
    }

    const isPaid = listing.pricing?.model === "x402";
    if (isPaid && !deps.apiKey) {
      return {
        text: "This endpoint is x402-priced. Set ARISPAY_API_KEY in the MCP server env to enable paid calls.",
        isError: true,
      };
    }

    const doFetch = isPaid ? deps.makePaidFetch() : deps.fetchFn;
    const res = await doFetch(url, { method, body, headers });
    const text = await res.text();
    // NOTE: call_agent deliberately reports non-2xx HTTP statuses in-band
    // (not as a tool error) — the caller sees `HTTP <status>` and decides.
    return { text: `HTTP ${res.status}\n\n${text}`, isError: false };
  } catch (err) {
    return { text: `Error: ${err instanceof Error ? err.message : err}`, isError: true };
  }
}

export interface ProxyToolCallParams {
  slug: string;
  tool: string;
  args?: Record<string, unknown>;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
}

export async function runProxyToolCall(
  { slug, tool, args, method }: ProxyToolCallParams,
  deps: CallToolDeps,
): Promise<ToolText> {
  try {
    const listing = await deps.getListing(slug);
    if (!listing) {
      return { text: `Not found: ${slug}`, isError: true };
    }

    const transport = listing.endpoint.transport;
    if (transport !== "http" && transport !== "http-x402") {
      return {
        text: `proxy_tool_call only supports http and http-x402 transports — listing ${slug} is ${transport}. Use install_agent to add this MCP server to your client config instead.`,
        isError: true,
      };
    }

    const base = listing.endpoint.url;
    if (!base) {
      return { text: `Listing ${slug} has no endpoint URL.`, isError: true };
    }

    // Append the tool as a path segment. Handle trailing slash on base
    // and leading slash on tool so the result is a clean URL.
    const url = `${base.replace(/\/+$/, "")}/${tool.replace(/^\/+/, "")}`;
    const isPaid = listing.pricing?.model === "x402";
    if (isPaid && !deps.apiKey) {
      return {
        text: `${slug}/${tool} is x402-priced. Set ARISPAY_API_KEY in the MCP server env to enable paid calls.`,
        isError: true,
      };
    }

    const body = args !== undefined ? JSON.stringify(args) : undefined;
    const headers: Record<string, string> =
      args !== undefined ? { "content-type": "application/json" } : {};

    const doFetch = isPaid ? deps.makePaidFetch() : deps.fetchFn;
    const res = await doFetch(url, { method, body, headers });
    const text = await res.text();

    // Fire-and-forget install bump on success — the installCount metric
    // is advisory, not billing, so a failed bump never breaks the call.
    if (res.ok) {
      const bumpUrl = `${deps.baseUrl}/agents/${encodeURIComponent(slug)}/install`;
      void Promise.resolve(deps.fetchFn(bumpUrl, { method: "POST" })).catch(() => {});
    }

    return { text: `HTTP ${res.status}\n\n${text}`, isError: !res.ok };
  } catch (err) {
    return { text: `Error: ${err instanceof Error ? err.message : err}`, isError: true };
  }
}
