import { describe, expect, it } from "vitest";
import { buildChallengeHeaders } from "./core.js";

// Local minimal shape — paygate's X402PaymentAccept lives in core.ts
// and isn't exported. Tests don't need the full type, just the wire
// shape the helper consumes.
type X402PaymentAccept = {
  scheme: "exact";
  network: string;
  amount: string;
  resource: string;
  asset: string;
  payTo: string;
  extra: { name: string; version: string };
};

const baseAccept: X402PaymentAccept = {
  scheme: "exact",
  network: "eip155:8453",
  amount: "10000",
  resource: "https://example.com/api/protected",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0xabcdef1234567890abcdef1234567890abcdef12",
  extra: { name: "USD Coin", version: "2" },
};

const baseBody = {
  error: "Payment Required",
  x402Version: 2,
  accepts: [baseAccept],
  facilitator: "https://facilitator.arispay.app",
  gasSponsored: true,
};

describe("buildChallengeHeaders", () => {
  it("emits payment-required as base64-encoded JSON of the body", () => {
    const headers = buildChallengeHeaders(baseBody, [baseAccept]);
    const decoded = Buffer.from(headers["payment-required"], "base64").toString("utf8");
    expect(JSON.parse(decoded)).toEqual(baseBody);
  });

  it("keeps X-Payment-Requirements as raw JSON of {x402Version, accepts} only", () => {
    const headers = buildChallengeHeaders(baseBody, [baseAccept]);
    expect(JSON.parse(headers["X-Payment-Requirements"])).toEqual({
      x402Version: 2,
      accepts: [baseAccept],
    });
  });

  it("declares x402 in WWW-Authenticate", () => {
    const headers = buildChallengeHeaders(baseBody, [baseAccept]);
    expect(headers["WWW-Authenticate"]).toBe("x402");
  });

  it("exposes the canonical headers via CORS", () => {
    const headers = buildChallengeHeaders(baseBody, [baseAccept]);
    const expose = headers["Access-Control-Expose-Headers"];
    expect(expose).toContain("payment-required");
    expect(expose).toContain("x-payment-response");
  });

  it("strips non-printable-ASCII from the legacy header (Latin1 safety)", () => {
    const acceptsWithEmDash: X402PaymentAccept[] = [
      {
        ...baseAccept,
        extra: { ...baseAccept.extra, name: "USD — Coin" },
      },
    ];
    const bodyWithEmDash = { ...baseBody, accepts: acceptsWithEmDash };
    const headers = buildChallengeHeaders(bodyWithEmDash, acceptsWithEmDash);

    // Legacy header should have ? replacements — em dash (U+2014) is char 8212.
    expect(headers["X-Payment-Requirements"]).not.toMatch(/—/);
    expect(/[^\x20-\x7E]/.test(headers["X-Payment-Requirements"])).toBe(false);

    // Canonical header preserves the em dash via base64 round-trip.
    const decoded = Buffer.from(headers["payment-required"], "base64").toString("utf8");
    expect(decoded).toContain("—");
  });

  it("canonical header is valid base64 (alphabet only, padding optional)", () => {
    const headers = buildChallengeHeaders(baseBody, [baseAccept]);
    expect(headers["payment-required"]).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

// ── EUR (EURC) currency support ──────────────────────
//
// `currency: "EUR"` switches the settlement asset to Circle EURC. These
// tests drive handlePaywall through the v2-shim challenge path (no network
// I/O) and pin the on-chain-verified EURC constants — a wrong address or
// EIP-712 name silently breaks every EUR payment.
import { handlePaywall } from "./core.js";

const WALLET = "0xabcdef1234567890abcdef1234567890abcdef12";
const RESOURCE = "https://merchant.example.com/api/data";

async function challengeFor(config: Record<string, unknown>, priceCents = 100) {
  const result = await handlePaywall(
    config as Parameters<typeof handlePaywall>[0],
    { priceCents },
    RESOURCE,
    undefined,
  );
  if (result.error) throw new Error(`expected challenge, got error: ${result.error.body.error}`);
  return result.challenge!;
}

describe("currency: EUR (v2-shim path)", () => {
  it("emits the on-chain-verified EURC asset + domain on Base mainnet", async () => {
    const challenge = await challengeFor({ wallet: WALLET, network: "base", currency: "EUR" });
    const accept = challenge.body.accepts[0]!;
    expect(accept.asset).toBe("0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42");
    expect(accept.extra).toEqual({ name: "EURC", version: "2" });
    expect(accept.network).toBe("eip155:8453");
  });

  it("emits the Base Sepolia EURC asset for testnet", async () => {
    const challenge = await challengeFor({
      wallet: WALLET,
      network: "base-sepolia",
      currency: "EUR",
    });
    const accept = challenge.body.accepts[0]!;
    expect(accept.asset).toBe("0x808456652fdb597867f38412077A9182bf77359F");
    expect(accept.extra).toEqual({ name: "EURC", version: "2" });
  });

  it("converts EUR cents with the same 10^4 factor (EURC has 6 decimals)", async () => {
    const challenge = await challengeFor(
      { wallet: WALLET, network: "base", currency: "EUR" },
      250, // €2.50
    );
    expect(challenge.body.accepts[0]!.amount).toBe("2500000");
  });

  it("errors clearly on networks with no verified EURC address", async () => {
    const result = await handlePaywall(
      { wallet: WALLET, network: "polygon", currency: "EUR" },
      { priceCents: 100 },
      RESOURCE,
      undefined,
    );
    expect(result.paid).toBe(false);
    expect(result.error?.body.error).toContain("no known EURC address");
  });

  it("honours an explicit asset override under EUR", async () => {
    const challenge = await challengeFor({
      wallet: WALLET,
      network: "polygon",
      currency: "EUR",
      asset: "0x1111111111111111111111111111111111111111",
    });
    expect(challenge.body.accepts[0]!.asset).toBe("0x1111111111111111111111111111111111111111");
  });

  it("defaults to USDC when currency is omitted (no behavior change)", async () => {
    const challenge = await challengeFor({ wallet: WALLET, network: "base" });
    const accept = challenge.body.accepts[0]!;
    expect(accept.asset).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(accept.extra).toEqual({ name: "USD Coin", version: "2" });
  });
});

// ── v3 manifest path: EUR rail selection ─────────────
//
// Locks the manifest-rail selection contract the changeset documents:
// currency EUR picks the rail whose assetName is "EURC"; absence of a EUR
// rail is a clear configuration error, not a silent USDC fallback.
import { afterEach, vi } from "vitest";

function manifestResponse(rails: Array<Record<string, unknown>>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      version: "1",
      merchant: { slug: "test-merchant", name: "Test" },
      trust: { minTier: "any" },
      rails,
      updated: new Date().toISOString(),
    }),
  } as Response;
}

const USDC_RAIL = {
  scheme: "x402",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  assetName: "USDC",
  payTo: WALLET,
  facilitator: "https://facilitator.arispay.app",
};
const EURC_RAIL = {
  ...USDC_RAIL,
  asset: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
  assetName: "EURC",
};

describe("currency: EUR (v3 manifest path)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("selects the EURC rail when currency is EUR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(manifestResponse([USDC_RAIL, EURC_RAIL])),
    );
    const challenge = await challengeFor({ merchantId: "m_eur_pick", currency: "EUR" });
    const accept = challenge.body.accepts[0]!;
    expect(accept.asset).toBe(EURC_RAIL.asset);
    expect(accept.extra).toEqual({ name: "EURC", version: "2" });
  });

  it("errors clearly (no silent USDC fallback) when the merchant has no EUR rail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(manifestResponse([USDC_RAIL])));
    const result = await handlePaywall(
      { merchantId: "m_eur_missing", currency: "EUR" },
      { priceCents: 100 },
      RESOURCE,
      undefined,
    );
    expect(result.paid).toBe(false);
    expect(result.error?.body.error).toContain("no EUR (EURC) payout rail");
  });

  it("keeps the rails[0] fallback for USD callers (pre-EUR manifests unchanged)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(manifestResponse([USDC_RAIL])));
    const challenge = await challengeFor({ merchantId: "m_usd_fallback" });
    expect(challenge.body.accepts[0]!.asset).toBe(USDC_RAIL.asset);
  });
});

// ── Settlement validation (L7) ───────────────────────

const PAYER = "0x1111111111111111111111111111111111111111";
const PAYEE = "0x2222222222222222222222222222222222222222";

function makePaymentHeader(payer: string = PAYER) {
  const payload = {
    x402Version: 2,
    scheme: "exact",
    network: "eip155:8453",
    payload: {
      signature: "0xsig",
      authorization: {
        from: payer,
        to: PAYEE,
        value: "10000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: "0xabcd",
      },
    },
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function settleResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      transaction: "0xtxhash",
      payer: PAYER,
      ...overrides,
    }),
  } as Response;
}

describe("handlePaywall settlement", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a v3 manifest rail with a missing or non-HTTPS facilitator", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        manifestResponse([{ ...USDC_RAIL, facilitator: "http://insecure.example.com" }]),
      ),
    );
    const result = await handlePaywall(
      { merchantId: "m_bad_facilitator" },
      { priceCents: 100 },
      RESOURCE,
      makePaymentHeader(),
    );
    expect(result.paid).toBe(false);
    expect(result.error?.body.error).toContain("invalid facilitator URL");
  });

  function mockSettleFetch(settleOverrides: Record<string, unknown> = {}) {
    return vi.fn().mockImplementation((url: string) => {
      if (url.includes("/capabilities")) {
        return manifestResponse([USDC_RAIL]);
      }
      return settleResponse(settleOverrides);
    });
  }

  it("accepts a valid facilitator settlement", async () => {
    vi.stubGlobal("fetch", mockSettleFetch());
    const result = await handlePaywall(
      { merchantId: "m_ok" },
      { priceCents: 100 },
      RESOURCE,
      makePaymentHeader(),
    );
    expect(result.paid).toBe(true);
    expect(result.receipt?.txHash).toBe("0xtxhash");
  });

  it("rejects a success response without a transaction hash", async () => {
    vi.stubGlobal("fetch", mockSettleFetch({ transaction: "" }));
    const result = await handlePaywall(
      { merchantId: "m_ok" },
      { priceCents: 100 },
      RESOURCE,
      makePaymentHeader(),
    );
    expect(result.paid).toBe(false);
    expect(result.error?.body.code).toBe("INVALID_SETTLEMENT");
  });

  it("rejects a success response with a mismatched payer", async () => {
    vi.stubGlobal(
      "fetch",
      mockSettleFetch({ payer: "0x9999999999999999999999999999999999999999" }),
    );
    const result = await handlePaywall(
      { merchantId: "m_ok" },
      { priceCents: 100 },
      RESOURCE,
      makePaymentHeader(),
    );
    expect(result.paid).toBe(false);
    expect(result.error?.body.code).toBe("INVALID_SETTLEMENT");
  });
});

// ── Self-settle (seller-submitted settlement) ────────
//
// Never-sponsor / never-charge: with `selfSettle` configured the SDK
// verifies via the facilitator (free) and submits the EIP-3009
// transferWithAuthorization from the seller's own key — the facilitator's
// /settle is never called.

const ethersMocks = vi.hoisted(() => {
  const wait = vi.fn().mockResolvedValue({ status: 1, hash: "0xselftx" });
  const transferWithAuthorization = vi.fn().mockResolvedValue({ wait, hash: "0xselftx" });
  return {
    wait,
    transferWithAuthorization,
    JsonRpcProvider: vi.fn(),
    Wallet: vi.fn(),
    Contract: vi.fn().mockImplementation(() => ({ transferWithAuthorization })),
    Signature: { from: vi.fn().mockReturnValue({ v: 27, r: "0xr", s: "0xs" }) },
  };
});

vi.mock("ethers", () => ({
  JsonRpcProvider: ethersMocks.JsonRpcProvider,
  Wallet: ethersMocks.Wallet,
  Contract: ethersMocks.Contract,
  Signature: ethersMocks.Signature,
}));

const SELF_SETTLE = { privateKey: `0x${"11".repeat(32)}` };

function mockVerifyFetch(verdict: { isValid: boolean; invalidReason?: string }) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/capabilities")) return manifestResponse([USDC_RAIL]);
    if (url.includes("/verify")) {
      return { ok: true, status: 200, json: async () => verdict } as Response;
    }
    throw new Error(`unexpected fetch in self-settle mode: ${url}`);
  });
}

describe("handlePaywall self-settle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("verifies via facilitator, submits from the seller's key, never calls /settle", async () => {
    const fetchMock = mockVerifyFetch({ isValid: true });
    vi.stubGlobal("fetch", fetchMock);
    const result = await handlePaywall(
      { merchantId: "m_self", selfSettle: SELF_SETTLE },
      { priceCents: 100 },
      RESOURCE,
      makePaymentHeader(),
    );
    expect(result.paid).toBe(true);
    expect(result.receipt?.txHash).toBe("0xselftx");
    expect(result.settlement?.payer).toBe(PAYER);
    expect(ethersMocks.transferWithAuthorization).toHaveBeenCalledWith(
      PAYER,
      PAYEE,
      "10000",
      "0",
      "9999999999",
      "0xabcd",
      27,
      "0xr",
      "0xs",
    );
    const urls = fetchMock.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(urls.some((u: string) => u.includes("/settle"))).toBe(false);
  });

  it("returns 402 without submitting when facilitator verification fails", async () => {
    vi.stubGlobal("fetch", mockVerifyFetch({ isValid: false, invalidReason: "invalid_signature" }));
    const result = await handlePaywall(
      { merchantId: "m_self", selfSettle: SELF_SETTLE },
      { priceCents: 100 },
      RESOURCE,
      makePaymentHeader(),
    );
    expect(result.paid).toBe(false);
    expect(result.error?.statusCode).toBe(402);
    expect(result.error?.body.code).toBe("invalid_signature");
    expect(ethersMocks.transferWithAuthorization).not.toHaveBeenCalled();
  });

  it("fails clearly on an unknown network with no rpcUrl override", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/capabilities"))
          return manifestResponse([{ ...USDC_RAIL, network: "eip155:1" }]);
        if (url.includes("/verify"))
          return { ok: true, status: 200, json: async () => ({ isValid: true }) } as Response;
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const result = await handlePaywall(
      { merchantId: "m_self_unknown_net", selfSettle: SELF_SETTLE },
      { priceCents: 100 },
      RESOURCE,
      makePaymentHeader(),
    );
    expect(result.paid).toBe(false);
    expect(result.error?.body.code).toBe("SELF_SETTLE_CONFIG");
    expect(result.error?.body.error).toContain("set selfSettle.rpcUrl");
  });
});
