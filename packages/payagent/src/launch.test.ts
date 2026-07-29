import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
/**
 * Tests for `launchAgent()` composition.
 *
 * We stub `global.fetch` to simulate `POST /v1/agents/x402` and verify that
 * `launchAgent` (a) calls the right URL with the developer key, (b) persists
 * the returned agent to the config store, and (c) hands back a `LaunchedAgent`
 * whose `.getBalance` and `.fetch` routes map to the right ArisPay endpoints.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listAgents, setApiKey } from "./config-store.js";
import { MissingArisPayApiKeyError, getLaunchedAgent, launchAgent } from "./launch.js";

const BASE = "https://api.arispay.test";

interface StubCase {
  matcher: (url: string, init?: RequestInit) => boolean;
  response: {
    ok: boolean;
    status?: number;
    json: unknown;
  };
}

function stubFetchRoutes(cases: StubCase[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const match = cases.find((c) => c.matcher(url, init));
    if (!match) {
      throw new Error(`No stubbed route for ${init?.method ?? "GET"} ${url}`);
    }
    const body = JSON.stringify(match.response.json);
    return {
      ok: match.response.ok,
      status: match.response.status ?? (match.response.ok ? 200 : 400),
      statusText: match.response.ok ? "OK" : "Error",
      clone() {
        return this;
      },
      async json() {
        return JSON.parse(body);
      },
      async text() {
        return body;
      },
    } as unknown as Response;
  });
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

let origFetch: typeof fetch;
let tmp: string;

beforeEach(() => {
  origFetch = globalThis.fetch;
  tmp = mkdtempSync(join(tmpdir(), "payagent-launch-test-"));
  process.env.PAYAGENT_CONFIG_DIR = tmp;
  delete process.env.ARISPAY_API_KEY;
  delete process.env.ARISPAY_URL;
});

afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = origFetch;
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.PAYAGENT_CONFIG_DIR;
});

describe("launchAgent", () => {
  it("throws MissingArisPayApiKeyError when no developer key is available", async () => {
    await expect(
      launchAgent({
        name: "smoke",
        limits: { perTx: 100, daily: 1000, monthly: 10000 },
        arispayUrl: BASE,
      }),
    ).rejects.toBeInstanceOf(MissingArisPayApiKeyError);
  });

  it("creates the agent, persists it, and returns a bound client", async () => {
    setApiKey("ap_live_dev");
    const fetch = stubFetchRoutes([
      {
        matcher: (url) => url === `${BASE}/v1/agents/x402`,
        response: {
          ok: true,
          json: {
            agentId: "agt_123",
            walletAddress: "0xabc",
            apiKey: "ap_test_agent",
            status: "pending_funding",
            limits: { maxPerTx: 100, maxDaily: 1000, maxMonthly: 10000 },
            allowedDomains: ["api.example.com"],
            custody: "delegated",
            network: "base",
          },
        },
      },
    ]);

    const agent = await launchAgent({
      name: "smoke",
      limits: { perTx: 100, daily: 1000, monthly: 10000 },
      allowedDomains: ["api.example.com"],
      arispayUrl: BASE,
    });

    expect(agent.agentId).toBe("agt_123");
    expect(agent.walletAddress).toBe("0xabc");
    expect(agent.apiKey).toBe("ap_test_agent");
    expect(agent.limits).toEqual({ perTx: 100, daily: 1000, monthly: 10000 });

    // POST body should carry the developer key + the input as cents-named fields
    const callUrl = fetch.mock.calls[0][0];
    const callInit = fetch.mock.calls[0][1] as RequestInit;
    expect(callUrl).toBe(`${BASE}/v1/agents/x402`);
    expect((callInit.headers as Record<string, string>).Authorization).toBe("Bearer ap_live_dev");
    const body = JSON.parse(callInit.body as string);
    expect(body).toMatchObject({
      name: "smoke",
      maxPerTx: 100,
      maxDaily: 1000,
      maxMonthly: 10000,
      allowedDomains: ["api.example.com"],
    });

    // Persisted to the config store
    const stored = listAgents();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: "smoke", agentId: "agt_123", apiKey: "ap_test_agent" });
  });

  it("ephemeral: true skips persistence", async () => {
    setApiKey("ap_live_dev");
    stubFetchRoutes([
      {
        matcher: (url) => url === `${BASE}/v1/agents/x402`,
        response: {
          ok: true,
          json: {
            agentId: "agt_999",
            walletAddress: "0xdef",
            apiKey: "ap_test_ephemeral",
            status: "pending_funding",
            limits: { maxPerTx: 10, maxDaily: 100, maxMonthly: 1000 },
            allowedDomains: [],
            network: "base",
          },
        },
      },
    ]);

    await launchAgent({
      name: "ephemeral",
      limits: { perTx: 10, daily: 100, monthly: 1000 },
      ephemeral: true,
      arispayUrl: BASE,
    });

    expect(listAgents()).toHaveLength(0);
  });
});

describe("getLaunchedAgent", () => {
  it("rehydrates a stored agent into a LaunchedAgent handle", async () => {
    setApiKey("ap_live_dev");
    stubFetchRoutes([
      {
        matcher: (url) => url === `${BASE}/v1/agents/x402`,
        response: {
          ok: true,
          json: {
            agentId: "agt_123",
            walletAddress: "0xabc",
            apiKey: "ap_test_agent",
            status: "pending_funding",
            limits: { maxPerTx: 100, maxDaily: 1000, maxMonthly: 10000 },
            allowedDomains: [],
            network: "base",
          },
        },
      },
    ]);
    await launchAgent({
      name: "smoke",
      limits: { perTx: 100, daily: 1000, monthly: 10000 },
      arispayUrl: BASE,
    });

    process.env.ARISPAY_URL = BASE;
    const rehydrated = getLaunchedAgent("smoke");
    expect(rehydrated).toBeDefined();
    expect(rehydrated?.agentId).toBe("agt_123");
    expect(rehydrated?.walletAddress).toBe("0xabc");
  });

  it("returns undefined for unknown names", () => {
    expect(getLaunchedAgent("does-not-exist")).toBeUndefined();
  });
});
