/**
 * payagent — local config store.
 *
 * Persists the developer's ArisPay API key and locally-created agents to
 * `~/.payagent/config.json` (directory mode 0700, file mode 0600). The CLI
 * and the MCP server both read/write through here so `npx payagent init`
 * and Hermes's `create_agent` MCP tool share the same authentication + agent
 * registry.
 *
 * Lookup precedence for the developer API key + base URL:
 *   1. Explicit argument passed to a function
 *   2. `ARISPAY_API_KEY` / `ARISPAY_URL` environment variables
 *   3. Stored values in `config.json`
 *   4. Built-in defaults
 *
 * The store is intentionally small and dependency-free so it can be
 * bundled by tsup without pulling in filesystem abstractions. It does
 * *not* depend on `@arispay/shared` (the published SDK must remain
 * standalone per `packages/payagent/CLAUDE.md`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_ARISPAY_URL = "https://api.arispay.app";

/** One locally-cached agent, keyed by its human name in `config.agents`. */
export interface StoredAgent {
  agentId: string;
  name: string;
  walletAddress: string;
  /** Agent-scoped API key returned once by `POST /v1/agents/x402`. */
  apiKey: string;
  limits: {
    perTx: number;
    daily: number;
    monthly: number;
  };
  allowedDomains?: string[];
  network?: "base" | "base-sepolia" | "ethereum" | "polygon";
  createdAt: string;
}

export interface StoredConfig {
  /** Developer API key (ap_live_ / ap_test_). Returned by the device-code flow. */
  apiKey?: string;
  /** Optional override of `https://api.arispay.app`. */
  arispayUrl?: string;
  /** Locally-cached agent records, keyed by `name`. */
  agents?: Record<string, StoredAgent>;
  /** Schema version for forward migration. */
  version?: number;
}

const CURRENT_VERSION = 1;

function configDir(): string {
  return process.env.PAYAGENT_CONFIG_DIR ?? join(homedir(), ".payagent");
}

function configPath(): string {
  return join(configDir(), "config.json");
}

/** Read the stored config. Returns an empty object if the file is missing or corrupt. */
export function loadConfig(): StoredConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as StoredConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Corrupted file shouldn't crash the CLI. Caller can re-save to repair.
    return {};
  }
}

/** Persist the config. Creates `~/.payagent/` with 0700 if missing. */
export function saveConfig(cfg: StoredConfig): void {
  const dir = configDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const next: StoredConfig = { ...cfg, version: CURRENT_VERSION };
  writeFileSync(configPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
}

/** Developer API key, respecting env override. Undefined if not set anywhere. */
export function getApiKey(explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (process.env.ARISPAY_API_KEY) return process.env.ARISPAY_API_KEY;
  const cfg = loadConfig();
  return cfg.apiKey;
}

/** ArisPay base URL, respecting env override. Falls back to the public default. */
export function getArispayUrl(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.ARISPAY_URL) return process.env.ARISPAY_URL;
  const cfg = loadConfig();
  return cfg.arispayUrl ?? DEFAULT_ARISPAY_URL;
}

/** Save / update the developer API key in the store. */
export function setApiKey(apiKey: string): void {
  const cfg = loadConfig();
  saveConfig({ ...cfg, apiKey });
}

/** Remove the developer API key from the store. Agents remain. */
export function clearApiKey(): void {
  const cfg = loadConfig();
  const { apiKey: _discarded, ...rest } = cfg;
  void _discarded;
  saveConfig(rest);
}

/** Persist an agent record under its `name`. */
export function saveAgent(agent: StoredAgent): void {
  const cfg = loadConfig();
  const agents = { ...(cfg.agents ?? {}), [agent.name]: agent };
  saveConfig({ ...cfg, agents });
}

/**
 * Batch-rehydrate the local cache from the server's authoritative wallet
 * list. Used by `syncAgents` (and the bootstrap rehydration path) so a user
 * on a new machine — or one whose config got wiped — gets back every wallet
 * they own under their developer key in one shot.
 *
 * Merge semantics: server entries replace local entries on a name match.
 * Local-only entries (e.g. an agent in flight to a server that hasn't
 * persisted yet) are preserved. Per-agent `apiKey` values that the server
 * doesn't return (it can't — only the SHA-256 hash is stored) are kept
 * from whatever local record already existed, so a rehydration doesn't
 * blow away a usable agent key. Agents the server returns that aren't in
 * the local cache get added with an empty `apiKey` — callers must mint a
 * fresh agent key via `create_agent` or re-bootstrap to use them.
 */
export function upsertManyFromServer(agents: StoredAgent[]): void {
  const cfg = loadConfig();
  const next = { ...(cfg.agents ?? {}) };
  for (const fresh of agents) {
    const existing = next[fresh.name];
    next[fresh.name] = {
      ...fresh,
      // Preserve a usable plaintext agent key if we already had one
      // (server side has only the hash, so it can't refresh this).
      apiKey: fresh.apiKey || existing?.apiKey || "",
    };
  }
  saveConfig({ ...cfg, agents: next });
}

/** Rename a locally-cached agent. Returns true if the rename happened. */
export function renameStoredAgent(oldName: string, newName: string): boolean {
  const cfg = loadConfig();
  const agents = cfg.agents ?? {};
  const existing = agents[oldName];
  if (!existing) return false;
  if (oldName === newName) return false;
  const { [oldName]: _drop, ...rest } = agents;
  void _drop;
  const renamed: StoredAgent = { ...existing, name: newName };
  saveConfig({ ...cfg, agents: { ...rest, [newName]: renamed } });
  return true;
}

/** Look up a stored agent by name. Returns undefined if unknown. */
export function getAgent(name: string): StoredAgent | undefined {
  const cfg = loadConfig();
  return cfg.agents?.[name];
}

/** Return every stored agent, sorted by createdAt ascending. */
export function listAgents(): StoredAgent[] {
  const cfg = loadConfig();
  return Object.values(cfg.agents ?? {}).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Remove a stored agent by name. Returns true if it existed. */
export function removeAgent(name: string): boolean {
  const cfg = loadConfig();
  if (!cfg.agents?.[name]) return false;
  const { [name]: _removed, ...rest } = cfg.agents;
  void _removed;
  saveConfig({ ...cfg, agents: rest });
  return true;
}

/** Absolute path to the config file. Exposed so tests and the CLI can report it. */
export function getConfigPath(): string {
  return configPath();
}
