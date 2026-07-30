import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..", "templates", "railway-x402-seller");
const read = (name: string) => readFileSync(join(ROOT, name), "utf8");

describe("Railway x402 seller template", () => {
  it("is a valid Base-mainnet seller with HTTPS proxy handling and Bazaar metadata", () => {
    const source = read("server.js");
    execFileSync(process.execPath, ["--check", join(ROOT, "server.js")]);
    expect(source).toContain('"eip155:8453"');
    expect(source).toContain('"https://facilitator.arispay.app"');
    expect(source).toContain('app.set("trust proxy", 1)');
    expect(source).toContain("declareDiscoveryExtension");
    expect(source).toContain('"GET /api/paid"');
  });

  it("declares Railway health and restart behavior", () => {
    const config = read("railway.toml");
    expect(config).toContain('builder = "RAILPACK"');
    expect(config).toContain('healthcheckPath = "/health"');
    expect(config).toContain('restartPolicyType = "ON_FAILURE"');
  });

  it("contains no account requirement or secret-shaped material", () => {
    const content = ["package.json", "server.js", "railway.toml", "README.md"].map(read).join("\n");
    expect(content).not.toMatch(/\b(ap|mp)_(live|test)_[A-Za-z0-9]{8,}/);
    expect(content).not.toMatch(/0x[0-9a-fA-F]{64}\b/);
    expect(content).not.toMatch(/PRIVATE KEY/);
    expect(content).toContain("There is no ArisPay account");
  });
});
