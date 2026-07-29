import {
  getAgent,
  getApiKey,
  getArispayUrl,
  listAgents,
  removeAgent,
  renameStoredAgent,
} from "../config-store.js";
/* eslint-disable no-console */
/**
 * `payagent agent <subcommand>` — manage locally-stored agents.
 *
 *   create   provision a CDP-managed agent + persist credentials locally
 *   fund     print address (or hosted onramp URL) and poll until USDC arrives
 *   balance  one-shot USDC balance check
 *   list     enumerate locally-stored agents
 *   remove   drop the local cache entry (server-side agent unaffected)
 */
import { DelegationClient, HostedTopupNotConfiguredError } from "../delegation.js";
import { getLaunchedAgent, launchAgent } from "../launch.js";
import {
  DEFAULT_DAILY_CENTS,
  DEFAULT_MONTHLY_CENTS,
  DEFAULT_PER_TX_CENTS,
  formatCents,
  formatUsdcString,
  maybePrintQr,
  parseAmountFlag,
  parseAmountString,
  parseFlags,
  parseHostedAmount,
} from "../lib/cli-helpers.js";
import { isInteractive, prompt, validateAmount } from "../prompts.js";
import { MissingDevKeyForSyncError, syncAgents } from "../sync-agents.js";

export async function cmdAgent(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "create":
      await cmdAgentCreate(rest);
      break;
    case "fund":
      await cmdAgentFund(rest);
      break;
    case "balance":
      await cmdAgentBalance(rest);
      break;
    case "list":
    case "ls":
      await cmdAgentList(rest);
      break;
    case "rename":
    case "mv":
      await cmdAgentRename(rest);
      break;
    case "remove":
    case "rm":
      cmdAgentRemove(rest);
      break;
    case undefined:
    case "--help":
    case "-h":
      printAgentUsage();
      break;
    default:
      console.error(`payagent agent: unknown subcommand \`${sub}\``);
      printAgentUsage();
      process.exit(1);
  }
}

async function cmdAgentCreate(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);

  // Positional name comes first — `payagent agent create polar` must
  // work without flags. Falls back to --name / -n when provided.
  let name = positional[0];
  if (!name && typeof flags.name === "string") name = flags.name;
  else if (!name && typeof flags.n === "string") name = flags.n;

  if (!name) {
    if (isInteractive()) {
      name = await prompt("Agent name", {
        validate: (raw) =>
          /^[a-zA-Z0-9_-]+$/.test(raw) ? undefined : "Use letters, numbers, _ or -.",
      });
    } else {
      console.error("payagent: agent name is required (e.g. `payagent agent create polar`).");
      process.exit(1);
    }
  }

  // Limits: explicit flag wins, then TTY prompt, then conservative
  // defaults. The defaults match the API's expected shape (positive
  // integer cents) so the route accepts them as-is.
  let perTx = parseAmountFlag(flags["per-tx"] ?? flags.t);
  let daily = parseAmountFlag(flags.daily ?? flags.d);
  let monthly = parseAmountFlag(flags.monthly ?? flags.m);

  if (perTx === undefined && daily === undefined && monthly === undefined) {
    // No limits supplied at all — apply defaults. Print a one-liner so the
    // user knows we made a choice on their behalf.
    perTx = DEFAULT_PER_TX_CENTS;
    daily = DEFAULT_DAILY_CENTS;
    monthly = DEFAULT_MONTHLY_CENTS;
  } else {
    // Partial limits supplied — fill the holes interactively or fall
    // back to defaults to avoid the multi-error stutter.
    if (perTx === undefined) {
      perTx = isInteractive()
        ? parseAmountString(
            await prompt("Per-transaction limit (USD)", {
              default: formatCents(DEFAULT_PER_TX_CENTS),
              validate: validateAmount,
            }),
          )
        : DEFAULT_PER_TX_CENTS;
    }
    if (daily === undefined) {
      daily = isInteractive()
        ? parseAmountString(
            await prompt("Daily limit (USD)", {
              default: formatCents(DEFAULT_DAILY_CENTS),
              validate: validateAmount,
            }),
          )
        : DEFAULT_DAILY_CENTS;
    }
    if (monthly === undefined) {
      monthly = isInteractive()
        ? parseAmountString(
            await prompt("Monthly limit (USD)", {
              default: formatCents(DEFAULT_MONTHLY_CENTS),
              validate: validateAmount,
            }),
          )
        : DEFAULT_MONTHLY_CENTS;
    }
  }

  const domains =
    typeof flags.domains === "string"
      ? flags.domains
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  const network =
    (flags.network as "base" | "base-sepolia" | "ethereum" | "polygon" | undefined) ?? undefined;
  const agentType = typeof flags.type === "string" ? flags.type : undefined;
  const description = typeof flags.description === "string" ? flags.description : undefined;
  const hostedAmount =
    typeof flags.amount === "string"
      ? parseHostedAmount(flags.amount)
      : typeof flags.hosted === "string"
        ? parseHostedAmount(flags.hosted)
        : undefined;

  const usedDefaults =
    perTx === DEFAULT_PER_TX_CENTS &&
    daily === DEFAULT_DAILY_CENTS &&
    monthly === DEFAULT_MONTHLY_CENTS;

  const agent = await launchAgent({
    name,
    limits: { perTx, daily, monthly },
    allowedDomains: domains,
    network,
    agentType,
    description,
  });

  console.log(`✓ Agent \`${name}\` created.`);
  console.log(`  Agent ID:   ${agent.agentId}`);
  console.log(`  Wallet:     ${agent.walletAddress}`);
  console.log(`  Network:    ${agent.network}`);
  console.log(
    `  Limits:     ${formatCents(agent.limits.perTx)} / tx, ${formatCents(agent.limits.daily)} / day, ${formatCents(agent.limits.monthly)} / month${usedDefaults ? "  (defaults — override with --per-tx, --daily, --monthly)" : ""}`,
  );
  if (agent.allowedDomains.length) {
    console.log(`  Domains:    ${agent.allowedDomains.join(", ")}`);
  }
  console.log("");

  if (flags["no-fund"] === true) {
    console.log(`  Fund the wallet with USDC on ${agent.network}, then:`);
    console.log(`    payagent agent fund ${name}`);
    return;
  }

  try {
    const link = await agent.getFundingLink(
      hostedAmount !== undefined ? { amount: hostedAmount } : {},
    );
    console.log(`  Open this link to top up via ${link.provider}:`);
    console.log("");
    console.log(`    ${link.fundingUrl}`);
    console.log("");
    console.log(`  URL valid until: ${link.expiresAt}`);
    console.log(`  Or send USDC on ${agent.network} directly to ${agent.walletAddress}`);
    console.log("");
    console.log("  After funding lands, check it with:");
    console.log(`    payagent agent balance ${name}`);
  } catch (err) {
    if (!(err instanceof HostedTopupNotConfiguredError)) throw err;
    console.log("  Hosted onramp is not configured on this deployment.");
    console.log(`  Send USDC on ${agent.network} to:`);
    console.log("");
    console.log(`    ${agent.walletAddress}`);
    console.log("");
    console.log("  Then:");
    console.log(`    payagent agent fund ${name}`);
  }
}

async function cmdAgentFund(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const name = positional[0];
  if (!name) {
    console.error("payagent agent fund: <name> is required.");
    process.exit(1);
  }
  const agent = getLaunchedAgent(name);
  if (!agent) {
    console.error(
      `No locally-stored agent named \`${name}\`. Create one with \`payagent agent create --name ${name}\`.`,
    );
    process.exit(1);
  }

  // `--hosted` (optionally with an amount) asks the server for a hosted
  // onramp URL (Coinbase, etc.) and prints that instead of the plain
  // wallet address. Polling still applies — we report when the deposit
  // lands, whether the user paid on the hosted page or sent USDC directly.
  const hosted = flags.hosted === true || typeof flags.hosted === "string";
  const hostedAmount =
    typeof flags.hosted === "string"
      ? parseHostedAmount(flags.hosted)
      : typeof flags.amount === "string"
        ? parseHostedAmount(flags.amount)
        : undefined;

  if (hosted) {
    try {
      const link = await agent.getFundingLink(
        hostedAmount !== undefined ? { amount: hostedAmount } : {},
      );
      console.log(`Open this link to top up \`${name}\` via ${link.provider}:`);
      console.log("");
      console.log(`  ${link.fundingUrl}`);
      console.log("");
      console.log(`  Wallet: ${link.walletAddress}`);
      console.log(`  Network: ${link.network}`);
      console.log(`  URL valid until: ${link.expiresAt}`);
      console.log("");
    } catch (err) {
      if (err instanceof HostedTopupNotConfiguredError) {
        console.log(
          "Hosted onramp is not configured on this deployment. Falling back to manual USDC deposit.",
        );
        console.log(
          "If Coinbase Onramp opens but says it is unavailable in your country or app, that is an onramp availability issue, not an agent setup failure.",
        );
        console.log("");
      } else {
        throw err;
      }
    }
  }

  if (!hosted) {
    console.log(`Fund \`${name}\` by sending USDC on ${agent.network} to:`);
    console.log("");
    console.log(`  ${agent.walletAddress}`);
    console.log("");
    await maybePrintQr(agent.walletAddress);
    console.log("");
  }
  process.stdout.write("  Waiting for deposit");
  const settled = await agent.waitUntilFunded({ intervalMs: 5000, timeoutMs: 15 * 60 * 1000 });
  process.stdout.write("\n");
  const human = formatUsdcString(settled.usdcBalance);
  console.log(`✓ Funded. Balance: ${human} USDC on ${settled.network}.`);
}

async function cmdAgentBalance(args: string[]): Promise<void> {
  const [name] = args;
  if (!name) {
    console.error("payagent agent balance: <name> is required.");
    process.exit(1);
  }
  const agent = getLaunchedAgent(name);
  if (!agent) {
    console.error(`No locally-stored agent named \`${name}\`.`);
    process.exit(1);
  }
  const balance = await agent.getBalance();
  const human = formatUsdcString(balance.usdcBalance);
  console.log(`${name}: ${human} USDC on ${balance.network}`);
  if (balance.fundedAt) {
    console.log(`  First funded: ${balance.fundedAt}`);
  } else {
    console.log("  Not yet funded.");
  }
  console.log(`  Wallet: ${balance.walletAddress}`);
}

async function cmdAgentList(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const localOnly = flags.local === true || flags["local-only"] === true;
  const withBalance = flags.balance === true || flags["with-balance"] === true;
  const hasDevKey = Boolean(getApiKey());

  // Server-first when we have a developer key — this is the whole point
  // of the change. The local cache shows ONLY agents created on this
  // machine; the server knows every wallet under the account. Without
  // the sync, a user on a new machine sees zero wallets and may mint a
  // fresh one, orphaning funded wallets they already own.
  if (!localOnly && hasDevKey) {
    try {
      const result = await syncAgents({ includeBalance: withBalance });
      if (!result.agents.length) {
        console.log("No wallets under this account. Create one with `payagent agent create`.");
        return;
      }
      console.log(
        `${result.agents.length} wallet${result.agents.length === 1 ? "" : "s"} (synced from server):`,
      );
      console.log("");
      for (const a of result.agents) {
        console.log(`${a.name}`);
        console.log(`  agent id:  ${a.agentId}`);
        console.log(`  wallet:    ${a.walletAddress}`);
        console.log(`  network:   ${a.network}`);
        console.log(
          `  limits:    ${formatCents(a.limits.maxPerTx)} / tx, ${formatCents(a.limits.maxDaily)} / day, ${formatCents(a.limits.maxMonthly)} / month`,
        );
        console.log(
          `  domains:   ${a.allowedDomains.length ? a.allowedDomains.join(", ") : "(unrestricted)"}`,
        );
        if (a.usdcBalance !== undefined) {
          console.log(`  balance:   ${formatUsdcString(a.usdcBalance)} USDC`);
        }
        console.log(`  funded:    ${a.fundedAt ?? "not yet"}`);
        if (a.suspended) console.log("  status:    SUSPENDED");
        console.log(`  created:   ${a.createdAt}`);
      }
      return;
    } catch (err) {
      if (err instanceof MissingDevKeyForSyncError) {
        // Fall through to local listing below.
      } else {
        console.error(
          `payagent agent list: server sync failed (${err instanceof Error ? err.message : String(err)}). Falling back to local cache.`,
        );
      }
    }
  }

  // Local-cache fallback (no dev key, or --local flag).
  const agents = listAgents();
  if (!agents.length) {
    if (hasDevKey) {
      console.log("No agents stored locally. Create one with `payagent agent create`.");
    } else {
      console.log("No developer key and no agents stored locally.");
      console.log("Set ARISPAY_API_KEY or run `payagent init` to enable server-side sync.");
    }
    return;
  }
  console.log(`${agents.length} wallet${agents.length === 1 ? "" : "s"} (local cache only):`);
  console.log("");
  for (const a of agents) {
    console.log(`${a.name}`);
    console.log(`  agent id:  ${a.agentId}`);
    console.log(`  wallet:    ${a.walletAddress}`);
    console.log(
      `  limits:    ${formatCents(a.limits.perTx)} / tx, ${formatCents(a.limits.daily)} / day, ${formatCents(a.limits.monthly)} / month`,
    );
    console.log(`  created:   ${a.createdAt}`);
  }
}

async function cmdAgentRename(args: string[]): Promise<void> {
  const { positional } = parseFlags(args);
  const oldName = positional[0];
  const newName = positional[1];
  if (!oldName || !newName) {
    console.error("payagent agent rename: <old-name> <new-name> required.");
    console.error("  e.g. payagent agent rename default Travel");
    process.exit(1);
  }
  if (oldName === newName) {
    console.log(`Already named \`${oldName}\` — nothing to do.`);
    return;
  }
  const stored = getAgent(oldName);
  if (!stored) {
    console.error(
      `No locally-cached agent named \`${oldName}\`. Run \`payagent agent list\` to sync.`,
    );
    process.exit(1);
  }
  const devKey = getApiKey();
  if (!devKey) {
    console.error(
      "payagent agent rename: developer key required. Run `payagent init` or set ARISPAY_API_KEY.",
    );
    process.exit(1);
  }
  try {
    const client = new DelegationClient(getArispayUrl(), devKey);
    const result = await client.renameAgent(stored.agentId, newName);
    renameStoredAgent(oldName, result.name);
    console.log(
      `✓ Renamed \`${oldName}\` → \`${result.name}\`. Wallet ${result.walletAddress ?? stored.walletAddress} unchanged.`,
    );
  } catch (err) {
    console.error(`payagent agent rename: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function cmdAgentRemove(args: string[]): void {
  const [name] = args;
  if (!name) {
    console.error("payagent agent remove: <name> is required.");
    process.exit(1);
  }
  const existed = getAgent(name);
  if (!existed) {
    console.error(`No locally-stored agent named \`${name}\`.`);
    process.exit(1);
  }
  const ok = removeAgent(name);
  if (ok) {
    console.log(
      `✓ Removed \`${name}\` from local store. The agent still exists on ArisPay — this only clears your local cache.`,
    );
  }
}

function printAgentUsage(): void {
  console.log("payagent agent <subcommand>");
  console.log("");
  console.log(
    "  create    [NAME] [--per-tx N --daily N --monthly N] [--domains CSV] [--network …]",
  );
  console.log("  fund      NAME [--hosted [AMOUNT]]");
  console.log("  balance   NAME");
  console.log(
    "  list      [--balance] [--local]      sync from server; --local reads the cache only",
  );
  console.log("  rename    OLD-NAME NEW-NAME           server-side rename; mirrors to local cache");
  console.log("  remove    NAME                        local cache only — server agent unaffected");
}
