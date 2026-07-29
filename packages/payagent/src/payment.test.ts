import { describe, expect, it } from "vitest";
import { parseRequirements } from "./payment.js";

const baseAccept = {
  scheme: "exact" as const,
  network: "eip155:8453",
  amount: "10000",
  resource: "https://example.com/api",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0xabcdef1234567890abcdef1234567890abcdef12",
  extra: { name: "USD Coin", version: "2" },
};

function makeResponse(init: { headers?: Record<string, string>; body?: unknown }): Response {
  const body = init.body == null ? "" : JSON.stringify(init.body);
  return new Response(body, {
    status: 402,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("parseRequirements — canonical header (payment-required, base64)", () => {
  it("parses the base64-encoded payment-required header", async () => {
    const challenge = { x402Version: 2, accepts: [baseAccept] };
    const value = Buffer.from(JSON.stringify(challenge), "utf8").toString("base64");
    const res = makeResponse({
      headers: { "payment-required": value },
      body: { error: "unrelated body" },
    });
    const parsed = await parseRequirements(res);
    expect(parsed.x402Version).toBe(2);
    expect(parsed.accepts).toHaveLength(1);
    expect(parsed.accepts[0].payTo).toBe(baseAccept.payTo);
  });

  it("falls back to body when payment-required has bad base64", async () => {
    const res = makeResponse({
      headers: { "payment-required": "!!! not base64 !!!" },
      body: { x402Version: 2, accepts: [baseAccept] },
    });
    const parsed = await parseRequirements(res);
    expect(parsed.accepts).toHaveLength(1);
  });
});

describe("parseRequirements — variant header (x-payment-required)", () => {
  it("parses base64 from the x-payment-required variant", async () => {
    const challenge = { x402Version: 2, accepts: [baseAccept] };
    const value = Buffer.from(JSON.stringify(challenge), "utf8").toString("base64");
    const res = makeResponse({
      headers: { "x-payment-required": value },
    });
    const parsed = await parseRequirements(res);
    expect(parsed.accepts).toHaveLength(1);
  });
});

describe("parseRequirements — legacy header (X-Payment-Requirements, raw JSON)", () => {
  it("parses raw JSON from the legacy paygate header", async () => {
    const value = JSON.stringify({ x402Version: 2, accepts: [baseAccept] });
    const res = makeResponse({
      headers: { "x-payment-requirements": value },
    });
    const parsed = await parseRequirements(res);
    expect(parsed.x402Version).toBe(2);
    expect(parsed.accepts[0].payTo).toBe(baseAccept.payTo);
  });

  it("canonical header wins over legacy when both present", async () => {
    const canonical = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepts: [{ ...baseAccept, payTo: "0xCANONICAL000000000000000000000000000000000" }],
      }),
      "utf8",
    ).toString("base64");
    const legacy = JSON.stringify({
      x402Version: 2,
      accepts: [{ ...baseAccept, payTo: "0xLEGACY00000000000000000000000000000000000" }],
    });
    const res = makeResponse({
      headers: {
        "payment-required": canonical,
        "x-payment-requirements": legacy,
      },
    });
    const parsed = await parseRequirements(res);
    expect(parsed.accepts[0].payTo).toBe("0xCANONICAL000000000000000000000000000000000");
  });
});

describe("parseRequirements — body fallback", () => {
  it("parses x402 v2 body when no header is set", async () => {
    const res = makeResponse({
      body: { x402Version: 2, accepts: [baseAccept] },
    });
    const parsed = await parseRequirements(res);
    expect(parsed.x402Version).toBe(2);
    expect(parsed.accepts[0].network).toBe("eip155:8453");
  });

  it("normalizes short-name network to CAIP-2", async () => {
    const res = makeResponse({
      body: {
        x402Version: 1,
        accepts: [{ ...baseAccept, network: "base" }],
      },
    });
    const parsed = await parseRequirements(res);
    expect(parsed.accepts[0].network).toBe("eip155:8453");
  });
});
