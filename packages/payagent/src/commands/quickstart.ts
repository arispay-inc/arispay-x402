import { bootstrapAgent } from "../bootstrap.js";
/* eslint-disable no-console */
/**
 * `payagent quickstart` (alias `bootstrap`) — headless one-shot:
 * creates an account + agent + wallet without a browser, optionally
 * with a Coinbase Onramp URL pre-minted for funding.
 */
import { getArispayUrl, getConfigPath } from "../config-store.js";
import { formatCents, maybePrintQr, parseAmountFlag, parseFlags } from "../lib/cli-helpers.js";
import { isInteractive, prompt, validateEmail } from "../prompts.js";

export async function cmdQuickstart(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const arispayUrl = getArispayUrl();

  // Email comes from --email or first positional. If neither, and we
  // have a TTY, prompt. In CI/pipes, fail with a useful hint.
  let email = (typeof flags.email === "string" && flags.email) || positional[0];
  if (!email) {
    if (isInteractive()) {
      email = await prompt("Email", { validate: validateEmail });
    } else {
      console.error(
        "payagent: --email is required (e.g. `payagent quickstart --email you@example.com --name polar`).",
      );
      process.exit(1);
    }
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`payagent: \`${email}\` does not look like a valid email.`);
    process.exit(1);
  }

  const name = typeof flags.name === "string" && flags.name ? flags.name : undefined;
  const orgName =
    typeof flags["org-name"] === "string" && flags["org-name"] ? flags["org-name"] : undefined;
  const agentName =
    typeof flags["agent-name"] === "string" && flags["agent-name"]
      ? flags["agent-name"]
      : (typeof flags.agent === "string" && flags.agent) || undefined;
  const fundRaw = flags.fund;
  const fund =
    typeof fundRaw === "string" ? Number(fundRaw.replace(/[$,]/g, "").trim()) : undefined;
  if (fundRaw !== undefined && (fund === undefined || !Number.isFinite(fund) || fund <= 0)) {
    console.error("payagent: --fund must be a positive USD amount (e.g. 25, 25.00).");
    process.exit(1);
  }

  const perTxCents = parseAmountFlag(flags["per-tx"] ?? flags.t);
  const dailyCents = parseAmountFlag(flags.daily ?? flags.d);
  const monthlyCents = parseAmountFlag(flags.monthly ?? flags.m);

  const domains =
    typeof flags.domains === "string"
      ? flags.domains
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

  console.log(`Authenticating against ${arispayUrl}…`);

  const agent = await bootstrapAgent({
    email,
    name,
    orgName,
    agentName,
    limits: {
      perTx: perTxCents,
      daily: dailyCents,
      monthly: monthlyCents,
    },
    allowedDomains: domains,
    fund,
    arispayUrl: process.env.ARISPAY_URL,
    clientId: "payagent-cli-quickstart",
  });

  console.log("");
  console.log(`✓ Account:  ${agent.email}  (org \`${agent.orgName}\`)`);
  console.log(`✓ Agent:    ${agent.agentName}  (${agent.agentId})`);
  console.log(`  Wallet:   ${agent.walletAddress}  (${agent.network})`);
  console.log(
    `  Limits:   ${formatCents(agent.limits.perTx)} / tx, ${formatCents(agent.limits.daily)} / day, ${formatCents(agent.limits.monthly)} / month`,
  );
  console.log(`  Config:   ${getConfigPath()}`);
  console.log("");
  if (agent.fundingUrl) {
    console.log("Fund this wallet via Coinbase Onramp:");
    console.log("");
    console.log(`  ${agent.fundingUrl}`);
    console.log("");
    if (agent.fundingExpiresAt) console.log(`  URL valid until: ${agent.fundingExpiresAt}`);
    console.log(`  Or send USDC on ${agent.network} directly to ${agent.walletAddress}`);
  } else {
    if (agent.fundingUrlError) {
      console.log(`Onramp not available (${agent.fundingUrlError}).`);
      console.log("");
    }
    console.log("Fund this wallet to start paying:");
    console.log(`  → Send USDC on ${agent.network} to ${agent.walletAddress}`);
    console.log(
      `  → Or run \`payagent agent fund ${agent.agentName} --hosted\` to mint a Coinbase Onramp URL.`,
    );
  }
  // Phone-pairing handoff. When the API returns a `pairing` block, the
  // user can scan the QR (or open the URL) on their phone and land in
  // the BuyForMe PWA already signed in — no email retype. Print
  // alongside the funding info so the user sees both options.
  if (agent.pairing) {
    console.log("");
    console.log("Open BuyForMe on your phone:");
    console.log("");
    await maybePrintQr(agent.pairing.url);
    console.log("");
    console.log(`  ${agent.pairing.url}`);
    console.log(`  Link expires: ${agent.pairing.expiresAt}`);
  }

  console.log("");
  console.log("Then:  payagent pay https://api.example.com/premium");
}
