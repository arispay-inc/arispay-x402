#!/usr/bin/env node
/**
 * agentmarketplace-mcp — MCP server exposing the agent marketplace in-loop.
 *
 * Once installed, Claude / Cursor / any MCP client can call:
 *   - search_agents(query?, tag?, transport?, capability?, limit?)
 *   - get_agent(slug)
 *   - search_tools(query?, listingSlug?, limit?)
 *   - list_tools_for_agent(slug)
 *   - install_agent(slug)   → returns the MCP config snippet or endpoint info
 *   - call_agent(slug, method?, body?, headers?)      — http / http-x402; pays via ArisPay
 *   - proxy_tool_call(slug, tool, args?, method?)     — tool-scoped paid invocation
 *   - publish_agent(manifest)  (requires ARISPAY_API_KEY)
 *
 * Environment:
 *   AGENTMARKETPLACE_URL   Override registry URL (default: api.arispay.app/v1/marketplace)
 *   ARISPAY_API_KEY        Required for publish_agent and any x402-priced call
 *   ARISPAY_URL            Override ArisPay API base for paid calls (default: api.arispay.app)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type AgentListing, HttpMarketplaceClient } from "agentmarketplace";
import { payFetchDelegated } from "payagent";
import { z } from "zod";
import { type CallToolDeps, runCallAgent, runProxyToolCall } from "./call-tools.js";

const DEFAULT_BASE_URL = "https://api.arispay.app/v1/marketplace";
const baseUrl = process.env.AGENTMARKETPLACE_URL ?? DEFAULT_BASE_URL;
const apiKey = process.env.ARISPAY_API_KEY;

const client = new HttpMarketplaceClient({ baseUrl, apiKey });

/** Built per call so ARISPAY_URL keeps its call-time read semantics. */
function callToolDeps(): CallToolDeps {
  return {
    getListing: (slug) => client.get(slug),
    fetchFn: (url, init) => fetch(url, init),
    makePaidFetch: () => {
      const arispayUrl = process.env.ARISPAY_URL ?? "https://api.arispay.app";
      return payFetchDelegated({ arispayUrl, apiKey: apiKey! });
    },
    apiKey,
    baseUrl,
  };
}

function formatListing(a: AgentListing): string {
  const lines = [
    `${a.name}${a.verified ? " ✓" : ""}${a.claimed === false ? " (unclaimed)" : ""}`,
    `  slug:       ${a.slug}`,
    `  transport:  ${a.endpoint.transport}`,
  ];
  if (a.endpoint.url) lines.push(`  endpoint:   ${a.endpoint.url}`);
  if (a.endpoint.command) {
    lines.push(`  command:    ${a.endpoint.command} ${(a.endpoint.args ?? []).join(" ")}`);
  }
  if (a.pricing) {
    const amt =
      a.pricing.amount != null
        ? ` (${(a.pricing.amount / 100).toFixed(2)} ${a.pricing.currency ?? "USD"}${a.pricing.per ? `/${a.pricing.per}` : ""})`
        : "";
    lines.push(`  pricing:    ${a.pricing.model}${amt}`);
  }
  if (a.tags?.length) lines.push(`  tags:       ${a.tags.join(", ")}`);
  if (a.description) lines.push(`  ${a.description}`);
  return lines.join("\n");
}

function buildInstallInstructions(a: AgentListing): string {
  switch (a.endpoint.transport) {
    case "mcp-stdio": {
      const name = a.slug.replace(/[^a-z0-9-]/gi, "-");
      const config = {
        mcpServers: {
          [name]: {
            command: a.endpoint.command ?? "",
            args: a.endpoint.args ?? [],
            ...(a.endpoint.envKeys?.length
              ? { env: Object.fromEntries(a.endpoint.envKeys.map((k) => [k, `<${k}>`])) }
              : {}),
          },
        },
      };
      return [
        "Add this to your MCP config (~/.claude/mcp.json, ~/.cursor/mcp.json, etc.):",
        "",
        JSON.stringify(config, null, 2),
      ].join("\n");
    }
    case "mcp-http":
      return [
        `MCP (HTTP transport) endpoint: ${a.endpoint.url}`,
        "",
        "Add to your MCP config under mcpServers.<name>.url",
      ].join("\n");
    case "http-x402":
      return [
        `HTTP endpoint (x402-priced): ${a.endpoint.url}`,
        "",
        "Call via payagent-mcp or any x402 client; payment is settled per request.",
      ].join("\n");
    case "http":
      return [
        `HTTP endpoint: ${a.endpoint.url}`,
        a.endpoint.envKeys?.length ? `Required env: ${a.endpoint.envKeys.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    default:
      return `Unknown transport: ${a.endpoint.transport}`;
  }
}

const server = new McpServer({
  name: "agentmarketplace",
  version: "0.1.0",
});

// ── search_agents ────────────────────────────────────────────────────────
server.tool(
  "search_agents",
  {
    query: z.string().optional().describe("Free-text search across name, description, slug"),
    tag: z.string().optional().describe('Filter by tag, e.g. "travel", "finance"'),
    transport: z
      .enum(["mcp-stdio", "mcp-http", "http-x402", "http"])
      .optional()
      .describe("Filter by transport type"),
    capability: z.string().optional().describe('Filter by capability, e.g. "flight-booking"'),
    limit: z.number().int().min(1).max(50).optional().describe("Max results (default 20)"),
  },
  async ({ query, tag, transport, capability, limit }) => {
    try {
      const result = await client.search({ q: query, tag, transport, capability, limit });
      if (result.agents.length === 0) {
        return { content: [{ type: "text" as const, text: "No agents found." }] };
      }
      const text = result.agents.map(formatListing).join("\n\n");
      const tail = result.nextCursor ? "\n\n(more results available)" : "";
      return { content: [{ type: "text" as const, text: text + tail }] };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` },
        ],
        isError: true,
      };
    }
  },
);

// ── get_agent ─────────────────────────────────────────────────────────────
server.tool(
  "get_agent",
  {
    slug: z.string().describe('The agent slug, e.g. "hermes/booking"'),
  },
  async ({ slug }) => {
    try {
      const a = await client.get(slug);
      if (!a) {
        return {
          content: [{ type: "text" as const, text: `Not found: ${slug}` }],
          isError: true,
        };
      }
      const lines = [formatListing(a)];
      if (a.homepage) lines.push(`  homepage:   ${a.homepage}`);
      if (a.repository) lines.push(`  repository: ${a.repository}`);
      if (a.readme) {
        lines.push("");
        lines.push("--- README ---");
        lines.push(a.readme);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` },
        ],
        isError: true,
      };
    }
  },
);

// ── search_tools (tool-level search across all listings) ─────────────────
server.tool(
  "search_tools",
  {
    query: z.string().optional().describe("Free-text search across tool name and description"),
    listingSlug: z
      .string()
      .optional()
      .describe(
        'Restrict to tools belonging to a specific listing (e.g. "modelcontextprotocol/filesystem")',
      ),
    limit: z.number().int().min(1).max(50).optional().describe("Max results (default 20)"),
  },
  async ({ query, listingSlug, limit }) => {
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (listingSlug) params.set("listingSlug", listingSlug);
      if (limit) params.set("limit", String(limit));
      const url = `${baseUrl}/tools${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`tool search failed: ${res.status}`);
      const body = (await res.json()) as {
        tools: Array<{
          name: string;
          description?: string;
          listingSlug: string;
          listingName: string;
          listingVerified: boolean;
        }>;
        nextCursor?: string;
      };
      if (body.tools.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No tools found. (Tool-level indexing is in progress — the crawler will populate tools from every indexed MCP server.)",
            },
          ],
        };
      }
      const lines: string[] = [];
      for (const t of body.tools) {
        const checkmark = t.listingVerified ? " ✓" : "";
        lines.push(`${t.listingName}${checkmark} — ${t.name}`);
        lines.push(`  slug:   ${t.listingSlug}/${t.name}`);
        if (t.description) lines.push(`  ${t.description}`);
        lines.push("");
      }
      if (body.nextCursor) lines.push("(more results available)");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` },
        ],
        isError: true,
      };
    }
  },
);

// ── list_tools_for_agent ──────────────────────────────────────────────────
server.tool(
  "list_tools_for_agent",
  {
    slug: z.string().describe("The agent slug to list tools for"),
  },
  async ({ slug }) => {
    try {
      const res = await fetch(`${baseUrl}/agents/${encodeURIComponent(slug)}/tools`);
      if (!res.ok) throw new Error(`list tools failed: ${res.status}`);
      const body = (await res.json()) as {
        tools: Array<{ name: string; description?: string }>;
      };
      if (body.tools.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No tools indexed for ${slug} yet. (Crawler may not have visited this listing.)`,
            },
          ],
        };
      }
      const lines = [`Tools for ${slug}:`, ""];
      for (const t of body.tools) {
        lines.push(`  ${t.name}`);
        if (t.description) lines.push(`    ${t.description}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` },
        ],
        isError: true,
      };
    }
  },
);

// ── install_agent ─────────────────────────────────────────────────────────
server.tool(
  "install_agent",
  {
    slug: z.string().describe("The agent slug to install"),
  },
  async ({ slug }) => {
    try {
      const a = await client.get(slug);
      if (!a) {
        return {
          content: [{ type: "text" as const, text: `Not found: ${slug}` }],
          isError: true,
        };
      }
      const text = [formatListing(a), "", buildInstallInstructions(a)].join("\n");
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` },
        ],
        isError: true,
      };
    }
  },
);

// ── call_agent (invoke http/http-x402 endpoint; pays via ArisPay) ─────────
server.tool(
  "call_agent",
  {
    slug: z.string().describe("Agent slug to invoke"),
    method: z
      .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
      .default("GET")
      .describe("HTTP method"),
    body: z.string().optional().describe("Request body (for POST/PUT/PATCH)"),
    headers: z.record(z.string(), z.string()).optional().describe("Extra HTTP headers"),
  },
  async ({ slug, method, body, headers }) => {
    const r = await runCallAgent({ slug, method, body, headers }, callToolDeps());
    return {
      content: [{ type: "text" as const, text: r.text }],
      ...(r.isError ? { isError: true } : {}),
    };
  },
);

// ── proxy_tool_call (tool-scoped paid invocation) ─────────────────────────
// Distinct from `call_agent`: the `tool` param is appended to the
// listing's endpoint URL as a path suffix, and `args` is the JSON body.
// Use this when the agent already knows which tool on which listing it
// wants; use `call_agent` for free-form HTTP calls against a listing.
//
// Transports: http / http-x402 only. For mcp-stdio / mcp-http we return
// an error pointing at `install_agent` — MCP subprocess + session
// lifecycle belongs in the MCP host, not in this intermediate server.
server.tool(
  "proxy_tool_call",
  {
    slug: z.string().describe('Listing slug, e.g. "acme/flights"'),
    tool: z.string().describe("Tool name — appended to the listing endpoint URL as a path"),
    args: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("JSON args passed as the POST body"),
    method: z
      .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
      .default("POST")
      .describe("HTTP method. Defaults to POST when args are supplied."),
  },
  async ({ slug, tool, args, method }) => {
    const r = await runProxyToolCall({ slug, tool, args, method }, callToolDeps());
    return {
      content: [{ type: "text" as const, text: r.text }],
      ...(r.isError ? { isError: true } : {}),
    };
  },
);

// ── publish_agent (authed) ────────────────────────────────────────────────
server.tool(
  "publish_agent",
  {
    slug: z.string().describe('Unique slug, e.g. "mycompany/booking" (lowercase, hyphens)'),
    name: z.string().describe("Display name"),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    capabilities: z.array(z.string()).optional(),
    transport: z.enum(["mcp-stdio", "mcp-http", "http-x402", "http"]),
    url: z.string().optional().describe("For mcp-http / http-x402 / http"),
    command: z.string().optional().describe('For mcp-stdio, e.g. "npx"'),
    args: z.array(z.string()).optional().describe("For mcp-stdio args"),
    envKeys: z.array(z.string()).optional().describe("Env vars the installer must set"),
    pricingModel: z.enum(["free", "x402", "apikey", "subscription"]).optional(),
    pricingAmount: z.number().int().optional().describe("Cents, for x402 pricing"),
    pricingCurrency: z.string().optional(),
    pricingPer: z.enum(["call", "session", "month"]).optional(),
    homepage: z.string().optional(),
    repository: z.string().optional(),
    readme: z.string().optional(),
  },
  async (args) => {
    if (!apiKey) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Publishing requires ARISPAY_API_KEY. Set the env var to an ArisPay API key and restart the MCP server.",
          },
        ],
        isError: true,
      };
    }
    try {
      const published = await client.publish({
        slug: args.slug,
        name: args.name,
        description: args.description,
        tags: args.tags,
        capabilities: args.capabilities,
        endpoint: {
          transport: args.transport,
          url: args.url,
          command: args.command,
          args: args.args,
          envKeys: args.envKeys,
        },
        pricing: args.pricingModel
          ? {
              model: args.pricingModel,
              amount: args.pricingAmount,
              currency: args.pricingCurrency,
              per: args.pricingPer,
            }
          : undefined,
        homepage: args.homepage,
        repository: args.repository,
        readme: args.readme,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Published ${published.slug}\n\n${formatListing(published)}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` },
        ],
        isError: true,
      };
    }
  },
);

// ── Startup ───────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`agentmarketplace-mcp running — registry: ${baseUrl}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
