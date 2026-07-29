/* eslint-disable no-console */
/**
 * `agentmarketplace agent create | balance` — provision an x402 agent
 * wallet on ArisPay and check its on-chain USDC balance.
 *
 * Distinct from `payagent agent create`: this one is part of the
 * agentmarketplace CLI's onboarding flow. Same underlying API.
 */
import { loadConfig, parseFlags, prompt } from "../lib/cli-helpers.js";

export async function cmdAgent(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (sub === "create") {
    await cmdAgentCreate(rest);
    return;
  }
  if (sub === "balance") {
    await cmdAgentBalance(rest);
    return;
  }
  console.error("Usage:");
  console.error(
    "  agentmarketplace agent create [--name=... --max-per-tx=... --max-daily=... --max-monthly=... --network=base --allowed-domains=a.com,b.com]",
  );
  console.error("  agentmarketplace agent balance <agentId>");
  process.exit(1);
}

async function cmdAgentCreate(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const cfg = loadConfig();
  const devKey = process.env.ARISPAY_API_KEY ?? cfg.apiKey;
  if (!devKey) {
    console.error("Not logged in. Run: agentmarketplace login <ap_live_...>");
    console.error("Create a key at https://payagent.arispay.app/dashboard/api-keys");
    process.exit(1);
  }
  if (!/^ap_(live|test)_/.test(devKey)) {
    console.error("Warning: key does not look like an ap_live_/ap_test_ developer key.");
    console.error("  `agent create` requires a developer key, not an agent-scoped key.");
  }

  const name = flags.name ?? (await prompt('Agent name (e.g. "smoke-test"): '));
  if (!name) {
    console.error("Name is required.");
    process.exit(1);
  }

  const maxPerTx = flags["max-per-tx"]
    ? Number.parseInt(flags["max-per-tx"], 10)
    : Number.parseInt((await prompt("Per-tx limit in cents [100]: ")) || "100", 10);
  const maxDaily = flags["max-daily"]
    ? Number.parseInt(flags["max-daily"], 10)
    : Number.parseInt((await prompt("Daily limit in cents [500]: ")) || "500", 10);
  const maxMonthly = flags["max-monthly"]
    ? Number.parseInt(flags["max-monthly"], 10)
    : Number.parseInt((await prompt("Monthly limit in cents [2000]: ")) || "2000", 10);
  const network = flags.network ?? "base";
  const allowedDomains = flags["allowed-domains"]
    ? flags["allowed-domains"]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const body = {
    name,
    maxPerTx,
    maxDaily,
    maxMonthly,
    network,
    ...(allowedDomains.length ? { allowedDomains } : {}),
  };

  const arispayUrl = process.env.ARISPAY_URL ?? "https://api.arispay.app";
  const res = await fetch(`${arispayUrl}/v1/agents/x402`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${devKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`Create failed: ${res.status} ${text}`);
    process.exit(1);
  }
  const agent = (await res.json()) as {
    agentId: string;
    walletAddress: string;
    apiKey: string;
    status: string;
    limits: { maxPerTx: number; maxDaily: number; maxMonthly: number };
    network?: string;
  };

  console.log("");
  console.log("✓ Agent created");
  console.log("");
  console.log(`  agentId:        ${agent.agentId}`);
  console.log(`  network:        ${agent.network ?? network}`);
  console.log(`  walletAddress:  ${agent.walletAddress}`);
  console.log(
    `  limits:         per-tx $${(agent.limits.maxPerTx / 100).toFixed(2)}, daily $${(agent.limits.maxDaily / 100).toFixed(2)}, monthly $${(agent.limits.maxMonthly / 100).toFixed(2)}`,
  );
  console.log(`  status:         ${agent.status}`);
  console.log("");
  console.log("Agent API key (returned ONCE — store it now):");
  console.log("");
  console.log(`  ${agent.apiKey}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Send USDC on ${agent.network ?? network} to ${agent.walletAddress}`);
  console.log(`  2. agentmarketplace agent balance ${agent.agentId}    # wait until funded`);
  console.log(
    `  3. agentmarketplace login ${agent.apiKey.slice(0, 12)}...   # switch to agent key for paid calls`,
  );
  console.log("  4. agentmarketplace call <slug>                       # pay for anything");
  console.log("");
  console.log(
    "(Keep your original ap_live_ developer key safe — switch back with `login` to publish listings or create more agents.)",
  );
}

async function cmdAgentBalance(args: string[]): Promise<void> {
  const [agentId] = args;
  if (!agentId) {
    console.error("Usage: agentmarketplace agent balance <agentId>");
    process.exit(1);
  }
  const cfg = loadConfig();
  const key = process.env.ARISPAY_API_KEY ?? cfg.apiKey;
  if (!key) {
    console.error("Not logged in. Run: agentmarketplace login <ap_live_...>");
    process.exit(1);
  }
  const arispayUrl = process.env.ARISPAY_URL ?? "https://api.arispay.app";
  const res = await fetch(`${arispayUrl}/v1/agents/${encodeURIComponent(agentId)}/x402-balance`, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`Balance check failed: ${res.status} ${text}`);
    process.exit(1);
  }
  const b = (await res.json()) as {
    walletAddress: string;
    usdcBalance: string;
    network: string;
    fundedAt: string | null;
  };
  const usdc = Number(b.usdcBalance) / 1_000_000;
  console.log(`  wallet:     ${b.walletAddress}`);
  console.log(`  network:    ${b.network}`);
  console.log(`  USDC:       ${usdc.toFixed(6)}`);
  console.log(`  fundedAt:   ${b.fundedAt ?? "(not yet funded)"}`);
}
