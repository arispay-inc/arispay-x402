import {
  getApiKey,
  getArispayUrl,
  listAgents,
  loadConfig,
  saveConfig,
  setApiKey,
} from "../config-store.js";
import { HostedTopupNotConfiguredError } from "../delegation.js";
/* eslint-disable no-console */
/**
 * `payagent pay <url>` — single headless entry point for x402-paid HTTP.
 *
 * A first-time user with nothing configured can run this and get to a
 * paid response without running `init`, `agent create`, or `agent fund`
 * by hand. Each prerequisite is a gate that prompts inline when missing:
 *
 *   1. Developer API key → device-code flow (`ensureAuth`)
 *   2. Local agent       → `launchAgent` with URL-derived domain allowlist
 *                          and conservative default limits (`ensureAgent`)
 *   3. USDC balance      → Coinbase onramp URL (if the API has
 *                          `ARISPAY_ONRAMP_PROVIDER` set) or the raw
 *                          wallet address as a fallback (`ensureFunded`)
 *
 * All prompts, progress, and status messages go to stderr; the HTTP body
 * of the final response goes to stdout so the command is cleanly pipeable.
 */
import { runDeviceAuth } from "../device-code.js";
import { payFetchLocal } from "../fetch-local.js";
import { type LaunchedAgent, getLaunchedAgent, launchAgent } from "../launch.js";
import {
  formatCents,
  formatUsdcString,
  maybePrintQrStderr,
  parseFlags,
  parseHostedAmount,
  stderrLine,
} from "../lib/cli-helpers.js";
import { derivePayDefaults } from "../pay-defaults.js";

export async function cmdPay(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const url = positional[0];
  if (!url) {
    stderrLine("payagent pay: <url> is required.");
    process.exit(1);
  }

  // Permissionless mode: PAYAGENT_PRIVATE_KEY set → sign locally and pay
  // directly. No ArisPay account, no provisioning, no funding gate — and no
  // server-enforced limits (--per-tx is still honored client-side; the other
  // limit flags are delegated-mode only and are ignored here).
  const localKey = process.env.PAYAGENT_PRIVATE_KEY;
  let fetch402: (url: string | URL, init?: RequestInit) => Promise<Response>;
  if (localKey) {
    stderrLine(
      "→ local signer (PAYAGENT_PRIVATE_KEY): no ArisPay account; limits are not server-enforced",
    );
    const perTxCents = flags["per-tx"] as string | undefined;
    fetch402 = payFetchLocal({
      privateKey: localKey,
      ...(perTxCents !== undefined
        ? { maxPerTxBaseUnits: (BigInt(perTxCents) * 10_000n).toString() }
        : {}),
    });
  } else {
    await ensureAuth();
    const agent = await ensureAgent(url, flags);
    await ensureFunded(agent, flags);
    fetch402 = agent.fetch;
  }

  const method = ((flags.method as string | undefined) ?? "GET").toUpperCase();
  const body = flags.body as string | undefined;
  stderrLine(`→ ${method} ${url}`);
  const res = await fetch402(url, { method, body });
  const text = await res.text();
  stderrLine(`HTTP ${res.status} ${res.statusText}`);
  const forwardStatus = res.headers.get("x-paygate-forward-status");
  const originStatus = res.headers.get("x-paygate-origin-status");
  if (forwardStatus && forwardStatus !== "delivered") {
    stderrLine("");
    if (forwardStatus === "origin_error") {
      stderrLine(
        `Payment settled, but the merchant origin returned HTTP ${originStatus ?? res.status}.`,
      );
      stderrLine("The response body below is from the merchant origin, not from PayAgent.");
    } else {
      stderrLine(
        "Payment settled, but PayGate could not deliver the request to the merchant origin.",
      );
    }
    const receipt = res.headers.get("x-paygate-receipt");
    if (receipt && process.env.PAYAGENT_DEBUG === "1") {
      stderrLine(`[payagent] X-Paygate-Receipt: ${receipt}`);
    }
    stderrLine("");
  }
  process.stdout.write(text);
  if (!text.endsWith("\n")) process.stdout.write("\n");
}

// ── `pay` gates ───────────────────────────────────────────────────────────

/** First gate: a developer API key. Runs the device-code flow inline if missing. */
async function ensureAuth(): Promise<void> {
  if (getApiKey()) return;
  const arispayUrl = getArispayUrl();
  stderrLine("");
  stderrLine(`No ArisPay credentials found. Signing in against ${arispayUrl}…`);
  const token = await runDeviceAuth({
    arispayUrl,
    onCode: (info) => {
      stderrLine("");
      stderrLine(`  1. Open:  ${info.verificationUrl}`);
      stderrLine(`  2. Code:  ${info.userCode}`);
      stderrLine("");
      stderrLine(`  Code expires in ${Math.round(info.expiresIn / 60)} min.`);
      stderrLine("");
      process.stderr.write("  Waiting for approval");
    },
    onTick: () => {
      process.stderr.write(".");
    },
  });
  process.stderr.write("\n");
  setApiKey(token.accessToken);
  if (process.env.ARISPAY_URL) {
    const cfg = loadConfig();
    saveConfig({ ...cfg, arispayUrl: process.env.ARISPAY_URL });
  }
  const who = token.email ? ` as ${token.email}` : "";
  stderrLine(`✓ Signed in${who}.`);
}

/**
 * Second gate: a locally-known agent. Rehydrates `--agent <name>` if
 * present, otherwise creates a new agent named `default` with the
 * URL's hostname in `allowedDomains` and conservative limits ($5/tx,
 * $20/day, $100/month).
 */
async function ensureAgent(
  urlStr: string,
  flags: Record<string, string | boolean>,
): Promise<LaunchedAgent> {
  const defaults = derivePayDefaults(urlStr, flags, listAgents()[0]?.name);
  if (!defaults.ok) {
    stderrLine(defaults.error);
    process.exit(1);
  }

  const existing = getLaunchedAgent(defaults.name);
  if (existing) return existing;

  stderrLine("");
  stderrLine(`No agent \`${defaults.name}\` yet. Creating one:`);
  stderrLine(`  Per-tx:   ${formatCents(defaults.perTx)}`);
  stderrLine(`  Daily:    ${formatCents(defaults.daily)}`);
  stderrLine(`  Monthly:  ${formatCents(defaults.monthly)}`);
  stderrLine(`  Network:  ${defaults.network}`);
  stderrLine(`  Domains:  ${defaults.allowedDomains.join(", ")}`);
  stderrLine("  (Override with --per-tx / --daily / --monthly / --network / --domains.)");

  const agent = await launchAgent({
    name: defaults.name,
    limits: { perTx: defaults.perTx, daily: defaults.daily, monthly: defaults.monthly },
    allowedDomains: defaults.allowedDomains,
    network: defaults.network,
  });

  stderrLine(`✓ Agent \`${defaults.name}\` created.`);
  stderrLine(`  Wallet:   ${agent.walletAddress}`);
  return agent;
}

/**
 * Third gate: funded wallet. If the agent has 0 USDC, prefers a
 * Coinbase onramp URL (when the API has `ARISPAY_ONRAMP_PROVIDER` set).
 * Falls back to printing the raw wallet address. Either way, polls
 * until funds arrive.
 */
async function ensureFunded(
  agent: LaunchedAgent,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const initial = await agent.getBalance();
  if (initial.usdcBalance && initial.usdcBalance !== "0") return;

  stderrLine("");
  stderrLine(`Agent \`${agent.name}\` has 0 USDC. Fund it before paying.`);
  stderrLine("");

  const hostedAmount =
    typeof flags.amount === "string" ? parseHostedAmount(flags.amount) : undefined;

  let printedHosted = false;
  try {
    const link = await agent.getFundingLink(
      hostedAmount !== undefined ? { amount: hostedAmount } : {},
    );
    stderrLine(`Open this link to top up via ${link.provider}:`);
    stderrLine("");
    stderrLine(`  ${link.fundingUrl}`);
    stderrLine("");
    stderrLine(`  Wallet:      ${link.walletAddress}`);
    stderrLine(`  Network:     ${link.network}`);
    stderrLine(`  Valid until: ${link.expiresAt}`);
    stderrLine("");
    printedHosted = true;
  } catch (err) {
    if (!(err instanceof HostedTopupNotConfiguredError)) throw err;
  }

  if (!printedHosted) {
    stderrLine(`Hosted onramp is not configured. Send USDC on ${agent.network} to:`);
    stderrLine("");
    stderrLine(`  ${agent.walletAddress}`);
    stderrLine("");
    await maybePrintQrStderr(agent.walletAddress);
    stderrLine("");
  }

  process.stderr.write("Waiting for deposit");
  const settled = await agent.waitUntilFunded({ intervalMs: 5000, timeoutMs: 15 * 60 * 1000 });
  process.stderr.write("\n");
  stderrLine(
    `✓ Funded. Balance: ${formatUsdcString(settled.usdcBalance)} USDC on ${settled.network}.`,
  );
}
