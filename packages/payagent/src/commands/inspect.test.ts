/**
 * Tests for `payagent inspect <url>` (and, through it, the SDK's
 * `inspectChallenge`).
 *
 * Locks in:
 *   - happy path: 402 parsed, base units AND integer-cents conversion shown
 *     (6-decimal assets: baseUnits / 10^4 = cents), never a float
 *   - v2 `amount` and v1 `maxAmountRequired` both accepted
 *   - non-402 → "does not appear to be x402-gated", exit 1
 *   - 402 with malformed JSON → graceful error, exit 1
 *   - never sends a payment or auth header
 *   - `facilitator` field surfaced as SERVER-declared
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let logLines: string[];
let errLines: string[];

beforeEach(() => {
  logLines = [];
  errLines = [];
  vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
    logLines.push(String(msg ?? ""));
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    errLines.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown, jsonThrows = false) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      status,
      async json() {
        if (jsonThrows) throw new SyntaxError("Unexpected token < in JSON");
        return body;
      },
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function mockExit() {
  return vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });
}

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("cmdInspect", () => {
  it("parses a v2 challenge and shows base units + integer cents + $ display", async () => {
    const { calls } = stubFetch(402, {
      error: "Payment Required",
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "30000", // 30000 base units / 10^4 = 3 cents
          resource: "https://api.acme.example/premium",
          asset: USDC_BASE,
          payTo: "0x1111111111111111111111111111111111111111",
          extra: { name: "USD Coin", version: "2" },
        },
      ],
      facilitator: "https://facilitator.arispay.app",
    });

    const { cmdInspect } = await import("./inspect.js");
    await cmdInspect(["https://api.acme.example/premium"]);

    // No payment / auth headers were sent.
    const sentHeaders = (calls[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(Object.keys(sentHeaders)).toEqual([]);

    const out = logLines.join("\n");
    expect(out).toContain("Network:  eip155:8453");
    expect(out).toContain(`Asset:    ${USDC_BASE} (USD Coin)`);
    expect(out).toContain("30000 base units = 3¢ ($0.03)");
    expect(out).toContain("Pay to:   0x1111111111111111111111111111111111111111");
    expect(out).toContain("Server-declared facilitator: https://facilitator.arispay.app");
    expect(out).toContain("No payment was sent.");
    // Never a float dollars value.
    expect(out).not.toMatch(/0\.030{2,}/);
  });

  it("accepts the v1 maxAmountRequired field", async () => {
    stubFetch(402, {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "base",
          maxAmountRequired: "150000", // 15 cents
          asset: USDC_BASE,
          payTo: "0x2222222222222222222222222222222222222222",
        },
      ],
    });
    const { cmdInspect } = await import("./inspect.js");
    await cmdInspect(["https://legacy.example/paid"]);
    expect(logLines.join("\n")).toContain("150000 base units = 15¢ ($0.15)");
  });

  it("exits 1 with the status when the URL is not x402-gated", async () => {
    stubFetch(200, { hello: "world" });
    const exitMock = mockExit();
    const { cmdInspect } = await import("./inspect.js");
    await expect(cmdInspect(["https://free.example/"])).rejects.toThrow("process.exit called");
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(errLines.join("")).toMatch(/does not appear to be x402-gated \(got HTTP 200/);
  });

  it("fails gracefully on a 402 with malformed JSON", async () => {
    stubFetch(402, undefined, true);
    const exitMock = mockExit();
    const { cmdInspect } = await import("./inspect.js");
    await expect(cmdInspect(["https://broken.example/paid"])).rejects.toThrow(
      "process.exit called",
    );
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(errLines.join("")).toMatch(/parseable x402 challenge/);
  });

  it("leaves cents undefined when base units don't divide into whole cents", async () => {
    stubFetch(402, {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "12345", // not divisible by 10^4 — no clean cents value
          asset: USDC_BASE,
          payTo: "0x3333333333333333333333333333333333333333",
        },
      ],
    });
    const { cmdInspect } = await import("./inspect.js");
    await cmdInspect(["https://odd.example/paid"]);
    const out = logLines.join("\n");
    expect(out).toContain("12345 base units");
    // No rounded/float cent display fabricated.
    expect(out).not.toContain("1.2345");
    expect(out).not.toMatch(/12345 base units = /);
  });

  it("--json emits the parsed result with integer cents", async () => {
    stubFetch(402, {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "30000",
          asset: USDC_BASE,
          payTo: "0x1111111111111111111111111111111111111111",
        },
      ],
    });
    const { cmdInspect } = await import("./inspect.js");
    await cmdInspect(["https://api.acme.example/premium", "--json"]);
    const parsed = JSON.parse(logLines.join("\n"));
    expect(parsed.gated).toBe(true);
    expect(parsed.accepts[0].amountBaseUnits).toBe("30000");
    expect(parsed.accepts[0].amountCents).toBe(3);
    expect(Number.isInteger(parsed.accepts[0].amountCents)).toBe(true);
  });
});

describe("inspectChallenge — v2 header-carried challenges", () => {
  it("parses the base64 payment-required header when the body is {} (upstream @x402 style)", async () => {
    const { inspectChallenge } = await import("../inspect.js");
    const challenge = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "10000",
          asset: USDC_BASE,
          payTo: "0xSeller00000000000000000000000000000000ab",
        },
      ],
    };
    const header = Buffer.from(JSON.stringify(challenge)).toString("base64");
    const fetchImpl = vi.fn(async () => ({
      status: 402,
      async json() {
        return {};
      },
      headers: { get: (n: string) => (n.toLowerCase() === "payment-required" ? header : null) },
    })) as unknown as typeof fetch;
    const result = await inspectChallenge("https://api.example.com/data", { fetch: fetchImpl });
    expect(result.gated).toBe(true);
    if (!result.gated) return;
    expect(result.accepts[0].amountCents).toBe(1);
    expect(result.accepts[0].payTo).toBe("0xSeller00000000000000000000000000000000ab");
  });
});
