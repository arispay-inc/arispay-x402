/**
 * Tests for payFetchLocal — the permissionless (local-signer) mode.
 *
 * The load-bearing assertion is signature correctness: a wrong EIP-712
 * domain or type layout produces a signature that recovers to the wrong
 * address and fails facilitator verify *silently*. Tests recover the
 * signer from the emitted X-PAYMENT with ethers.verifyTypedData against
 * the seller-supplied domain — the same math the facilitator runs.
 */
import { ethers } from "ethers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentRejectedError } from "./errors.js";
import { payFetchLocal } from "./fetch-local.js";

// Hardhat/Anvil account #0 — a well-known public test key, never mainnet-funded.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MERCHANT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RESOURCE = "https://api.example.com/premium";

const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

const CHALLENGE_ACCEPT = {
  scheme: "exact",
  network: "eip155:8453",
  amount: "1000000", // 1 USDC
  resource: RESOURCE,
  asset: USDC_BASE,
  payTo: MERCHANT,
  extra: { name: "USD Coin", version: "2" },
};

function paymentRequiredResponse(accepts: unknown[] = [CHALLENGE_ACCEPT]) {
  return new Response(JSON.stringify({ x402Version: 2, accepts }), {
    status: 402,
    headers: { "content-type": "application/json" },
  });
}

function okResponse(body = "premium content") {
  return new Response(body, { status: 200 });
}

function decodeHeader(headers: Headers) {
  const header = headers.get("X-PAYMENT");
  expect(header).toBeTruthy();
  return JSON.parse(Buffer.from(header!, "base64").toString("utf-8"));
}

describe("payFetchLocal", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("throws without a private key", () => {
    // @ts-expect-error — intentionally missing
    expect(() => payFetchLocal({})).toThrow(/privateKey is required/);
  });

  it("returns non-402 responses untouched (no signing, no retry)", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const fetch402 = payFetchLocal({ privateKey: TEST_KEY });
    const res = await fetch402(RESOURCE);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("signs the 402 locally and retries with X-PAYMENT; signature recovers the payer", async () => {
    fetchMock
      .mockResolvedValueOnce(paymentRequiredResponse())
      .mockResolvedValueOnce(okResponse());

    const fetch402 = payFetchLocal({ privateKey: TEST_KEY });
    const res = await fetch402(RESOURCE);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryInit = fetchMock.mock.calls[1]![1] as RequestInit;
    const decoded = decodeHeader(new Headers(retryInit.headers));

    expect(decoded.x402Version).toBe(2);
    // The challenge accept is embedded verbatim — v2 requirement matching
    // is a deepEqual, so any mutation here silently fails settlement.
    expect(decoded.accepted).toEqual(CHALLENGE_ACCEPT);
    // v2 carries resource as a ResourceInfo object, not a bare string.
    expect(decoded.resource).toEqual({ url: RESOURCE });

    const auth = decoded.payload.authorization;
    expect(auth.from).toBe(TEST_ADDRESS);
    expect(auth.to).toBe(MERCHANT);
    expect(auth.value).toBe("1000000");
    expect(Number(auth.validBefore) - Number(auth.validAfter)).toBe(540); // 8-min window + 60s backdate
    expect(auth.nonce).toMatch(/^0x[0-9a-f]{64}$/);

    const recovered = ethers.verifyTypedData(
      { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC_BASE },
      TRANSFER_TYPES,
      {
        from: auth.from,
        to: auth.to,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce,
      },
      decoded.payload.signature,
    );
    expect(recovered).toBe(TEST_ADDRESS);
  });

  it("fires onPayment with the amount, payTo and paying wallet", async () => {
    fetchMock
      .mockResolvedValueOnce(paymentRequiredResponse())
      .mockResolvedValueOnce(okResponse());
    const onPayment = vi.fn();
    const fetch402 = payFetchLocal({ privateKey: TEST_KEY, onPayment });
    await fetch402(RESOURCE);
    expect(onPayment).toHaveBeenCalledWith({
      amount: "1000000",
      network: "eip155:8453",
      asset: USDC_BASE,
      payTo: MERCHANT,
      walletAddress: TEST_ADDRESS,
    });
  });

  it("refuses to sign above maxPerTxBaseUnits", async () => {
    fetchMock.mockResolvedValueOnce(paymentRequiredResponse());
    const fetch402 = payFetchLocal({
      privateKey: TEST_KEY,
      maxPerTxBaseUnits: "500000", // $0.50 < $1.00 ask
    });
    await expect(fetch402(RESOURCE)).rejects.toThrow(PaymentRejectedError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // never retried, never signed
  });

  it("throws when no eip155 accept is offered", async () => {
    fetchMock.mockResolvedValueOnce(
      paymentRequiredResponse([{ ...CHALLENGE_ACCEPT, network: "solana:5eykt4" }]),
    );
    const fetch402 = payFetchLocal({ privateKey: TEST_KEY });
    await expect(fetch402(RESOURCE)).rejects.toThrow(/eip155/);
  });

  it("throws when the EIP-712 domain fields are missing from the accept", async () => {
    const { extra: _extra, ...noExtra } = CHALLENGE_ACCEPT;
    fetchMock.mockResolvedValueOnce(paymentRequiredResponse([noExtra]));
    const fetch402 = payFetchLocal({ privateKey: TEST_KEY });
    await expect(fetch402(RESOURCE)).rejects.toThrow(/extra\.name/);
  });

  it("surfaces the seller's rejection body when the retry still 402s", async () => {
    fetchMock
      .mockResolvedValueOnce(paymentRequiredResponse())
      .mockResolvedValueOnce(new Response("invalid signature", { status: 402 }));
    const fetch402 = payFetchLocal({ privateKey: TEST_KEY });
    await expect(fetch402(RESOURCE)).rejects.toThrow(/invalid signature/);
  });

  it("accepts v1 maxAmountRequired challenges (normalized by parseRequirements)", async () => {
    const { amount: _amount, ...rest } = CHALLENGE_ACCEPT;
    const v1Accept = { ...rest, maxAmountRequired: "1000000" };
    fetchMock
      .mockResolvedValueOnce(paymentRequiredResponse([v1Accept]))
      .mockResolvedValueOnce(okResponse());
    const fetch402 = payFetchLocal({ privateKey: TEST_KEY });
    const res = await fetch402(RESOURCE);
    expect(res.status).toBe(200);
    const retryInit = fetchMock.mock.calls[1]![1] as RequestInit;
    const decoded = decodeHeader(new Headers(retryInit.headers));
    expect(decoded.payload.authorization.value).toBe("1000000");
  });
});
