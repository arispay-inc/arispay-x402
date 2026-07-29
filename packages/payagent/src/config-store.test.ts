import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
/**
 * Tests for `config-store.ts`.
 *
 * These exercise the actual filesystem — we redirect the config dir to an
 * OS temp dir per test via the `PAYAGENT_CONFIG_DIR` env override the
 * store respects. Each test restores the original env afterward so the
 * runner doesn't carry state between cases.
 *
 * Enforces: invariants in packages/payagent/CLAUDE.md — "Config store lives
 * at ~/.payagent/config.json (dir 0700, file 0600). Never log the
 * developer key or any agent's apiKey." If these assertions start
 * failing, the source is almost certainly wrong. Do not loosen — fix
 * config-store.ts instead.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_ARISPAY_URL,
  type StoredAgent,
  clearApiKey,
  getAgent,
  getApiKey,
  getArispayUrl,
  getConfigPath,
  listAgents,
  loadConfig,
  removeAgent,
  renameStoredAgent,
  saveAgent,
  saveConfig,
  setApiKey,
  upsertManyFromServer,
} from "./config-store.js";

const ORIG_ENV = { ...process.env };
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "payagent-test-"));
  process.env.PAYAGENT_CONFIG_DIR = tmp;
  delete process.env.ARISPAY_API_KEY;
  delete process.env.ARISPAY_URL;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.env = { ...ORIG_ENV };
});

function fixtureAgent(name = "smoke"): StoredAgent {
  return {
    agentId: `agt_${name}`,
    name,
    walletAddress: "0x1111111111111111111111111111111111111111",
    apiKey: `ap_test_${name}`,
    limits: { perTx: 100, daily: 1000, monthly: 10000 },
    allowedDomains: ["api.example.com"],
    network: "base",
    createdAt: new Date("2026-04-21T00:00:00Z").toISOString(),
  };
}

describe("config-store", () => {
  it("returns an empty config when the file does not exist", () => {
    expect(loadConfig()).toEqual({});
  });

  it("writes the file with mode 0600 and honours PAYAGENT_CONFIG_DIR", () => {
    setApiKey("ap_live_abc");
    const path = getConfigPath();
    expect(path.startsWith(tmp)).toBe(true);
    expect(existsSync(path)).toBe(true);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("env ARISPAY_API_KEY overrides the stored key", () => {
    setApiKey("ap_from_config");
    process.env.ARISPAY_API_KEY = "ap_from_env";
    expect(getApiKey()).toBe("ap_from_env");
  });

  it("falls back to the stored key when env is unset", () => {
    setApiKey("ap_from_config");
    expect(getApiKey()).toBe("ap_from_config");
  });

  it("explicit argument beats both env and config", () => {
    setApiKey("ap_from_config");
    process.env.ARISPAY_API_KEY = "ap_from_env";
    expect(getApiKey("ap_explicit")).toBe("ap_explicit");
  });

  it("getArispayUrl defaults to the public production URL", () => {
    expect(getArispayUrl()).toBe(DEFAULT_ARISPAY_URL);
  });

  it("getArispayUrl respects env override", () => {
    process.env.ARISPAY_URL = "http://localhost:3001";
    expect(getArispayUrl()).toBe("http://localhost:3001");
  });

  it("clearApiKey removes the key but preserves agents", () => {
    setApiKey("ap_live");
    const agent = fixtureAgent();
    saveAgent(agent);
    clearApiKey();
    expect(getApiKey()).toBeUndefined();
    expect(getAgent("smoke")).toEqual(agent);
  });

  it("saveAgent + getAgent + listAgents + removeAgent round-trip", () => {
    const a = fixtureAgent("alpha");
    const b = fixtureAgent("beta");
    saveAgent(a);
    saveAgent(b);
    expect(getAgent("alpha")).toEqual(a);
    expect(getAgent("beta")).toEqual(b);
    const all = listAgents();
    // listAgents sorts by createdAt; both fixtures share timestamp so order-insensitive check.
    expect(all.map((x) => x.name).sort()).toEqual(["alpha", "beta"]);

    expect(removeAgent("alpha")).toBe(true);
    expect(removeAgent("alpha")).toBe(false); // idempotent
    expect(listAgents().map((x) => x.name)).toEqual(["beta"]);
  });

  it("corrupt JSON on disk returns empty config (no crash)", () => {
    setApiKey("ap_live");
    // Corrupt the file
    const path = getConfigPath();
    const original = readFileSync(path, "utf-8");
    expect(original).toContain("ap_live");
    // Overwrite with garbage
    const { writeFileSync } = require("node:fs");
    writeFileSync(path, "{{{ not json }}}", "utf-8");
    expect(loadConfig()).toEqual({});
  });

  it("saveConfig always stamps the schema version", () => {
    saveConfig({ apiKey: "ap_live" });
    const loaded = loadConfig();
    expect(loaded.version).toBe(1);
  });
});

describe("upsertManyFromServer", () => {
  it("adds agents that did not exist locally", () => {
    upsertManyFromServer([fixtureAgent("travel"), fixtureAgent("shopping")]);
    const names = listAgents()
      .map((a) => a.name)
      .sort();
    expect(names).toEqual(["shopping", "travel"]);
  });

  it("preserves the locally-stored apiKey when the server returns an empty one", () => {
    // The server can't return plaintext agent keys — it only stores the
    // SHA-256 hash. Rehydration must NOT blow away the local plaintext.
    saveAgent(fixtureAgent("travel"));
    upsertManyFromServer([{ ...fixtureAgent("travel"), apiKey: "" }]);
    expect(getAgent("travel")?.apiKey).toBe("ap_test_travel");
  });

  it("overwrites server-known fields (wallet, limits) on a name match", () => {
    saveAgent({
      ...fixtureAgent("travel"),
      walletAddress: "0xOLD",
      limits: { perTx: 10, daily: 20, monthly: 30 },
    });
    upsertManyFromServer([
      {
        ...fixtureAgent("travel"),
        apiKey: "",
        walletAddress: "0xNEW",
        limits: { perTx: 100, daily: 500, monthly: 2000 },
      },
    ]);
    const out = getAgent("travel");
    expect(out?.walletAddress).toBe("0xNEW");
    expect(out?.limits).toEqual({ perTx: 100, daily: 500, monthly: 2000 });
    expect(out?.apiKey).toBe("ap_test_travel");
  });

  it("leaves local-only agents untouched", () => {
    saveAgent(fixtureAgent("local-only"));
    upsertManyFromServer([fixtureAgent("from-server")]);
    const names = listAgents()
      .map((a) => a.name)
      .sort();
    expect(names).toEqual(["from-server", "local-only"]);
  });

  it("uses the server apiKey when there is no local entry", () => {
    upsertManyFromServer([{ ...fixtureAgent("fresh"), apiKey: "ap_live_fresh" }]);
    expect(getAgent("fresh")?.apiKey).toBe("ap_live_fresh");
  });
});

describe("renameStoredAgent", () => {
  it("renames an existing local agent", () => {
    saveAgent(fixtureAgent("default"));
    expect(renameStoredAgent("default", "Travel")).toBe(true);
    expect(getAgent("default")).toBeUndefined();
    expect(getAgent("Travel")?.name).toBe("Travel");
    expect(getAgent("Travel")?.agentId).toBe("agt_default");
  });

  it("returns false when the old name does not exist", () => {
    expect(renameStoredAgent("missing", "NewName")).toBe(false);
  });

  it("is a no-op when old and new names match", () => {
    saveAgent(fixtureAgent("travel"));
    expect(renameStoredAgent("travel", "travel")).toBe(false);
    expect(getAgent("travel")).toBeTruthy();
  });
});
