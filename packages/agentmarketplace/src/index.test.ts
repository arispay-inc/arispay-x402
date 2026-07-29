import { describe, expect, it, vi } from "vitest";
import {
  HttpMarketplaceClient,
  type PublishAgentInput,
  parseManifest,
} from "./index.js";

const BASE_URL = "https://api.example.test/v1/marketplace";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("parseManifest", () => {
  const valid: PublishAgentInput = {
    slug: "acme/flights",
    name: "Acme Flights",
    endpoint: { transport: "http-x402", url: "https://acme.example/api" },
    // integer cents — 25 = $0.25 per call
    pricing: { model: "x402", amount: 25, currency: "USD", per: "call" },
  };

  it("accepts a valid manifest and returns it unchanged", () => {
    expect(parseManifest(valid)).toBe(valid);
  });

  it("rejects non-objects", () => {
    expect(() => parseManifest(null)).toThrow(/must be an object/);
    expect(() => parseManifest("nope")).toThrow(/must be an object/);
    expect(() => parseManifest(42)).toThrow(/must be an object/);
  });

  it("rejects a missing or empty slug", () => {
    expect(() => parseManifest({ ...valid, slug: undefined })).toThrow(/slug required/);
    expect(() => parseManifest({ ...valid, slug: "" })).toThrow(/slug required/);
  });

  it("rejects a missing or empty name", () => {
    expect(() => parseManifest({ ...valid, name: undefined })).toThrow(/name required/);
    expect(() => parseManifest({ ...valid, name: "" })).toThrow(/name required/);
  });

  it("rejects a missing endpoint", () => {
    expect(() => parseManifest({ ...valid, endpoint: undefined })).toThrow(/endpoint required/);
  });

  it("rejects an endpoint without a transport", () => {
    expect(() => parseManifest({ ...valid, endpoint: { url: "https://x.example" } })).toThrow(
      /transport required/,
    );
  });
});

describe("HttpMarketplaceClient.publish", () => {
  const input: PublishAgentInput = {
    slug: "acme/flights",
    name: "Acme Flights",
    description: "Books flights.",
    tags: ["travel"],
    endpoint: { transport: "http-x402", url: "https://acme.example/api" },
    pricing: { model: "x402", amount: 25, currency: "USD", per: "call" },
  };

  it("POSTs the manifest to /agents with bearer auth and a JSON body", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(201, { ...input, claimed: true }));
    const client = new HttpMarketplaceClient({
      baseUrl: `${BASE_URL}/`, // trailing slash must be normalised away
      apiKey: "ap_live_test",
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });

    const published = await client.publish(input);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/agents`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer ap_live_test",
    });
    const body = JSON.parse(init.body as string) as PublishAgentInput;
    expect(body).toEqual(input);
    // Money on the wire is integer cents, untouched by the client.
    expect(body.pricing?.amount).toBe(25);
    expect(published.slug).toBe("acme/flights");
  });

  it("throws with status and body on a non-2xx response", async () => {
    const fetchFn = vi.fn(async () => new Response("slug already taken", { status: 409 }));
    const client = new HttpMarketplaceClient({
      baseUrl: BASE_URL,
      apiKey: "ap_live_test",
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    await expect(client.publish(input)).rejects.toThrow(
      /marketplace publish failed: 409 slug already taken/,
    );
  });

  it("omits the authorization header when no apiKey is configured", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(201, input));
    const client = new HttpMarketplaceClient({
      baseUrl: BASE_URL,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    await client.publish(input);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("authorization");
  });
});

describe("HttpMarketplaceClient.validate", () => {
  it("POSTs to /agents/:slug/validate with the slug URL-encoded", async () => {
    const ok = {
      slug: "acme/flights",
      healthy: true,
      lastCheckedAt: "2026-07-29T00:00:00Z",
      lastCheckError: null,
    };
    const fetchFn = vi.fn(async () => jsonResponse(200, ok));
    const client = new HttpMarketplaceClient({
      baseUrl: BASE_URL,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    const result = await client.validate("acme/flights");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/agents/acme%2Fflights/validate`);
    expect(init.method).toBe("POST");
    expect(result).toEqual(ok);
  });

  it("throws with status and body when validation is rejected", async () => {
    const fetchFn = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const client = new HttpMarketplaceClient({
      baseUrl: BASE_URL,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    await expect(client.validate("acme/flights")).rejects.toThrow(
      /marketplace validate failed: 429 rate limited/,
    );
  });
});

describe("HttpMarketplaceClient.get", () => {
  it("returns null on 404 rather than throwing", async () => {
    const fetchFn = vi.fn(async () => new Response("not found", { status: 404 }));
    const client = new HttpMarketplaceClient({
      baseUrl: BASE_URL,
      fetch: fetchFn as unknown as typeof globalThis.fetch,
    });
    await expect(client.get("nope/nope")).resolves.toBeNull();
  });
});
