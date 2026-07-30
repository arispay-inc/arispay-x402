import { describe, expect, it, vi } from "vitest";
import { doctorUrl, runDoctor, validateDoctorChallenge } from "./doctor.js";

const URL = "https://seller.example.com/api/paid";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CHALLENGE = {
  x402Version: 2,
  resource: {
    url: URL,
    description: "Paid data",
    mimeType: "application/json",
  },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      payTo: "0x58eBc6Adb191eC456fAe9575c99Bc676A5bA0D38",
      asset: USDC,
    },
  ],
  extensions: {
    bazaar: {
      info: { input: { type: "http", method: "GET" } },
      schema: { type: "object" },
    },
  },
};

describe("validateDoctorChallenge", () => {
  it("accepts a complete Base mainnet v2 challenge", () => {
    const report = validateDoctorChallenge(URL, 402, CHALLENGE);
    expect(report.ok).toBe(true);
    expect(report.checks).toHaveLength(6);
  });

  it("reports each readiness failure independently", () => {
    const report = validateDoctorChallenge("http://seller.example.com/paid", 200, {
      x402Version: 1,
      resource: { url: "http://seller.example.com/paid" },
      accepts: [
        {
          network: "eip155:84532",
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        },
      ],
      extensions: {},
    });
    expect(report.ok).toBe(false);
    expect(report.checks.filter((item) => !item.ok).map((item) => item.id)).toEqual([
      "unpaid-402",
      "resource-url",
      "x402-version",
      "base-network",
      "asset",
      "bazaar",
    ]);
  });
});

describe("doctorUrl", () => {
  it("sends exactly one unpaid, unauthenticated GET and disables redirects", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(CHALLENGE), {
        status: 402,
        headers: { "content-type": "application/json" },
      }),
    );
    const report = await doctorUrl(URL, { fetchImpl });
    expect(report.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const firstCall = fetchImpl.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [, init] = firstCall ?? [];
    expect(init).toMatchObject({
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    expect(Object.keys(init.headers)).toEqual(["accept"]);
  });

  it("parses an upstream v2 payment-required header", async () => {
    const encoded = Buffer.from(JSON.stringify(CHALLENGE)).toString("base64");
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 402,
        headers: {
          "content-type": "application/json",
          "payment-required": encoded,
        },
      }),
    );
    expect((await doctorUrl(URL, { fetchImpl })).ok).toBe(true);
  });

  it("rejects non-HTTPS targets without making a request", async () => {
    const fetchImpl = vi.fn();
    const report = await doctorUrl("http://seller.example.com/paid", { fetchImpl });
    expect(report.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("runDoctor", () => {
  it("supports check-style JSON output and returns readiness as its exit code", async () => {
    const out: string[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(CHALLENGE), { status: 402 }));
    const code = await runDoctor(
      [URL, "--json"],
      { stdout: (value) => out.push(value), stderr: (value) => out.push(value) },
      { fetchImpl },
    );
    expect(code).toBe(0);
    expect(JSON.parse(out.join("")).ok).toBe(true);
  });
});
