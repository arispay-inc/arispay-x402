import { getAgent } from "../config-store.js";
/* eslint-disable no-console */
/**
 * `payagent user <subcommand>` — manage end-users (the developer's
 * customers, persisted as `EndUser` rows on api.arispay.app).
 *
 *   create        provision an end-user
 *   get           show the JSON
 *   attach-card   hosted card-entry URL + poll until tokenized
 *   attach-wallet attach an existing on-chain wallet for crypto rails
 *   set-limits    per-user, per-agent spend overrides
 *   status        card + wallet + allowance readiness
 */
import type { WalletChain } from "../delegation.js";
import {
  formatCents,
  formatUsdcString,
  getDelegationClient,
  parseAmount,
  parseFlags,
  requireStringFlag,
} from "../lib/cli-helpers.js";

export async function cmdUser(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "create":
      await cmdUserCreate(rest);
      break;
    case "get":
      await cmdUserGet(rest);
      break;
    case "attach-card":
      await cmdUserAttachCard(rest);
      break;
    case "attach-wallet":
      await cmdUserAttachWallet(rest);
      break;
    case "set-limits":
      await cmdUserSetLimits(rest);
      break;
    case "status":
      await cmdUserStatus(rest);
      break;
    case undefined:
    case "--help":
    case "-h":
      printUserUsage();
      break;
    default:
      console.error(`payagent user: unknown subcommand \`${sub}\``);
      printUserUsage();
      process.exit(1);
  }
}

async function cmdUserCreate(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const externalId = requireStringFlag(
    flags["external-id"] ?? flags.id ?? flags.e,
    "--external-id",
  );
  const email = typeof flags.email === "string" ? flags.email : undefined;
  const findOrCreate = flags["find-or-create"] === true;

  const client = getDelegationClient();
  const user = await client.createEndUser({ externalId, email, findOrCreate });

  console.log(`✓ End-user \`${externalId}\` ${findOrCreate ? "ensured" : "created"}.`);
  console.log(`  ArisPay id:   ${user.id}`);
  console.log(`  External id:  ${user.externalId}`);
  if (user.email) console.log(`  Email:        ${user.email}`);
  console.log(`  Has card:     ${user.hasPaymentMethod ? "yes" : "no"}`);
  console.log(`  Has wallet:   ${user.hasWallet ? "yes" : "no"}`);
}

async function cmdUserGet(args: string[]): Promise<void> {
  const [id] = args;
  if (!id) {
    console.error(
      "payagent user get: <user-id> (the ArisPay-internal id, not externalId) is required.",
    );
    process.exit(1);
  }
  const client = getDelegationClient();
  const user = await client.getEndUser(id);
  console.log(JSON.stringify(user, null, 2));
}

async function cmdUserAttachCard(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const userId = positional[0];
  if (!userId) {
    console.error("payagent user attach-card: <user-id> is required.");
    process.exit(1);
  }
  const agentId = typeof flags.agent === "string" ? flags.agent : undefined;
  const client = getDelegationClient();

  const session = await client.createCardSetupSession({ endUserId: userId, agentId });
  console.log(`Open this URL to enter the card for end-user \`${userId}\`:`);
  console.log("");
  console.log(`  ${session.setupUrl}`);
  console.log("");
  console.log(`  Expires at: ${session.expiresAt}`);
  console.log("");
  process.stdout.write("  Waiting for card setup to complete");

  const interval = setInterval(() => process.stdout.write("."), 3000);
  try {
    const result = await client.pollCardSetup(session.token, {
      intervalMs: 3000,
      timeoutMs: 15 * 60 * 1000,
    });
    process.stdout.write("\n");
    if (result.status === "completed") {
      const brand = result.cardBrand ?? "card";
      const last4 = result.cardLast4 ?? "????";
      console.log(`✓ Card attached: ${brand} ending ${last4}.`);
    } else {
      console.log(`Card setup ended with status: ${result.status}.`);
    }
  } finally {
    clearInterval(interval);
  }
}

async function cmdUserAttachWallet(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const userId = positional[0];
  if (!userId) {
    console.error("payagent user attach-wallet: <user-id> is required.");
    process.exit(1);
  }
  const walletAddress = requireStringFlag(flags.address ?? flags.wallet, "--address");
  const chain = requireStringFlag(flags.chain, "--chain") as WalletChain;
  const client = getDelegationClient();
  const result = await client.attachWallet(userId, { walletAddress, chain });
  console.log(`✓ Wallet attached to \`${userId}\`.`);
  console.log(`  Wallet:    ${result.walletAddress}`);
  console.log(`  Chain:     ${result.chain}`);
  console.log(`  Spender:   ${result.spenderAddress}`);
  console.log(`  USDC:      ${result.usdcContractAddress}`);
  console.log("");
  console.log(
    `  The end-user must approve ${result.spenderAddress} to spend USDC on their behalf.`,
  );
  console.log(`  Use \`payagent user status ${userId}\` to check allowance / readiness.`);
}

async function cmdUserSetLimits(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const userId = positional[0];
  if (!userId) {
    console.error("payagent user set-limits: <user-id> is required.");
    process.exit(1);
  }
  const agentName = requireStringFlag(flags.agent, "--agent");
  const stored = getAgent(agentName);
  if (!stored) {
    console.error(`No locally-stored agent named \`${agentName}\`. Use \`payagent agent list\`.`);
    process.exit(1);
  }
  const perTx =
    flags["per-tx"] !== undefined ? parseAmount(flags["per-tx"], "--per-tx") : undefined;
  const daily = flags.daily !== undefined ? parseAmount(flags.daily, "--daily") : undefined;
  const monthly = flags.monthly !== undefined ? parseAmount(flags.monthly, "--monthly") : undefined;
  const allowedMcc =
    typeof flags["allowed-mcc"] === "string"
      ? flags["allowed-mcc"]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  const blockedMcc =
    typeof flags["blocked-mcc"] === "string"
      ? flags["blocked-mcc"]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

  const client = getDelegationClient();
  const limit = await client.setUserLimits(userId, {
    agentId: stored.agentId,
    maxPerTransaction: perTx ?? null,
    maxDaily: daily ?? null,
    maxMonthly: monthly ?? null,
    allowedMerchantCategories: allowedMcc,
    blockedMerchantCategories: blockedMcc,
  });
  console.log(`✓ Limits set for end-user \`${userId}\` on agent \`${agentName}\`.`);
  console.log(
    `  Per-tx: ${limit.maxPerTransaction !== null ? formatCents(limit.maxPerTransaction) : "inherit"}, ` +
      `daily: ${limit.maxDaily !== null ? formatCents(limit.maxDaily) : "inherit"}, ` +
      `monthly: ${limit.maxMonthly !== null ? formatCents(limit.maxMonthly) : "inherit"}`,
  );
  if (limit.allowedMCCs.length) console.log(`  Allowed MCC: ${limit.allowedMCCs.join(", ")}`);
  if (limit.blockedMCCs.length) console.log(`  Blocked MCC: ${limit.blockedMCCs.join(", ")}`);
}

async function cmdUserStatus(args: string[]): Promise<void> {
  const [userId] = args;
  if (!userId) {
    console.error("payagent user status: <user-id> is required.");
    process.exit(1);
  }
  const client = getDelegationClient();
  // Pull basic info first. If the user has a wallet attached we follow up
  // with wallet-status; card-only users don't have that endpoint available.
  const user = await client.getEndUser(userId);
  console.log(`${user.externalId} (${user.id})`);
  if (user.email) console.log(`  email:        ${user.email}`);
  console.log(
    `  card:         ${user.hasPaymentMethod ? `${user.cardBrand ?? "card"} …${user.cardLast4 ?? "????"}` : "—"}`,
  );
  console.log(
    `  wallet:       ${user.walletAddress ?? "—"}${user.walletChain ? ` on ${user.walletChain}` : ""}`,
  );

  if (user.hasWallet) {
    try {
      const w = await client.getWalletStatus(userId);
      const balance = formatUsdcString(w.usdcBalance);
      const allowance = formatUsdcString(w.usdcAllowance);
      console.log(`  balance:      ${balance} USDC`);
      console.log(
        `  allowance:    ${allowance} USDC (${w.allowanceSufficient ? "sufficient" : "insufficient"})`,
      );
      console.log(`  ready:        ${w.ready}`);
      console.log(`  spender:      ${w.spenderAddress}`);
    } catch (err) {
      console.log(
        `  wallet-status unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function printUserUsage(): void {
  console.log("payagent user <subcommand>");
  console.log("");
  console.log("  create        --external-id X [--email X] [--find-or-create]");
  console.log("  get           USER_ID");
  console.log("  attach-card   USER_ID [--agent AGENT_ID]");
  console.log("  attach-wallet USER_ID --address 0x... --chain base|ethereum|polygon|solana");
  console.log("  set-limits    USER_ID --agent NAME [--per-tx N] [--daily N] [--monthly N]");
  console.log("                        [--allowed-mcc 5411,5812] [--blocked-mcc 7995]");
  console.log("  status        USER_ID");
}
