import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
/**
 * Tests for `payagent connect <CODE>`.
 *
 * Verifies: the connect command exchanges a pairing code, receives wallet
 * config, and writes it to the local config store — using the *existing*
 * wallet, not creating a new one. Uses a temp dir so tests don't touch
 * the real `~/.payagent`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIG_ENV = { ...process.env };
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "payagent-connect-test-"));
  process.env.PAYAGENT_CONFIG_DIR = tmp;
  process.env.ARISPAY_URL = "http://localhost:3001";
  delete process.env.ARISPAY_API_KEY;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.env = { ...ORIG_ENV };
  vi.restoreAllMocks();
});

const MOCK_EXCHANGE_RESPONSE = {
  agentId: "agt_test123",
  agentName: "my-wallet",
  apiKey: "ap_live_deadbeef1234567890abcdef1234567890abcdef12345678",
  walletAddress: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
  network: "base",
  arispayUrl: "https://api.arispay.app",
  limits: { perTx: 50, daily: 1000, monthly: 10000 },
  allowedDomains: ["api.example.com"],
};

describe("cmdConnect", () => {
  it("exchanges code and writes config for the existing wallet", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_EXCHANGE_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    // Suppress console output during test
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { cmdConnect } = await import("./connect.js");
    await cmdConnect(["ABCD-EFGH"]);

    // Verify fetch was called with normalized code
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3001/v1/auth/pair/wallet-exchange");
    expect(JSON.parse(opts.body)).toEqual({ code: "ABCDEFGH" });

    // Verify config was written
    const configPath = join(tmp, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));

    expect(config.agents).toBeDefined();
    expect(config.agents["my-wallet"]).toMatchObject({
      agentId: "agt_test123",
      name: "my-wallet",
      walletAddress: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
      apiKey: MOCK_EXCHANGE_RESPONSE.apiKey,
      network: "base",
      limits: { perTx: 50, daily: 1000, monthly: 10000 },
      allowedDomains: ["api.example.com"],
    });
  });

  it("normalizes code input (lowercase, with dashes)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_EXCHANGE_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { cmdConnect } = await import("./connect.js");
    await cmdConnect(["abcd-efgh"]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.code).toBe("ABCDEFGH");
  });

  it("exits with error on expired code", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
      clone: () => ({
        json: async () => ({
          error: { code: "PairingCodeExpiredError", message: "pairing code expired" },
        }),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const exitMock = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    const { cmdConnect } = await import("./connect.js");
    await expect(cmdConnect(["ABCD-EFGH"])).rejects.toThrow("process.exit called");
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it("exits with error on consumed code", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
      clone: () => ({
        json: async () => ({
          error: { code: "PairingCodeAlreadyConsumedError", message: "already consumed" },
        }),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const exitMock = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    const { cmdConnect } = await import("./connect.js");
    await expect(cmdConnect(["ABCD-EFGH"])).rejects.toThrow("process.exit called");
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it("does not create a new wallet (verifies returned config is stored as-is)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_EXCHANGE_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { cmdConnect } = await import("./connect.js");
    await cmdConnect(["TEST-CODE"]);

    const configPath = join(tmp, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));

    // The agentId is from the server, not locally generated
    expect(config.agents["my-wallet"].agentId).toBe("agt_test123");
    // No other agents should be created
    expect(Object.keys(config.agents)).toHaveLength(1);
  });
});
