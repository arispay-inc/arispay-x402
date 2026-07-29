/* eslint-disable no-console */
/**
 * Shared utilities for the `agentmarketplace` CLI commands.
 *
 * Lifted out of `cli.ts` so each command file under `commands/` pulls
 * only what it needs. Kept under `src/lib/` to mirror the layout the
 * rest of the package uses for plumbing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { type AgentListing, HttpMarketplaceClient, WEB_BASE_URL } from "../index.js";

export const DEFAULT_BASE_URL = "https://api.arispay.app/v1/marketplace";
export const CONFIG_DIR = join(homedir(), ".agentmarketplace");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const SKILL_DEST_DIR = join(homedir(), ".claude", "skills", "agentmarketplace");
export const WEB_URL = process.env.AGENTMARKETPLACE_WEB_URL ?? WEB_BASE_URL;

export interface StoredConfig {
  /** Last API key the user explicitly logged in with. Primary credential. */
  apiKey?: string;
  /** Developer (ap_live_/ap_test_) key returned by `merchant signup`. Kept
   *  separately so `publish` still works after the user runs
   *  `agent create` + `login <agentKey>` to switch to an agent-scoped key. */
  developerKey?: string;
  /** Merchant id returned by `merchant signup` — surfaces the /m/<id> URL. */
  merchantId?: string;
  baseUrl?: string;
}

// ── Config helpers ────────────────────────────────────────────────────────

export function loadConfig(): StoredConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as StoredConfig;
  } catch {
    return {};
  }
}

export function saveConfig(cfg: StoredConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function getClient(requireAuth = false): HttpMarketplaceClient {
  const cfg = loadConfig();
  const apiKey = process.env.ARISPAY_API_KEY ?? cfg.apiKey;
  const baseUrl = process.env.AGENTMARKETPLACE_URL ?? cfg.baseUrl ?? DEFAULT_BASE_URL;
  if (requireAuth && !apiKey) {
    console.error("Not logged in. Run: agentmarketplace login <api-key>");
    process.exit(1);
  }
  return new HttpMarketplaceClient({ baseUrl, apiKey });
}

// ── Printing ──────────────────────────────────────────────────────────────

export function listingWebUrl(slug: string): string {
  return `${WEB_URL}/${slug}`;
}

export function formatListing(a: AgentListing): string {
  const healthBadge = a.healthy === false ? " ⚠ unhealthy" : a.healthy === true ? "" : "";
  const lines = [
    `  ${a.name}${a.verified ? " ✓" : ""}${a.claimed === false ? " (unclaimed)" : ""}${healthBadge}`,
    `    slug:       ${a.slug}`,
    `    transport:  ${a.endpoint.transport}`,
  ];
  if (a.endpoint.url) lines.push(`    endpoint:   ${a.endpoint.url}`);
  if (a.endpoint.command) {
    lines.push(`    command:    ${a.endpoint.command} ${(a.endpoint.args ?? []).join(" ")}`);
  }
  if (a.pricing) {
    const amt =
      a.pricing.amount != null
        ? `${(a.pricing.amount / 100).toFixed(2)} ${a.pricing.currency ?? "USD"}${a.pricing.per ? ` / ${a.pricing.per}` : ""}`
        : "";
    lines.push(`    pricing:    ${a.pricing.model}${amt ? ` (${amt})` : ""}`);
  }
  if (a.description) lines.push(`    ${a.description}`);
  if (a.tags?.length) lines.push(`    tags:       ${a.tags.join(", ")}`);
  if (a.lastCheckedAt) {
    const age = Math.round((Date.now() - new Date(a.lastCheckedAt).getTime()) / (60 * 60 * 1000));
    lines.push(`    health:     ${a.healthy === false ? "unhealthy" : "ok"} (checked ${age}h ago)`);
  }
  lines.push(`    view:       ${listingWebUrl(a.slug)}`);
  return lines.join("\n");
}

export function isExperimental(): boolean {
  return process.env.AGENTMARKETPLACE_EXPERIMENTAL === "1";
}

// ── Argument parsing ──────────────────────────────────────────────────────

export interface ParsedFlags {
  positional: string[];
  flags: Record<string, string>;
}

export function parseFlags(argv: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq > -1) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      else flags[arg.slice(2)] = "true";
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

// ── Prompts ──────────────────────────────────────────────────────────────

export async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  const ans = (await prompt(question + suffix)).toLowerCase();
  if (!ans) return defaultYes;
  return ans.startsWith("y");
}
