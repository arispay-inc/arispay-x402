/* eslint-disable no-console */
/**
 * `agentmarketplace try <slug>` — one-command paid-call flow.
 *
 * Provisions a low-limit "try-agent" tied to the slug, top up via fiat
 * if the wallet is empty, then call the listing once. The agent is
 * cached at `~/.agentmarketplace/config.json` under `tryAgents[slug]`
 * so subsequent `try` calls reuse it.
 */
import {
  type StoredConfig,
  formatListing,
  getClient,
  loadConfig,
  parseFlags,
  saveConfig,
} from "../lib/cli-helpers.js";

const TRY_DEFAULT_LIMITS = { maxPerTx: 10, maxDaily: 100, maxMonthly: 500 };
const TRY_POLL_INTERVAL_MS = 5_000;
const TRY_MAX_POLL_MS = 10 * 60 * 1_000;

interface TryAgentRecord {
  agentId: string;
  walletAddress: string;
  apiKey: string;
  network: string;
}

function tryStoreGet(slug: string): TryAgentRecord | undefined {
  const cfg = loadConfig();
  const m = (cfg as { tryAgents?: Record<string, TryAgentRecord> }).tryAgents;
  return m?.[slug];
}

function tryStoreSet(slug: string, rec: TryAgentRecord): void {
  const cfg = loadConfig() as StoredConfig & { tryAgents?: Record<string, TryAgentRecord> };
  cfg.tryAgents = { ...(cfg.tryAgents ?? {}), [slug]: rec };
  saveConfig(cfg);
}

async function ensureTryAgent(slug: string, devKey: string): Promise<TryAgentRecord> {
  const existing = tryStoreGet(slug);
  if (existing) return existing;

  console.log("Creating a dedicated try-agent (low spend limits — safe to burn).");
  const arispayUrl = process.env.ARISPAY_URL ?? "https://api.arispay.app";
  const body = {
    name: `try-${slug.replace(/[^a-z0-9-]/gi, "-")}-${Date.now().toString(36).slice(-4)}`,
    ...TRY_DEFAULT_LIMITS,
    network: "base",
  };
  const res = await fetch(`${arispayUrl}/v1/agents/x402`, {
    method: "POST",
    headers: { authorization: `Bearer ${devKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`agent create failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as {
    agentId: string;
    walletAddress: string;
    apiKey: string;
    network?: string;
  };
  const rec: TryAgentRecord = {
    agentId: data.agentId,
    walletAddress: data.walletAddress,
    apiKey: data.apiKey,
    network: data.network ?? "base",
  };
  tryStoreSet(slug, rec);
  console.log(`✓ agent ${rec.agentId} ready`);
  return rec;
}

async function fetchUsdcBalanceMicros(agent: TryAgentRecord, devKey: string): Promise<bigint> {
  const arispayUrl = process.env.ARISPAY_URL ?? "https://api.arispay.app";
  const res = await fetch(
    `${arispayUrl}/v1/agents/${encodeURIComponent(agent.agentId)}/x402-balance`,
    { headers: { authorization: `Bearer ${devKey}` } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`balance check failed: ${res.status} ${text}`);
  }
  const b = (await res.json()) as { usdcBalance: string };
  try {
    return BigInt(b.usdcBalance);
  } catch {
    return 0n;
  }
}

async function maybeRequestHostedTopup(
  agent: TryAgentRecord,
  amountCents: number,
  devKey: string,
): Promise<string | null> {
  const arispayUrl = process.env.ARISPAY_URL ?? "https://api.arispay.app";
  const res = await fetch(
    `${arispayUrl}/v1/agents/${encodeURIComponent(agent.agentId)}/hosted-topup`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${devKey}`, "content-type": "application/json" },
      body: JSON.stringify({ amountCents, currency: "USD" }),
    },
  );
  if (res.status === 501 || res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`Hosted top-up unavailable (${res.status}): ${text}`);
    return null;
  }
  const data = (await res.json()) as { checkoutUrl?: string };
  return data.checkoutUrl ?? null;
}

async function waitForBalance(
  agent: TryAgentRecord,
  devKey: string,
  requiredMicros: bigint,
): Promise<bigint> {
  const started = Date.now();
  let last = 0n;
  while (Date.now() - started < TRY_MAX_POLL_MS) {
    const bal = await fetchUsdcBalanceMicros(agent, devKey).catch(() => 0n);
    if (bal !== last) {
      last = bal;
      process.stdout.write(`\r  balance: ${(Number(bal) / 1e6).toFixed(6)} USDC        `);
    }
    if (bal >= requiredMicros) {
      process.stdout.write("\n");
      return bal;
    }
    await new Promise((r) => setTimeout(r, TRY_POLL_INTERVAL_MS));
  }
  process.stdout.write("\n");
  return last;
}

async function openUrl(url: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    console.log(`(could not auto-open browser — paste this URL manually: ${url})`);
  }
}

export async function cmdTry(args: string[]): Promise<void> {
  const { positional } = parseFlags(args);
  const [slug] = positional;
  if (!slug) {
    console.error("Usage: agentmarketplace try <slug>");
    process.exit(1);
  }

  const cfg = loadConfig();
  const devKey = cfg.developerKey ?? (cfg.apiKey?.startsWith("ap_") ? cfg.apiKey : undefined);
  if (!devKey) {
    console.error(
      "No developer key. Run `agentmarketplace merchant signup` or `agentmarketplace login ap_live_...` first.",
    );
    process.exit(1);
  }

  const client = getClient();
  const listing = await client.get(slug);
  if (!listing) {
    console.error(`Not found: ${slug}`);
    process.exit(1);
  }

  if (listing.endpoint.transport !== "http" && listing.endpoint.transport !== "http-x402") {
    console.error(
      `try only works on http / http-x402 listings (this one is ${listing.endpoint.transport}).`,
    );
    console.error(
      "For MCP servers use `agentmarketplace install <slug>` and invoke through your MCP client.",
    );
    process.exit(1);
  }
  const url = listing.endpoint.url;
  if (!url) {
    console.error("Listing has no endpoint URL.");
    process.exit(1);
  }

  const priceCents = listing.pricing?.amount ?? 0;
  const requiredMicros = BigInt(priceCents) * 10_000n;
  console.log(formatListing(listing));
  console.log("");

  const agent = await ensureTryAgent(slug, devKey);

  if (listing.pricing?.model === "x402" && priceCents > 0) {
    let balance = await fetchUsdcBalanceMicros(agent, devKey);
    if (balance < requiredMicros) {
      console.log(`Balance ${Number(balance) / 1e6} USDC < ${priceCents / 100} USDC required.`);
      const checkoutUrl = await maybeRequestHostedTopup(agent, priceCents * 2, devKey);
      if (checkoutUrl) {
        console.log(`Opening hosted checkout: ${checkoutUrl}`);
        await openUrl(checkoutUrl);
      } else {
        console.log("");
        console.log("Fiat top-up not configured on this server.");
        console.log(`Send at least ${priceCents / 100} USDC to this address on ${agent.network}:`);
        console.log("");
        console.log(`  ${agent.walletAddress}`);
        console.log("");
      }
      balance = await waitForBalance(agent, devKey, requiredMicros);
      if (balance < requiredMicros) {
        console.error("Still unfunded after the polling window. Aborting.");
        process.exit(1);
      }
    }
  }

  console.log("→ paying for one call…");
  const { payFetchDelegated } = await import("payagent");
  const arispayUrl = process.env.ARISPAY_URL ?? "https://api.arispay.app";
  const fetch402 = payFetchDelegated({ arispayUrl, apiKey: agent.apiKey });
  const res = await fetch402(url, { method: "GET" });
  const text = await res.text();
  console.log(`HTTP ${res.status} ${res.statusText}`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
  const txHash = res.headers.get("x-payment-tx") ?? res.headers.get("x-payment-response");
  if (txHash) console.log(`  tx: ${txHash}`);
  const remaining = await fetchUsdcBalanceMicros(agent, devKey);
  console.log(`  remaining balance: ${(Number(remaining) / 1e6).toFixed(6)} USDC`);
}
