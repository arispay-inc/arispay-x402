/* eslint-disable no-console */
/**
 * `payagent doctor` (alias `status`) — local config diagnostic.
 *
 * Reports binary path, node version, ArisPay URL, npm latest vs current,
 * stored API key validity, and the per-agent on-chain balance.
 *
 * Also exports `cmdLogout` and `cmdWhoami` because they share the same
 * config-store concerns and are tiny.
 */
import { formatUSDC } from "../balance.js";
import {
  clearApiKey,
  getApiKey,
  getArispayUrl,
  getConfigPath,
  listAgents,
} from "../config-store.js";
import { getLaunchedAgent } from "../launch.js";
import { VERSION, formatCents, prettifyApiError } from "../lib/cli-helpers.js";

function formatUsdcString(raw: string): string {
  try {
    return formatUSDC(BigInt(raw || "0"));
  } catch {
    return raw;
  }
}

export async function cmdDoctor(): Promise<void> {
  const url = getArispayUrl();
  const key = getApiKey();
  const agents = listAgents();

  console.log(`payagent ${VERSION}`);
  console.log("");
  console.log(`  Binary:    ${process.argv[1] || "(unknown)"}`);
  console.log(`  Node:      ${process.version}`);
  console.log(`  ArisPay:   ${url}`);
  console.log(`  Config:    ${getConfigPath()}`);
  console.log("");

  // Version check, but synchronously this time so the user sees the result.
  console.log("Checking for updates…");
  let latest: string | undefined;
  try {
    const res = await fetch("https://registry.npmjs.org/payagent", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const body = (await res.json()) as { "dist-tags"?: { latest?: string } };
      latest = body["dist-tags"]?.latest;
    }
  } catch {
    // Network failure — non-fatal.
  }
  if (latest && latest !== VERSION) {
    console.log(`  ⚠  Latest published is ${latest}. Run \`npm install -g payagent@latest\`.`);
  } else if (latest) {
    console.log(`  ✓  Up to date (${VERSION}).`);
  } else {
    console.log("  ?  Could not reach the npm registry (no internet?). Skipping.");
  }
  console.log("");

  if (!key) {
    console.log(
      "  ⚠  Not signed in. Run `payagent init` or `payagent quickstart --email you@example.com`.",
    );
  } else {
    console.log(`  ✓  Signed in. API key ap_…${key.slice(-4)}`);
    // Light validation. `GET /v1/agents?limit=1` is the cheapest
    // authenticated read on the API: 200 = key accepted, 401 = revoked,
    // anything else (5xx, network) we report verbatim and stay out of
    // the way. The earlier probe hit `GET /v1/agents/x402` which is
    // POST-only and returned 404 against a perfectly valid key.
    try {
      const res = await fetch(`${url}/v1/agents?limit=1`, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 401) {
        console.log("  ⚠  API rejected the stored key (401). Run `payagent init` to re-pair.");
      } else if (res.ok) {
        console.log("  ✓  API accepts the stored key.");
      } else {
        console.log(
          `  ?  API returned ${res.status} for the stored key — try \`payagent whoami\`.`,
        );
      }
    } catch (err) {
      console.log(
        `  ?  Could not reach ${url} (${err instanceof Error ? err.message : String(err)}).`,
      );
    }
  }
  console.log("");

  if (agents.length === 0) {
    console.log("  No locally-stored agents.");
    console.log("");
    if (key) {
      console.log("Next:");
      console.log("  payagent agent create default --network base --domains <api-host>");
    }
  } else {
    console.log(`  Locally-stored agents: ${agents.length}`);
    for (const a of agents) {
      console.log(`    - ${a.name}`);
      console.log(`        agent id:  ${a.agentId}`);
      console.log(`        wallet:    ${a.walletAddress}`);
      console.log(`        network:   ${a.network ?? "base"}`);
      if (a.allowedDomains?.length) {
        console.log(`        domains:   ${a.allowedDomains.join(", ")}`);
      }
      console.log(
        `        limits:    ${formatCents(a.limits.perTx)} / tx, ${formatCents(a.limits.daily)} / day, ${formatCents(a.limits.monthly)} / month`,
      );
      const launched = getLaunchedAgent(a.name);
      if (!launched) continue;
      try {
        const balance = await launched.getBalance();
        const human = formatUsdcString(balance.usdcBalance);
        const funded = balance.fundedAt || BigInt(balance.usdcBalance || "0") > 0n;
        console.log(`        balance:   ${human} USDC ${funded ? "✓ funded" : "⚠ not funded"}`);
        if (!funded) {
          console.log(`        next:      payagent agent fund ${a.name} --hosted 25`);
        }
      } catch (err) {
        console.log(
          `        balance:   ? ${err instanceof Error ? prettifyApiError(err.message) : String(err)}`,
        );
      }
    }
    console.log("");
    console.log("Next:");
    console.log("  payagent pay <x402-url> --agent <name>");
    console.log("  Use PAYAGENT_DEBUG=1 when the seller returns another 402 after signing.");
  }
}

export function cmdLogout(): void {
  clearApiKey();
  console.log("Signed out. Stored agents kept.");
}

export function cmdWhoami(): void {
  const key = getApiKey();
  const url = getArispayUrl();
  if (!key) {
    console.log("Not signed in. Run `payagent init`.");
    return;
  }
  const tail = key.slice(-4);
  console.log("Signed in.");
  console.log(`  API key:   ap_…${tail}`);
  console.log(`  ArisPay:   ${url}`);
  console.log(`  Config:    ${getConfigPath()}`);
}
