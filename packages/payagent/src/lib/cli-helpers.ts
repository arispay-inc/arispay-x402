/* eslint-disable no-console */
/**
 * Shared utilities for the `payagent` CLI commands.
 *
 * Lifted out of `cli.ts` so each command file can pull only what it needs
 * without re-importing the whole 1400-line entrypoint. Kept under
 * `src/lib/` because the CLI has the same separation everywhere — `lib/`
 * for plumbing, `commands/` for each top-level command.
 */
import { formatUSDC } from "../balance.js";
import { BootstrapError } from "../bootstrap.js";
import { getApiKey, getArispayUrl } from "../config-store.js";
import { DelegationClient } from "../delegation.js";
import { DeviceCodeError } from "../device-code.js";
import { MissingArisPayApiKeyError } from "../launch.js";

// Sandbox-style default spend caps used by `agent create` and `quickstart`
// when the caller doesn't supply them. Tight enough to bound any drive-by
// blast radius, generous enough that a first-run agent can do real work.
export const DEFAULT_PER_TX_CENTS = 50;
export const DEFAULT_DAILY_CENTS = 1000;
export const DEFAULT_MONTHLY_CENTS = 10000;

// Replaced at build time by tsup's `define` with the current package.json
// version. Dev-mode fallback: literal string so tests that import src/cli.ts
// directly (unbundled) don't crash on the unresolved identifier.
declare const __PAYAGENT_VERSION__: string;
export const VERSION: string =
  typeof __PAYAGENT_VERSION__ !== "undefined" ? __PAYAGENT_VERSION__ : "0.0.0-dev";

// ── Argument parsing ──────────────────────────────────────────────────────

export interface ParsedFlags {
  flags: Record<string, string | boolean>;
  positional: string[];
}

export function parseFlags(args: string[]): ParsedFlags {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq > -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags[arg.slice(2)] = next;
          i += 1;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[arg.slice(1)] = next;
        i += 1;
      } else {
        flags[arg.slice(1)] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

export function requireStringFlag(raw: string | boolean | undefined, label: string): string {
  if (typeof raw !== "string" || !raw) {
    console.error(`payagent: ${label} is required and must be a string value.`);
    process.exit(1);
  }
  return raw;
}

export function parseAmount(raw: string | boolean | undefined, label: string): number {
  if (raw === undefined || raw === true || raw === false) {
    console.error(`payagent: ${label} is required.`);
    process.exit(1);
  }
  const s = String(raw)
    .replace(/[$£€,]/g, "")
    .trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    console.error(`payagent: ${label} must be a positive decimal (e.g. 5.00). Got \`${raw}\`.`);
    process.exit(1);
  }
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(`${frac}00`.slice(0, 2));
  if (!Number.isFinite(cents) || cents < 0) {
    console.error(`payagent: ${label} must be a non-negative amount.`);
    process.exit(1);
  }
  return cents;
}

/**
 * Non-throwing variant of `parseAmount`. Returns the cent value when the
 * flag was supplied as a parseable string, or `undefined` when absent
 * (so the caller can fall back to defaults / interactive prompts).
 */
export function parseAmountFlag(raw: string | boolean | undefined): number | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const s = raw.replace(/[$£€,]/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(`${frac}00`.slice(0, 2));
  return Number.isFinite(cents) && cents >= 0 ? cents : undefined;
}

/** Parse a known-valid amount string (validated by `validateAmount`) into cents. */
export function parseAmountString(raw: string): number {
  const s = raw.replace(/[$£€,]/g, "").trim();
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(`${frac}00`.slice(0, 2));
}

export function parseHostedAmount(raw: string): number | undefined {
  const cleaned = raw.replace(/[$£€,]/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// ── Formatting ────────────────────────────────────────────────────────────

export function formatCents(cents: number): string {
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  return `$${whole}.${frac}`;
}

/**
 * Display-edge formatting only — data stays integer cents everywhere.
 * EUR renders with €; everything else (incl. unknown) renders with $.
 */
export function formatMoneyCents(cents: number, currency?: string): string {
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  const symbol = (currency ?? "USD").toUpperCase() === "EUR" ? "€" : "$";
  return `${symbol}${whole}.${frac}`;
}

export function formatUsdcString(raw: string): string {
  try {
    return formatUSDC(BigInt(raw || "0"));
  } catch {
    return raw;
  }
}

// ── QR rendering ──────────────────────────────────────────────────────────

export async function maybePrintQr(walletAddress: string): Promise<void> {
  await printQrTo(process.stdout, walletAddress);
}

export async function maybePrintQrStderr(walletAddress: string): Promise<void> {
  await printQrTo(process.stderr, walletAddress);
}

async function printQrTo(stream: NodeJS.WriteStream, walletAddress: string): Promise<void> {
  try {
    const mod = (await import("qrcode-terminal")) as unknown as {
      generate?: (
        text: string,
        options: { small?: boolean },
        cb: (rendered: string) => void,
      ) => void;
      default?: {
        generate: (
          text: string,
          options: { small?: boolean },
          cb: (rendered: string) => void,
        ) => void;
      };
    };
    const gen = mod.generate ?? mod.default?.generate;
    if (!gen) return;
    await new Promise<void>((resolve) => {
      gen(walletAddress, { small: true }, (rendered) => {
        stream.write(rendered);
        resolve();
      });
    });
  } catch {
    // qrcode-terminal not installed — walletAddress was already printed above.
  }
}

// ── Output sinks ──────────────────────────────────────────────────────────

/** Emit a line to stderr — used for progress/prompts so stdout stays clean. */
export function stderrLine(line: string): void {
  process.stderr.write(`${line}\n`);
}

// ── Auth helpers ──────────────────────────────────────────────────────────

/** Build a fresh DelegationClient using the stored developer API key. */
export function getDelegationClient(): DelegationClient {
  const devKey = requireDeveloperKey();
  return new DelegationClient(getArispayUrl(), devKey);
}

export function requireDeveloperKey(): string {
  const key = getApiKey();
  if (!key) {
    console.error("No ArisPay developer key found. Run `payagent init` first.");
    process.exit(1);
  }
  return key;
}

// ── Error reporting ───────────────────────────────────────────────────────

/**
 * Scrub internal route fragments out of user-facing error text. The
 * server's internal routes still carry the `/x402` and `/x402-balance`
 * names (we keep those stable as wire contracts; SDKs in the wild
 * depend on them), but the CLI's job is to translate "GET
 * /v1/agents/.../x402-balance failed (401)" into something a human can
 * read without knowing the protocol's brand name.
 */
export function prettifyApiError(message: string): string {
  return message
    .replace(/GET\s+\/v1\/agents\/[^\s]+\/x402-balance/g, "agent balance lookup")
    .replace(/POST\s+\/v1\/agents\/[^\s]+\/hosted-topup/g, "agent funding link request")
    .replace(/POST\s+\/v1\/agents\/x402/g, "agent provisioning")
    .replace(/POST\s+\/v1\/x402\/authorize/g, "payment authorization")
    .replace(/x402[- ]balance/gi, "balance")
    .replace(/\(401\)/g, "(invalid or revoked API key)");
}

export function handleFatal(err: unknown): never {
  if (err instanceof MissingArisPayApiKeyError) {
    console.error("");
    console.error(err.message);
    console.error("");
    console.error("  Run `payagent init` to pair an existing account, or");
    console.error(
      "  `payagent quickstart --email you@example.com` to create one from the terminal.",
    );
    process.exit(1);
  }
  if (err instanceof DeviceCodeError) {
    console.error("");
    console.error(`payagent: ${err.code}: ${err.message}`);
    process.exit(1);
  }
  if (err instanceof BootstrapError) {
    console.error("");
    if (err.status === 409) {
      console.error(`payagent: ${err.message}`);
    } else if (err.status === 429) {
      console.error("payagent: too many signup attempts. Try again in an hour.");
    } else {
      console.error(`payagent: ${err.message}`);
    }
    process.exit(1);
  }
  if (err instanceof Error) {
    const prettified = prettifyApiError(err.message);
    console.error("");
    console.error(`payagent: ${prettified}`);
    if (/fetch failed/i.test(err.message)) {
      console.error("");
      console.error(
        "  This usually means either the ArisPay API or the target paid API could not be reached.",
      );
      console.error("  Check where the CLI is pointed and what it knows locally:");
      console.error("    payagent status");
      console.error("");
      console.error(
        "  If you are calling a paid API, make sure the URL returns an x402 HTTP 402 challenge.",
      );
    }
    // Surface a recovery hint when the failure looks like a stale key.
    if (/401|invalid or revoked/i.test(err.message)) {
      console.error("");
      console.error("  Your stored credentials may be invalid. Try:");
      console.error("    payagent doctor      # diagnose the local config");
      console.error("    payagent init        # re-pair an existing account");
    }
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
}
