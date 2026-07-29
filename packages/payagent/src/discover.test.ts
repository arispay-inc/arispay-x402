/**
 * Tests for payagent `discover()`.
 *
 * The wire contract these tests lock in:
 *   - POSTs to `<baseUrl>/discover` (default baseUrl = api.arispay.app)
 *   - Sends `content-type: application/json`
 *   - Body is the caller's `DiscoverInput` verbatim
 *   - Throws on non-2xx with status + body text in the message
 *
 * See Component Contract 11 in root CLAUDE.md — the DiscoverCandidate shape
 * (score, source, category, originUrl) must stay stable within a minor.
 */
import { describe, expect, it, vi } from "vitest";
import { type DiscoverInput, type DiscoverResult, discover } from "./discover.js";

function stubFetch(response: { ok: boolean; status?: number; body: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      statusText: response.ok ? "OK" : "Error",
      async json() {
        return response.body;
      },
      async text() {
        return typeof response.body === "string" ? response.body : JSON.stringify(response.body);
      },
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const sampleResult: DiscoverResult = {
  candidates: [
    {
      slug: "acme/flights",
      name: "Acme Flight Search",
      endpoint: { transport: "http-x402", url: "https://api.acme.example/flights" },
      pricing: { model: "x402", amount: 3, currency: "USD", per: "call" },
      capabilities: ["flight-search"],
      category: "search",
      source: "arispay",
      verified: true,
      score: 902,
    },
  ],
  query: { capability: "flight-search", budgetCentsMax: 5 },
};

describe("discover", () => {
  it("POSTs JSON to <marketplaceUrl>/discover with the caller input verbatim", async () => {
    const { fetch, calls } = stubFetch({ ok: true, body: sampleResult });
    const input: DiscoverInput = { capability: "flight-search", budgetCentsMax: 5 };
    const result = await discover(input, {
      marketplaceUrl: "https://example.test/v1/marketplace",
      fetch,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://example.test/v1/marketplace/discover");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
    expect(calls[0]!.init.body).toBe(JSON.stringify(input));
    expect(result).toEqual(sampleResult);
  });

  it("strips a trailing slash on marketplaceUrl", async () => {
    const { fetch, calls } = stubFetch({ ok: true, body: sampleResult });
    await discover({}, { marketplaceUrl: "https://example.test/v1/marketplace/", fetch });
    expect(calls[0]!.url).toBe("https://example.test/v1/marketplace/discover");
  });

  it("defaults to api.arispay.app when marketplaceUrl is not provided", async () => {
    const { fetch, calls } = stubFetch({ ok: true, body: sampleResult });
    await discover({}, { fetch });
    expect(calls[0]!.url).toBe("https://api.arispay.app/v1/marketplace/discover");
  });

  it("sends an empty object body when input is omitted", async () => {
    const { fetch, calls } = stubFetch({ ok: true, body: sampleResult });
    await discover(undefined, { fetch });
    expect(calls[0]!.init.body).toBe("{}");
  });

  it("throws with status + body on non-2xx", async () => {
    const { fetch } = stubFetch({
      ok: false,
      status: 400,
      body: { error: { code: "INVALID_REQUEST", message: "bad budget" } },
    });
    await expect(discover({ budgetCentsMax: -1 }, { fetch })).rejects.toThrow(
      /payagent discover failed \(400\)/,
    );
  });

  it("forwards AbortSignal to the fetch call", async () => {
    const { fetch, calls } = stubFetch({ ok: true, body: sampleResult });
    const ctl = new AbortController();
    await discover({}, { fetch, signal: ctl.signal });
    expect(calls[0]!.init.signal).toBe(ctl.signal);
  });
});
