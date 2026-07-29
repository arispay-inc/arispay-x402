/**
 * Tests for `payagent discover "<query>"`.
 *
 * Locks in:
 *   - happy-path formatting: integer cents in data, `$X.YY`/`€X.YY` only at
 *     the display edge (never a float dollars value)
 *   - --budget rejects floats/dollar strings (budget is integer cents)
 *   - empty results → friendly message, exit 0
 *   - --json prints the raw candidates array
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverResult } from "../discover.js";

const discoverMock = vi.fn();
vi.mock("../discover.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../discover.js")>();
  return { ...actual, discover: (...args: unknown[]) => discoverMock(...args) };
});

let logLines: string[];
let errLines: string[];

beforeEach(() => {
  logLines = [];
  errLines = [];
  discoverMock.mockReset();
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
});

function mockExit() {
  return vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });
}

const sampleResult: DiscoverResult = {
  candidates: [
    {
      slug: "acme/flights",
      name: "Acme Flight Search",
      endpoint: { transport: "http-x402", url: "https://api.acme.example/flights" },
      pricing: { model: "x402", amount: 3, currency: "USD", per: "call" },
      healthy: true,
      verified: true,
      source: "arispay",
      score: 902,
    },
    {
      slug: "euro/weather",
      name: "Euro Weather",
      endpoint: { transport: "http-x402", url: "https://api.euro.example/weather" },
      pricing: { model: "x402", amount: 150, currency: "EUR", per: "call" },
      healthy: false,
      verified: false,
      source: "bazaar",
      score: 400,
    },
  ],
  query: { intent: "flights" },
};

describe("cmdDiscover", () => {
  it("formats prices from integer cents and prints the pay hint", async () => {
    discoverMock.mockResolvedValue(sampleResult);
    const { cmdDiscover } = await import("./discover.js");
    await cmdDiscover(["flight", "search"]);

    expect(discoverMock).toHaveBeenCalledWith({ intent: "flight search" });
    const out = logLines.join("\n");
    expect(out).toContain("1. Acme Flight Search");
    expect(out).toContain("https://api.acme.example/flights");
    // 3 cents → $0.03, and the canonical integer cents shown alongside.
    expect(out).toContain("$0.03");
    expect(out).toContain("3¢");
    // 150 EUR cents → €1.50
    expect(out).toContain("€1.50");
    expect(out).toContain("healthy · verified · source: arispay");
    expect(out).toContain("unhealthy · unverified · source: bazaar");
    expect(out).toContain("Pay one with: npx payagent pay <url>");
    // Never a float dollars value anywhere in the output.
    expect(out).not.toMatch(/0\.030{2,}/);
  });

  it("passes --budget through as integer cents", async () => {
    discoverMock.mockResolvedValue(sampleResult);
    const { cmdDiscover } = await import("./discover.js");
    await cmdDiscover(["flights", "--budget", "500", "--limit", "3"]);
    expect(discoverMock).toHaveBeenCalledWith({ intent: "flights", budgetCentsMax: 500, limit: 3 });
  });

  it("rejects a float --budget with a cents message", async () => {
    const exitMock = mockExit();
    const { cmdDiscover } = await import("./discover.js");
    await expect(cmdDiscover(["flights", "--budget", "5.00"])).rejects.toThrow(
      "process.exit called",
    );
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(errLines.join("")).toMatch(/integer number of cents/);
    expect(discoverMock).not.toHaveBeenCalled();
  });

  it("prints a friendly message on empty results and exits 0", async () => {
    discoverMock.mockResolvedValue({ candidates: [], query: { intent: "nothing" } });
    const exitMock = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const { cmdDiscover } = await import("./discover.js");
    await cmdDiscover(["nothing"]);
    expect(exitMock).not.toHaveBeenCalled();
    const out = logLines.join("\n");
    expect(out).toContain('No paid APIs matched "nothing"');
    expect(out).toContain("broader query");
  });

  it("--json prints the raw candidates array", async () => {
    discoverMock.mockResolvedValue(sampleResult);
    const { cmdDiscover } = await import("./discover.js");
    await cmdDiscover(["flights", "--json"]);
    const parsed = JSON.parse(logLines.join("\n"));
    expect(parsed).toEqual(sampleResult.candidates);
    // Cents stay integers in JSON output.
    expect(parsed[0].pricing.amount).toBe(3);
  });

  it("requires a query", async () => {
    const exitMock = mockExit();
    const { cmdDiscover } = await import("./discover.js");
    await expect(cmdDiscover([])).rejects.toThrow("process.exit called");
    expect(exitMock).toHaveBeenCalledWith(1);
  });
});
