/**
 * Tests for DelegationClient.getHostedTopup.
 *
 * Exercises the two important branches:
 *   1. Server returns a real Coinbase URL when ARISPAY_ONRAMP_PROVIDER=coinbase.
 *   2. Server returns 501 when onramp isn't configured → we translate into
 *      `HostedTopupNotConfiguredError` so callers can fall back gracefully.
 *
 * `global.fetch` is stubbed per test; no real network calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DelegationClient, HostedTopupNotConfiguredError } from "./delegation.js";

// ── Shared fetch stubber used by every test below ─────────────────────────

const BASE = "https://api.arispay.test";

function stubFetch(
  cases: Array<{
    status: number;
    body: unknown;
  }>,
): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  let i = 0;
  fn.mockImplementation(async () => {
    const c = cases[Math.min(i, cases.length - 1)];
    i += 1;
    const body = JSON.stringify(c.body);
    return {
      ok: c.status >= 200 && c.status < 300,
      status: c.status,
      statusText: c.status === 501 ? "Not Implemented" : "OK",
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
beforeEach(() => {
  origFetch = globalThis.fetch;
});
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = origFetch;
  vi.restoreAllMocks();
});

describe("DelegationClient.getHostedTopup", () => {
  it("returns a structured funding link on 200", async () => {
    const fetch = stubFetch([
      {
        status: 200,
        body: {
          fundingUrl: "https://pay.coinbase.com/buy/select-asset?appId=x",
          expiresAt: "2026-04-22T12:00:00Z",
          provider: "coinbase",
          walletAddress: "0xabc",
          network: "base",
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    const result = await client.getHostedTopup("agt_123", { amount: 50 });
    expect(result.fundingUrl).toContain("pay.coinbase.com");
    expect(result.provider).toBe("coinbase");

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/agents/agt_123/hosted-topup`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ amount: 50 });
  });

  it("omits amount from the body when not provided", async () => {
    const fetch = stubFetch([
      {
        status: 200,
        body: {
          fundingUrl: "https://pay.coinbase.com/buy/select-asset?appId=x",
          expiresAt: "2026-04-22T12:00:00Z",
          provider: "coinbase",
          walletAddress: "0xabc",
          network: "base",
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    await client.getHostedTopup("agt_123");
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("translates 501 into HostedTopupNotConfiguredError so callers can branch", async () => {
    stubFetch([
      {
        status: 501,
        body: {
          error: {
            code: "fiat_onramp_not_configured",
            message: "Hosted fiat top-up is not yet available on this deployment.",
          },
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    await expect(client.getHostedTopup("agt_123")).rejects.toBeInstanceOf(
      HostedTopupNotConfiguredError,
    );
  });

  it("propagates other non-2xx responses as regular errors", async () => {
    stubFetch([
      {
        status: 404,
        body: { error: { code: "agent_not_found", message: "nope" } },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    await expect(client.getHostedTopup("agt_missing")).rejects.not.toBeInstanceOf(
      HostedTopupNotConfiguredError,
    );
  });
});

// ── Phase 3a — end-user helpers ───────────────────────────────────────────

describe("DelegationClient.createEndUser", () => {
  it("POSTs to /v1/users with the developer bearer", async () => {
    const fetch = stubFetch([
      {
        status: 201,
        body: {
          id: "eu_123",
          externalId: "tg:12345",
          email: "a@b.co",
          hasPaymentMethod: false,
          hasWallet: false,
          createdAt: "2026-04-22T00:00:00Z",
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    const user = await client.createEndUser({ externalId: "tg:12345", email: "a@b.co" });
    expect(user.id).toBe("eu_123");
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/users`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ap_live_dev");
    expect(JSON.parse(init.body as string)).toEqual({
      externalId: "tg:12345",
      email: "a@b.co",
    });
  });
});

describe("DelegationClient.createCardSetupSession", () => {
  it("returns { token, setupUrl, expiresAt }", async () => {
    stubFetch([
      {
        status: 201,
        body: {
          token: "plaintext-token-xyz",
          setupUrl: "https://arispay.app/card-setup/plaintext-token-xyz",
          expiresAt: "2026-04-22T00:15:00Z",
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    const session = await client.createCardSetupSession({ endUserId: "eu_123" });
    expect(session.token).toBe("plaintext-token-xyz");
    expect(session.setupUrl).toContain("/card-setup/");
  });
});

describe("DelegationClient.pollCardSetup", () => {
  it("resolves when status reaches `completed`", async () => {
    const fetch = stubFetch([
      { status: 200, body: { status: "pending" } },
      { status: 200, body: { status: "tokenized" } },
      { status: 200, body: { status: "completed", cardLast4: "4242", cardBrand: "visa" } },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    const result = await client.pollCardSetup("plaintext-token-xyz", {
      intervalMs: 1,
      timeoutMs: 1000,
    });
    expect(result.status).toBe("completed");
    expect(result.cardLast4).toBe("4242");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("resolves on `expired` without throwing", async () => {
    stubFetch([{ status: 200, body: { status: "expired" } }]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    const result = await client.pollCardSetup("plaintext-token-xyz", {
      intervalMs: 1,
      timeoutMs: 1000,
    });
    expect(result.status).toBe("expired");
  });

  it("times out when the session stays pending too long", async () => {
    stubFetch([{ status: 200, body: { status: "pending" } }]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    await expect(
      client.pollCardSetup("plaintext-token-xyz", { intervalMs: 5, timeoutMs: 10 }),
    ).rejects.toThrow(/timed out/);
  });
});

describe("DelegationClient.attachWallet", () => {
  it("POSTs type=wallet + chain", async () => {
    const fetch = stubFetch([
      {
        status: 200,
        body: {
          walletAddress: "0xabc",
          chain: "base",
          spenderAddress: "0xdef",
          usdcContractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    await client.attachWallet("eu_123", { walletAddress: "0xabc", chain: "base" });
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      type: "wallet",
      walletAddress: "0xabc",
      chain: "base",
    });
  });
});

describe("DelegationClient.setUserLimits", () => {
  it("PUTs the cents values and MCC arrays to /v1/users/:id/limits", async () => {
    const fetch = stubFetch([
      {
        status: 200,
        body: {
          id: "sl_1",
          endUserId: "eu_123",
          agentId: "agt_456",
          maxPerTransaction: 500,
          maxDaily: 5000,
          maxMonthly: 50000,
          allowedMCCs: ["5411"],
          blockedMCCs: [],
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    await client.setUserLimits("eu_123", {
      agentId: "agt_456",
      maxPerTransaction: 500,
      maxDaily: 5000,
      maxMonthly: 50000,
      allowedMerchantCategories: ["5411"],
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/users/eu_123/limits`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      agentId: "agt_456",
      maxPerTransaction: 500,
      maxDaily: 5000,
      maxMonthly: 50000,
      allowedMerchantCategories: ["5411"],
    });
  });
});

describe("DelegationClient.createPayment", () => {
  it("POSTs /v1/payments with agentId + cents amount + auto-generated idempotencyKey", async () => {
    const fetch = stubFetch([
      {
        status: 200,
        body: {
          id: "pay_1",
          status: "succeeded",
          amount: 500,
          currency: "USD",
          rail: "balance",
          memo: "test",
          agentId: "agt_1",
          paymentMode: "autonomous",
          createdAt: "2026-04-22T00:00:00Z",
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    const result = await client.createPayment("agt_1", {
      amount: 500,
      memo: "test",
      merchantUrl: "https://example.com",
    });
    expect(result.id).toBe("pay_1");
    expect(result.rail).toBe("balance");

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/payments`);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.agentId).toBe("agt_1");
    expect(body.amount).toBe(500);
    expect(body.currency).toBe("USD");
    expect(body.memo).toBe("test");
    expect(body.merchantUrl).toBe("https://example.com");
    // idempotencyKey was auto-generated
    expect(typeof body.idempotencyKey).toBe("string");
    expect((body.idempotencyKey as string).startsWith("payagent-")).toBe(true);
  });

  it("respects a caller-provided idempotencyKey", async () => {
    const fetch = stubFetch([
      {
        status: 200,
        body: {
          id: "pay_2",
          status: "succeeded",
          amount: 100,
          currency: "USD",
          rail: "balance",
          memo: "m",
          agentId: "agt_1",
          paymentMode: "autonomous",
          createdAt: "2026-04-22T00:00:00Z",
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    await client.createPayment("agt_1", {
      amount: 100,
      memo: "m",
      idempotencyKey: "my-explicit-key-123",
    });
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.idempotencyKey).toBe("my-explicit-key-123");
  });

  it("surfaces requires_action + nextAction for 3DS challenges", async () => {
    stubFetch([
      {
        status: 200,
        body: {
          id: "pay_3",
          status: "requires_action",
          amount: 4500,
          currency: "USD",
          rail: "card",
          memo: "test",
          agentId: "agt_1",
          paymentMode: "platform",
          createdAt: "2026-04-22T00:00:00Z",
          nextAction: {
            type: "three_ds_challenge",
            challengeUrl: "https://acs.example/challenge/abc",
          },
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    const result = await client.createPayment("agt_1", {
      amount: 4500,
      memo: "test",
      userId: "eu_123",
    });
    expect(result.status).toBe("requires_action");
    expect(result.nextAction?.type).toBe("three_ds_challenge");
    expect(result.nextAction?.challengeUrl).toBe("https://acs.example/challenge/abc");
  });
});

describe("DelegationClient.getWalletStatus", () => {
  it("GETs the /wallet-status path", async () => {
    const fetch = stubFetch([
      {
        status: 200,
        body: {
          walletAddress: "0xabc",
          chain: "base",
          spenderAddress: "0xdef",
          usdcContractAddress: "0x833589",
          usdcBalance: "1000000",
          usdcAllowance: "1000000000",
          allowanceSufficient: true,
          ready: true,
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    const result = await client.getWalletStatus("eu_123");
    expect(result.ready).toBe(true);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/users/eu_123/wallet-status`);
    expect(init.method).toBe("GET");
  });
});

describe("DelegationClient.listAgents", () => {
  it("hits GET /v1/agents with withDelegation=1 and flattens the x402 block", async () => {
    const fetch = stubFetch([
      {
        status: 200,
        body: {
          agents: [
            {
              id: "agent_travel",
              name: "Travel",
              createdAt: "2026-05-01T00:00:00.000Z",
              x402: {
                walletAddress: "0xTravel",
                network: "base",
                maxPerTx: 50,
                maxDaily: 1000,
                maxMonthly: 10000,
                allowedDomains: ["api.example.com"],
                custody: "delegated",
                suspended: false,
                fundedAt: "2026-05-02T00:00:00.000Z",
              },
            },
            // No x402 block — server returned an agent without a wallet.
            // The SDK should drop it from the wallet-listing view.
            {
              id: "agent_no_wallet",
              name: "NoWallet",
              createdAt: "2026-05-01T00:00:00.000Z",
            },
          ],
          total: 2,
          limit: 50,
          offset: 0,
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    const result = await client.listAgents();
    expect(result.total).toBe(2);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toEqual({
      agentId: "agent_travel",
      name: "Travel",
      walletAddress: "0xTravel",
      network: "base",
      limits: { maxPerTx: 50, maxDaily: 1000, maxMonthly: 10000 },
      allowedDomains: ["api.example.com"],
      custody: "delegated",
      suspended: false,
      fundedAt: "2026-05-02T00:00:00.000Z",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    const [url] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/agents?");
    expect(url).toContain("withDelegation=1");
  });

  it("forwards optional filter + pagination parameters", async () => {
    const fetch = stubFetch([
      { status: 200, body: { agents: [], total: 0, limit: 10, offset: 5 } },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    await client.listAgents({ name: "trav", status: "active", limit: 10, offset: 5 });
    const [url] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("name=trav");
    expect(url).toContain("status=active");
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=5");
  });
});

describe("DelegationClient.updateAgent", () => {
  it("forwards only the keys you set", async () => {
    const fetch = stubFetch([
      {
        status: 200,
        body: {
          id: "agent_xyz",
          name: "Travel",
          x402: {
            walletAddress: "0xA",
            network: "base",
            maxPerTx: 100,
            maxDaily: 1000,
            maxMonthly: 10000,
            allowedDomains: [],
            custody: "delegated",
            suspended: true,
            fundedAt: null,
          },
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    const result = await client.updateAgent("agent_xyz", {
      suspended: true,
      defaultMaxPerTransaction: 100,
    });
    expect(result.x402?.suspended).toBe(true);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/agents/agent_xyz`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      suspended: true,
      defaultMaxPerTransaction: 100,
    });
  });

  it("surfaces 400 errors from the server for invalid spend limits", async () => {
    stubFetch([
      {
        status: 400,
        body: {
          error: {
            code: "INVALID_REQUEST",
            message: "Spend limits must satisfy maxPerTx <= maxDaily <= maxMonthly",
          },
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    await expect(
      client.updateAgent("agent_xyz", {
        defaultMaxPerTransaction: 10000,
        defaultMaxDaily: 100,
      }),
    ).rejects.toThrow(/Spend limits must satisfy/);
  });
});

describe("DelegationClient activity feed", () => {
  it("listAgentPayments hits /v1/agents/:id/payments and forwards query params", async () => {
    const fetch = stubFetch([{ status: 200, body: { payments: [], nextCursor: null } }]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    await client.listAgentPayments("agent_travel", {
      status: "succeeded",
      rail: "crypto",
      limit: 10,
      cursor: "pay_xyz",
    });
    const [url] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/agents/agent_travel/payments?");
    expect(url).toContain("status=succeeded");
    expect(url).toContain("rail=crypto");
    expect(url).toContain("limit=10");
    expect(url).toContain("cursor=pay_xyz");
  });

  it("listOrgPayments always sends scope=org", async () => {
    const fetch = stubFetch([{ status: 200, body: { payments: [], nextCursor: null } }]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    await client.listOrgPayments({ limit: 5 });
    const [url] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/payments?");
    expect(url).toContain("scope=org");
    expect(url).toContain("limit=5");
  });

  it("returns the parsed feed response shape", async () => {
    stubFetch([
      {
        status: 200,
        body: {
          payments: [
            {
              id: "pay_a",
              createdAt: "2026-05-16T00:00:00Z",
              status: "succeeded",
              rail: "crypto",
              amount: 10,
              currency: "USD",
              merchantUrl: "https://api.example.com/premium",
              merchantName: null,
              memo: "GET /premium",
              errorCode: null,
              txHash: "0xabc",
              x402FacilitatorTx: "0xfac",
              fiservTxId: null,
              agent: { id: "agent_travel", name: "Travel" },
            },
          ],
          nextCursor: null,
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    const out = await client.listAgentPayments("agent_travel");
    expect(out.payments).toHaveLength(1);
    expect(out.payments[0].agent?.name).toBe("Travel");
  });
});

describe("DelegationClient.renameAgent", () => {
  it("PATCHes /v1/agents/:id with the new name and returns the flattened result", async () => {
    const fetch = stubFetch([
      {
        status: 200,
        body: {
          id: "agent_xyz",
          name: "Travel",
          x402: { walletAddress: "0xWal", network: "base" },
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    const result = await client.renameAgent("agent_xyz", "Travel");
    expect(result).toEqual({
      agentId: "agent_xyz",
      name: "Travel",
      walletAddress: "0xWal",
      network: "base",
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/agents/agent_xyz`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ name: "Travel" });
  });

  it("surfaces server-side 409 conflicts", async () => {
    stubFetch([
      {
        status: 409,
        body: {
          error: {
            code: "INVALID_REQUEST",
            message: "an agent with that name already exists in this organization",
          },
        },
      },
    ]);
    const client = new DelegationClient(BASE, "ap_live_dev");
    await expect(client.renameAgent("agent_xyz", "Travel")).rejects.toThrow(/already exists/);
  });
});
