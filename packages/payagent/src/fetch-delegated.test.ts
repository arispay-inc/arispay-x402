import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DelegatedPaymentInfo, payFetchDelegated } from "./fetch-delegated.js";

const baseAccept = {
  scheme: "exact" as const,
  network: "eip155:8453",
  amount: "10000",
  resource: "https://example.com/api",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0xabcdef1234567890abcdef1234567890abcdef12",
  extra: { name: "USD Coin", version: "2" },
};

const signResponse = {
  paymentHeader: "b64payload",
  chain: "base",
  status: "settled",
  walletAddress: "0xwallet",
  spend: {
    amountCents: 1,
    dailySpend: 401,
    monthlySpend: 1201,
    limits: { maxPerTx: 50, maxDaily: 1000, maxMonthly: 10000 },
  },
};

function challenge402(): Response {
  return new Response(JSON.stringify({ x402Version: 2, accepts: [baseAccept] }), {
    status: 402,
    headers: { "content-type": "application/json" },
  });
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("payFetchDelegated — delegated-sign roundtrip", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function arm() {
    // 1st: seller 402 challenge; 2nd: ArisPay sign; 3rd: paid retry.
    fetchMock
      .mockResolvedValueOnce(challenge402())
      .mockResolvedValueOnce(ok(signResponse))
      .mockResolvedValueOnce(ok({ data: "paid content" }));
  }

  it("retries with the signed X-PAYMENT header and returns the paid response", async () => {
    arm();
    const fetch402 = payFetchDelegated({ arispayUrl: "https://api.test", apiKey: "ap_test_x" });
    const res = await fetch402("https://example.com/api");
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [signUrl, signInit] = fetchMock.mock.calls[1] ?? [];
    expect(signUrl).toBe("https://api.test/v1/x402/delegated-sign");
    expect((signInit as RequestInit).method).toBe("POST");
    const retryInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(new Headers(retryInit.headers).get("X-PAYMENT")).toBe("b64payload");
  });

  it("fires onPayment with post-payment spend and computed remaining headroom", async () => {
    arm();
    const seen: DelegatedPaymentInfo[] = [];
    const fetch402 = payFetchDelegated({
      arispayUrl: "https://api.test",
      apiKey: "ap_test_x",
      onPayment: (info) => seen.push(info),
    });
    await fetch402("https://example.com/api");

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      amountCents: 1,
      chain: "base",
      walletAddress: "0xwallet",
      dailySpend: 401,
      monthlySpend: 1201,
      limits: { maxPerTx: 50, maxDaily: 1000, maxMonthly: 10000 },
      remainingDaily: 599,
      remainingMonthly: 8799,
    });
  });

  it("clamps remaining headroom at zero when spend exceeds the cap", async () => {
    fetchMock
      .mockResolvedValueOnce(challenge402())
      .mockResolvedValueOnce(
        ok({
          ...signResponse,
          spend: { ...signResponse.spend, dailySpend: 1200, monthlySpend: 10500 },
        }),
      )
      .mockResolvedValueOnce(ok({ data: "paid content" }));
    const seen: DelegatedPaymentInfo[] = [];
    const fetch402 = payFetchDelegated({
      arispayUrl: "https://api.test",
      apiKey: "ap_test_x",
      onPayment: (info) => seen.push(info),
    });
    await fetch402("https://example.com/api");
    expect(seen[0]?.remainingDaily).toBe(0);
    expect(seen[0]?.remainingMonthly).toBe(0);
  });

  it("a throwing onPayment callback does not break the payment flow", async () => {
    arm();
    const fetch402 = payFetchDelegated({
      arispayUrl: "https://api.test",
      apiKey: "ap_test_x",
      onPayment: () => {
        throw new Error("listener bug");
      },
    });
    const res = await fetch402("https://example.com/api");
    expect(res.status).toBe(200);
  });

  it("does not fire onPayment for non-402 responses", async () => {
    fetchMock.mockResolvedValueOnce(ok({ data: "free content" }));
    const onPayment = vi.fn();
    const fetch402 = payFetchDelegated({
      arispayUrl: "https://api.test",
      apiKey: "ap_test_x",
      onPayment,
    });
    const res = await fetch402("https://example.com/api");
    expect(res.status).toBe(200);
    expect(onPayment).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
