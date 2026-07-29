/**
 * agentmarketplace — shared types + HTTP client for the ArisPay agent registry.
 *
 * An agent listing is a callable service described by a transport, an endpoint,
 * and an optional pricing model. Three transport shapes cover everything today:
 *   - mcp-stdio  : MCP server run as a local subprocess (command + args)
 *   - mcp-http   : MCP server reachable over HTTP
 *   - http-x402  : HTTP endpoint priced via x402 micropayments
 *   - http       : plain HTTP agent (API-key or free)
 *
 * TAP identity fields (publicKey / keyId) are optional and only relevant when
 * the listed agent participates in ArisPay's TAP signing flow.
 */

export type AgentTransport = "mcp-stdio" | "mcp-http" | "http-x402" | "http";

export type PricingModel = "free" | "x402" | "apikey" | "subscription";

export interface AgentPricing {
  model: PricingModel;
  /** Amount in integer cents (for x402, the per-call price). */
  amount?: number;
  currency?: string;
  per?: "call" | "session" | "month";
}

export interface AgentEndpoint {
  transport: AgentTransport;
  /** URL for mcp-http / http-x402 / http transports. */
  url?: string;
  /** Command for mcp-stdio, e.g. "npx". */
  command?: string;
  /** Args for mcp-stdio, e.g. ["-y", "agentmarketplace-mcp"]. */
  args?: string[];
  /** Env var names the installer must provide (values omitted). */
  envKeys?: string[];
  /**
   * Prompts for placeholder tokens that appear in `command` or `args`.
   * Keys are the literal token (e.g. "{{ALLOWED_DIR}}"). The installer
   * replaces the token with the user-supplied value before writing the
   * MCP config.
   */
  argPrompts?: Record<string, AgentArgPrompt>;
}

export interface AgentArgPrompt {
  /** Short human-readable description shown at the prompt. */
  description: string;
  /** Example value shown as a hint. */
  example?: string;
  /** If true, installer refuses to proceed with an empty value. */
  required?: boolean;
}

/** Canonical human-facing web surface for the Agent Marketplace. */
export const WEB_BASE_URL = "https://agentmarketplace.arispay.app";

/** Token format explicitly declared by publishers: {{ALL_CAPS_SNAKE}}. */
export const PLACEHOLDER_TOKEN_PATTERN = "\\{\\{[A-Z][A-Z0-9_]*\\}\\}";

/**
 * Heuristic patterns for legacy-style placeholders that publishers forget
 * to declare via `argPrompts`. The installer warns when these are detected
 * and still prompts the user (unless disabled with --no-placeholder-heuristic).
 */
export const HEURISTIC_PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^\/path\/to\//i,
  /^YOUR_[A-Z0-9_]+$/,
  /^<[^>]+>$/,
];

/**
 * Seven-category taxonomy mirroring Coinbase Agentic.market, plus "other"
 * as the explicit fallback. Publishers can set this via the `category`
 * field in their manifest; unset listings inherit an auto-classified
 * category from the server's keyword heuristic.
 */
export type ListingCategory =
  | "inference"
  | "data"
  | "media"
  | "search"
  | "social"
  | "infrastructure"
  | "trading"
  | "other";

/**
 * Where a listing originates. `"arispay"` is published through our API;
 * `"bazaar"` is ingested (unclaimed) from Coinbase x402 Bazaar; `"other"`
 * is reserved for future aggregator sources.
 */
export type ListingSource = "arispay" | "bazaar" | "other";

export interface AgentListing {
  slug: string;
  name: string;
  description?: string;
  tags?: string[];
  capabilities?: string[];
  endpoint: AgentEndpoint;
  pricing?: AgentPricing;
  homepage?: string;
  repository?: string;
  readme?: string;
  publisher?: string;
  /** Optional TAP identity (only for ArisPay-signed agents). */
  publicKey?: string;
  keyId?: string;
  claimed?: boolean;
  verified?: boolean;
  installCount?: number;
  /** Set by the server-side daily HEAD probe (and by manual `validate`). `undefined` = not yet checked. */
  healthy?: boolean;
  /** ISO timestamp of the last health check. */
  lastCheckedAt?: string;
  /** Reason for the most recent failed check. Cleared when the next check passes. */
  lastCheckError?: string;
  /** Origin of the listing; see `ListingSource`. */
  source?: ListingSource;
  /** Seven-category taxonomy; see `ListingCategory`. */
  category?: ListingCategory;
  /** Link to the listing on its source platform when `source !== 'arispay'`. */
  originUrl?: string;
  registeredAt?: string;
  updatedAt?: string;
}

export interface PublishAgentInput {
  slug: string;
  name: string;
  description?: string;
  tags?: string[];
  capabilities?: string[];
  category?: ListingCategory;
  endpoint: AgentEndpoint;
  pricing?: AgentPricing;
  homepage?: string;
  repository?: string;
  readme?: string;
  publicKey?: string;
  keyId?: string;
}

export interface MarketplaceSearchQuery {
  q?: string;
  tag?: string;
  capability?: string;
  transport?: AgentTransport;
  category?: ListingCategory;
  source?: ListingSource;
  publisher?: string;
  limit?: number;
  cursor?: string;
}

export interface MarketplaceSearchResult {
  agents: AgentListing[];
  nextCursor?: string;
  total?: number;
}

/**
 * A2A discovery query. Agents call this when they need a capability
 * rather than a specific listing. Unlike `search`, it accepts a budget
 * cap in integer cents and returns ranked candidates with their score.
 */
export interface DiscoverInput {
  /** Exact capability string, e.g. "flight-booking". Boosts matching listings. */
  capability?: string;
  /** Free-text intent. Keywords boost listings that mention them. */
  intent?: string;
  /** Maximum acceptable price in integer cents. Free listings always pass. */
  budgetCentsMax?: number;
  transport?: AgentTransport;
  category?: ListingCategory;
  limit?: number;
}

export interface DiscoverCandidate extends AgentListing {
  /** Score from the server's ranking function. Higher is better. */
  score: number;
}

export interface DiscoverResult {
  candidates: DiscoverCandidate[];
  query: DiscoverInput;
}

export interface CategoryEntry {
  name: ListingCategory;
  count: number;
}

export interface CapabilityEntry {
  name: string;
  count: number;
}

export interface ValidateResult {
  slug: string;
  healthy: boolean;
  lastCheckedAt: string;
  lastCheckError: string | null;
  observed?: {
    network?: string;
    scheme?: string;
    amount?: string;
  };
}

export interface MarketplaceClient {
  search(query: MarketplaceSearchQuery): Promise<MarketplaceSearchResult>;
  get(slug: string): Promise<AgentListing | null>;
  publish(listing: PublishAgentInput): Promise<AgentListing>;
  discover(input: DiscoverInput): Promise<DiscoverResult>;
  listCategories(): Promise<{ categories: CategoryEntry[] }>;
  listCapabilities(): Promise<{ capabilities: CapabilityEntry[] }>;
  validate(slug: string): Promise<ValidateResult>;
}

export interface HttpMarketplaceClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_BASE_URL = "https://api.arispay.app/v1/marketplace";

export class HttpMarketplaceClient implements MarketplaceClient {
  private fetchFn: typeof globalThis.fetch;
  private baseUrl: string;
  private apiKey?: string;

  constructor(opts: HttpMarketplaceClientOptions = { baseUrl: DEFAULT_BASE_URL }) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async search(query: MarketplaceSearchQuery = {}): Promise<MarketplaceSearchResult> {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.tag) params.set("tag", query.tag);
    if (query.capability) params.set("capability", query.capability);
    if (query.transport) params.set("transport", query.transport);
    if (query.category) params.set("category", query.category);
    if (query.source) params.set("source", query.source);
    if (query.publisher) params.set("publisher", query.publisher);
    if (query.limit) params.set("limit", String(query.limit));
    if (query.cursor) params.set("cursor", query.cursor);

    const qs = params.toString();
    const url = `${this.baseUrl}/agents${qs ? `?${qs}` : ""}`;
    const res = await this.fetchFn(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`marketplace search failed: ${res.status}`);
    return (await res.json()) as MarketplaceSearchResult;
  }

  /**
   * Capability-bounded discovery for agents. Unlike `search`, this accepts
   * a budget cap and returns candidates ranked by a server-side score.
   */
  async discover(input: DiscoverInput = {}): Promise<DiscoverResult> {
    const res = await this.fetchFn(`${this.baseUrl}/discover`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`marketplace discover failed: ${res.status} ${body}`);
    }
    return (await res.json()) as DiscoverResult;
  }

  async listCategories(): Promise<{ categories: CategoryEntry[] }> {
    const res = await this.fetchFn(`${this.baseUrl}/categories`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`marketplace listCategories failed: ${res.status}`);
    return (await res.json()) as { categories: CategoryEntry[] };
  }

  async listCapabilities(): Promise<{ capabilities: CapabilityEntry[] }> {
    const res = await this.fetchFn(`${this.baseUrl}/capabilities`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`marketplace listCapabilities failed: ${res.status}`);
    return (await res.json()) as { capabilities: CapabilityEntry[] };
  }

  async get(slug: string): Promise<AgentListing | null> {
    const res = await this.fetchFn(`${this.baseUrl}/agents/${encodeURIComponent(slug)}`, {
      headers: this.headers(),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`marketplace get failed: ${res.status}`);
    return (await res.json()) as AgentListing;
  }

  async publish(listing: PublishAgentInput): Promise<AgentListing> {
    const res = await this.fetchFn(`${this.baseUrl}/agents`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(listing),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`marketplace publish failed: ${res.status} ${body}`);
    }
    return (await res.json()) as AgentListing;
  }

  /**
   * Manually validate a listing's endpoint: fetches the URL, checks the
   * 402 challenge for x402 listings, and persists healthy / lastCheckedAt
   * server-side. Rate-limited to one call per minute per slug.
   */
  async validate(slug: string): Promise<ValidateResult> {
    const res = await this.fetchFn(`${this.baseUrl}/agents/${encodeURIComponent(slug)}/validate`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`marketplace validate failed: ${res.status} ${body}`);
    }
    return (await res.json()) as ValidateResult;
  }
}

/**
 * Parse an agent.json manifest file. Throws if required fields are missing.
 */
export function parseManifest(json: unknown): PublishAgentInput {
  if (!json || typeof json !== "object") throw new Error("manifest must be an object");
  const m = json as Record<string, unknown>;
  const slug = m.slug;
  const name = m.name;
  const endpoint = m.endpoint;
  if (typeof slug !== "string" || !slug) throw new Error("manifest.slug required");
  if (typeof name !== "string" || !name) throw new Error("manifest.name required");
  if (!endpoint || typeof endpoint !== "object") throw new Error("manifest.endpoint required");
  const ep = endpoint as Record<string, unknown>;
  if (typeof ep.transport !== "string") throw new Error("manifest.endpoint.transport required");
  return json as PublishAgentInput;
}
