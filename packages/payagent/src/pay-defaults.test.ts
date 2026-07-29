/**
 * Tests for the pure `derivePayDefaults()` helper used by `payagent pay`.
 *
 * The helper is the decision point for how a first-time user's agent gets
 * provisioned when they run `npx payagent pay <url>` with nothing configured.
 * If these defaults drift (wrong network, wrong limits, wrong domain scope),
 * every self-bootstrapped agent in the wild will be wrong — so lock them down.
 */
import { describe, expect, it } from "vitest";
import { derivePayDefaults, parseAmountCents } from "./pay-defaults.js";

describe("derivePayDefaults", () => {
  it("picks conservative defaults when only a URL is given", () => {
    const result = derivePayDefaults("https://stabletravel.dev/api/search", {});
    expect(result).toEqual({
      ok: true,
      name: "default",
      perTx: 500,
      daily: 2000,
      monthly: 10000,
      network: "base",
      allowedDomains: ["stabletravel.dev"],
    });
  });

  it("seeds allowedDomains from the URL's hostname", () => {
    const result = derivePayDefaults("https://api.coingecko.com/api/v3/paid", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.allowedDomains).toEqual(["api.coingecko.com"]);
  });

  it("prefers the first stored agent name over `default`", () => {
    const result = derivePayDefaults("https://api.example.com/premium", {}, "hermes");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe("hermes");
  });

  it("uses explicit --agent name over first stored agent", () => {
    const result = derivePayDefaults(
      "https://api.example.com/premium",
      { agent: "booker" },
      "hermes",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe("booker");
  });

  it("honours --per-tx / --daily / --monthly overrides in dollars", () => {
    const result = derivePayDefaults("https://api.example.com/", {
      "per-tx": "0.50",
      daily: "10",
      monthly: "100",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.perTx).toBe(50);
    expect(result.daily).toBe(1000);
    expect(result.monthly).toBe(10000);
  });

  it("honours --domains override as a CSV list", () => {
    const result = derivePayDefaults("https://api.example.com/", {
      domains: "api.example.com, api.example.net, api.example.io",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.allowedDomains).toEqual(["api.example.com", "api.example.net", "api.example.io"]);
  });

  it("honours --network override", () => {
    const result = derivePayDefaults("https://api.example.com/", { network: "polygon" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.network).toBe("polygon");
  });

  it("returns a structured error for invalid URLs instead of throwing", () => {
    const result = derivePayDefaults("not-a-url", {});
    expect(result).toEqual({
      ok: false,
      error: "payagent pay: `not-a-url` is not a valid URL.",
    });
  });

  it("returns a structured error for invalid amounts instead of throwing", () => {
    const result = derivePayDefaults("https://api.example.com/", { "per-tx": "abc" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("--per-tx");
  });
});

describe("parseAmountCents", () => {
  it("parses integer dollars", () => {
    expect(parseAmountCents("5", "--per-tx")).toBe(500);
  });

  it("parses two-decimal dollars", () => {
    expect(parseAmountCents("5.00", "--per-tx")).toBe(500);
    expect(parseAmountCents("0.25", "--per-tx")).toBe(25);
  });

  it("strips currency symbols", () => {
    expect(parseAmountCents("$5.00", "--per-tx")).toBe(500);
    expect(parseAmountCents("£1.50", "--per-tx")).toBe(150);
    expect(parseAmountCents("€2", "--per-tx")).toBe(200);
  });

  it("rejects missing values", () => {
    expect(() => parseAmountCents(undefined, "--per-tx")).toThrow("--per-tx is required");
    expect(() => parseAmountCents(true, "--per-tx")).toThrow("--per-tx is required");
  });

  it("rejects non-numeric strings", () => {
    expect(() => parseAmountCents("abc", "--per-tx")).toThrow();
    expect(() => parseAmountCents("1.234", "--per-tx")).toThrow();
  });
});
