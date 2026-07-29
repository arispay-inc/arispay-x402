import { describe, expect, it, vi } from "vitest";
import type { AgentListing } from "agentmarketplace";
import { type CallToolDeps, runCallAgent, runProxyToolCall } from "./call-tools.js";

const BASE_URL = "https://api.example.test/v1/marketplace";

function listing(overrides: Partial<AgentListing> = {}): AgentListing {
  return {
    slug: "acme/flights",
    name: "Acme Flights",
    endpoint: { transport: "http", url: "https://acme.example/api" },
    ...overrides,
  };
}

function httpResponse(status: number, body = "ok"): Response {
  return new Response(body, { status });
}

function makeDeps(overrides: Partial<CallToolDeps> = {}): CallToolDeps {
  return {
    getListing: vi.fn(async () => listing()),
    fetchFn: vi.fn(async () => httpResponse(200)),
    makePaidFetch: vi.fn(() => vi.fn(async () => httpResponse(200, "paid-ok"))),
    apiKey: undefined,
    baseUrl: BASE_URL,
    ...overrides,
  };
}

describe("runCallAgent", () => {
  it("returns an error for an unknown slug", async () => {
    const deps = makeDeps({ getListing: vi.fn(async () => null) });
    const r = await runCallAgent({ slug: "nope/nope", method: "GET" }, deps);
    expect(r.isError).toBe(true);
    expect(r.text).toBe("Not found: nope/nope");
  });

  it("rejects MCP transports and points at install_agent", async () => {
    const deps = makeDeps({
      getListing: vi.fn(async () =>
        listing({ endpoint: { transport: "mcp-stdio", command: "npx" } }),
      ),
    });
    const r = await runCallAgent({ slug: "acme/flights", method: "GET" }, deps);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/transport=mcp-stdio/);
    expect(r.text).toMatch(/install_agent/);
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });

  it("errors when the listing has no endpoint URL", async () => {
    const deps = makeDeps({
      getListing: vi.fn(async () => listing({ endpoint: { transport: "http" } })),
    });
    const r = await runCallAgent({ slug: "acme/flights", method: "GET" }, deps);
    expect(r.isError).toBe(true);
    expect(r.text).toBe("Listing has no endpoint URL.");
  });

  it("blocks x402-priced calls when no API key is configured", async () => {
    const deps = makeDeps({
      getListing: vi.fn(async () =>
        listing({
          endpoint: { transport: "http-x402", url: "https://acme.example/api" },
          // integer cents on the wire — 25 = $0.25
          pricing: { model: "x402", amount: 25, currency: "USD", per: "call" },
        }),
      ),
      apiKey: undefined,
    });
    const r = await runCallAgent({ slug: "acme/flights", method: "GET" }, deps);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/x402-priced/);
    expect(r.text).toMatch(/ARISPAY_API_KEY/);
    expect(deps.makePaidFetch).not.toHaveBeenCalled();
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });

  it("routes paid calls through the paid fetch with method, body, headers", async () => {
    const paidFetch = vi.fn(async () => httpResponse(200, "paid-body"));
    const deps = makeDeps({
      getListing: vi.fn(async () =>
        listing({
          endpoint: { transport: "http-x402", url: "https://acme.example/api" },
          pricing: { model: "x402", amount: 25 },
        }),
      ),
      makePaidFetch: vi.fn(() => paidFetch),
      apiKey: "ap_live_test",
    });
    const r = await runCallAgent(
      {
        slug: "acme/flights",
        method: "POST",
        body: '{"q":1}',
        headers: { "x-extra": "yes" },
      },
      deps,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toBe("HTTP 200\n\npaid-body");
    expect(paidFetch).toHaveBeenCalledWith("https://acme.example/api", {
      method: "POST",
      body: '{"q":1}',
      headers: { "x-extra": "yes" },
    });
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });

  it("routes free calls through the plain fetch and never builds a paid fetch", async () => {
    const deps = makeDeps({ apiKey: "ap_live_test" });
    const r = await runCallAgent({ slug: "acme/flights", method: "GET" }, deps);
    expect(r.isError).toBe(false);
    expect(r.text).toBe("HTTP 200\n\nok");
    expect(deps.fetchFn).toHaveBeenCalledWith("https://acme.example/api", {
      method: "GET",
      body: undefined,
      headers: undefined,
    });
    expect(deps.makePaidFetch).not.toHaveBeenCalled();
  });

  it("reports non-2xx statuses in-band, not as a tool error", async () => {
    const deps = makeDeps({ fetchFn: vi.fn(async () => httpResponse(500, "boom")) });
    const r = await runCallAgent({ slug: "acme/flights", method: "GET" }, deps);
    expect(r.isError).toBe(false);
    expect(r.text).toBe("HTTP 500\n\nboom");
  });

  it("catches thrown errors and reports them", async () => {
    const deps = makeDeps({
      fetchFn: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    const r = await runCallAgent({ slug: "acme/flights", method: "GET" }, deps);
    expect(r.isError).toBe(true);
    expect(r.text).toBe("Error: network down");
  });
});

describe("runProxyToolCall", () => {
  it("returns an error for an unknown slug", async () => {
    const deps = makeDeps({ getListing: vi.fn(async () => null) });
    const r = await runProxyToolCall({ slug: "nope/nope", tool: "t", method: "POST" }, deps);
    expect(r.isError).toBe(true);
    expect(r.text).toBe("Not found: nope/nope");
  });

  it("rejects MCP transports with a pointer to install_agent", async () => {
    const deps = makeDeps({
      getListing: vi.fn(async () =>
        listing({ endpoint: { transport: "mcp-http", url: "https://acme.example/mcp" } }),
      ),
    });
    const r = await runProxyToolCall({ slug: "acme/flights", tool: "t", method: "POST" }, deps);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/only supports http and http-x402/);
    expect(r.text).toMatch(/mcp-http/);
  });

  it("joins base URL and tool path cleanly (trailing + leading slashes)", async () => {
    const deps = makeDeps({
      getListing: vi.fn(async () =>
        listing({ endpoint: { transport: "http", url: "https://acme.example/api///" } }),
      ),
    });
    await runProxyToolCall({ slug: "acme/flights", tool: "//search", method: "POST" }, deps);
    expect(deps.fetchFn).toHaveBeenCalledWith(
      "https://acme.example/api/search",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("serialises args as a JSON body with a content-type header", async () => {
    const deps = makeDeps();
    await runProxyToolCall(
      { slug: "acme/flights", tool: "search", args: { from: "LHR", to: "SFO" }, method: "POST" },
      deps,
    );
    expect(deps.fetchFn).toHaveBeenCalledWith("https://acme.example/api/search", {
      method: "POST",
      body: JSON.stringify({ from: "LHR", to: "SFO" }),
      headers: { "content-type": "application/json" },
    });
  });

  it("sends no body and no content-type when args are omitted", async () => {
    const deps = makeDeps();
    await runProxyToolCall({ slug: "acme/flights", tool: "status", method: "GET" }, deps);
    expect(deps.fetchFn).toHaveBeenCalledWith("https://acme.example/api/status", {
      method: "GET",
      body: undefined,
      headers: {},
    });
  });

  it("blocks x402-priced tool calls when no API key is configured", async () => {
    const deps = makeDeps({
      getListing: vi.fn(async () =>
        listing({
          endpoint: { transport: "http-x402", url: "https://acme.example/api" },
          pricing: { model: "x402", amount: 100 },
        }),
      ),
      apiKey: undefined,
    });
    const r = await runProxyToolCall({ slug: "acme/flights", tool: "search", method: "POST" }, deps);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/acme\/flights\/search is x402-priced/);
    expect(deps.makePaidFetch).not.toHaveBeenCalled();
  });

  it("routes paid tool calls through the paid fetch", async () => {
    const paidFetch = vi.fn(async () => httpResponse(200, "paid"));
    const deps = makeDeps({
      getListing: vi.fn(async () =>
        listing({
          endpoint: { transport: "http-x402", url: "https://acme.example/api" },
          pricing: { model: "x402", amount: 100 },
        }),
      ),
      makePaidFetch: vi.fn(() => paidFetch),
      apiKey: "ap_live_test",
    });
    const r = await runProxyToolCall(
      { slug: "acme/flights", tool: "search", args: { q: 1 }, method: "POST" },
      deps,
    );
    expect(r.isError).toBe(false);
    expect(r.text).toBe("HTTP 200\n\npaid");
    expect(paidFetch).toHaveBeenCalledWith("https://acme.example/api/search", {
      method: "POST",
      body: '{"q":1}',
      headers: { "content-type": "application/json" },
    });
  });

  it("bumps the install count (URL-encoded slug) on success only", async () => {
    const deps = makeDeps();
    await runProxyToolCall({ slug: "acme/flights", tool: "search", method: "POST" }, deps);
    expect(deps.fetchFn).toHaveBeenCalledWith(`${BASE_URL}/agents/acme%2Fflights/install`, {
      method: "POST",
    });
  });

  it("does not bump the install count on a failed call, and flags isError", async () => {
    const deps = makeDeps({ fetchFn: vi.fn(async () => httpResponse(402, "payment required")) });
    const r = await runProxyToolCall({ slug: "acme/flights", tool: "search", method: "POST" }, deps);
    expect(r.isError).toBe(true);
    expect(r.text).toBe("HTTP 402\n\npayment required");
    expect(deps.fetchFn).toHaveBeenCalledTimes(1); // no bump call
  });

  it("survives a rejected install bump (fire-and-forget)", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/install")) throw new Error("bump failed");
      return httpResponse(200);
    });
    const deps = makeDeps({ fetchFn });
    const r = await runProxyToolCall({ slug: "acme/flights", tool: "search", method: "POST" }, deps);
    expect(r.isError).toBe(false);
    // Let the fire-and-forget rejection settle; an unhandled rejection here
    // would fail the suite.
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("catches thrown errors and reports them", async () => {
    const deps = makeDeps({
      getListing: vi.fn(async () => {
        throw new Error("registry unreachable");
      }),
    });
    const r = await runProxyToolCall({ slug: "acme/flights", tool: "t", method: "POST" }, deps);
    expect(r.isError).toBe(true);
    expect(r.text).toBe("Error: registry unreachable");
  });
});
