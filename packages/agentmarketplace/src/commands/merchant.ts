/* eslint-disable no-console */
/**
 * `agentmarketplace merchant signup` — create a publisher account
 * without a dashboard. Returns a developer (`ap_live_`) key + merchant
 * id and persists them so subsequent `publish` / `claim` work.
 */
import { WEB_URL, loadConfig, parseFlags, prompt, saveConfig } from "../lib/cli-helpers.js";

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function cmdMerchant(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (sub === "signup") {
    await cmdMerchantSignup(rest);
    return;
  }
  console.error("Usage: agentmarketplace merchant signup [--email=... --name=... --payout=0x...]");
  process.exit(1);
}

async function cmdMerchantSignup(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);

  const email = (flags.email ?? (await prompt("Email: "))).toLowerCase().trim();
  if (!EMAIL_RE.test(email)) {
    console.error("Invalid email.");
    process.exit(1);
  }

  const merchantName = (
    flags.name ?? (await prompt("Merchant name (shown on your public listings): "))
  ).trim();
  if (!merchantName || merchantName.length < 2) {
    console.error("Merchant name required (min 2 chars).");
    process.exit(1);
  }

  const payoutAddress = (
    flags.payout ?? (await prompt("Payout wallet address (Base-compatible EVM, 0x...): "))
  ).trim();
  if (!EVM_ADDRESS_RE.test(payoutAddress)) {
    console.error("Invalid payout address — must be a 0x-prefixed 40-char hex EVM address.");
    process.exit(1);
  }

  const apiBase = process.env.ARISPAY_URL ?? "https://api.arispay.app";
  const res = await fetch(`${apiBase}/v1/merchants/signup-cli`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, merchantName, payoutAddress }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Signup failed: ${res.status} ${body}`);
    process.exit(1);
  }

  const data = (await res.json()) as {
    developerKey: string;
    verificationUrl?: string;
    verified: boolean;
    merchantId: string;
    merchantName: string;
  };

  const cfg = loadConfig();
  cfg.developerKey = data.developerKey;
  cfg.merchantId = data.merchantId;
  // Only overwrite apiKey if the user has no other key — don't clobber an
  // agent-scoped key the user already logged in with.
  if (!cfg.apiKey) cfg.apiKey = data.developerKey;
  saveConfig(cfg);

  console.log("");
  console.log("✓ Publisher account created");
  console.log("");
  console.log(`  merchant:     ${data.merchantName}`);
  console.log(`  merchantId:   ${data.merchantId}`);
  console.log(`  payout:       ${payoutAddress}`);
  console.log(`  profile:      ${WEB_URL}/m/${data.merchantId}`);
  console.log(`  verified:     ${data.verified ? "yes" : "no (check your inbox)"}`);
  console.log("");
  console.log("Developer key (returned once — stored at ~/.agentmarketplace/config.json):");
  console.log("");
  console.log(`  ${data.developerKey}`);
  console.log("");

  if (data.verificationUrl) {
    console.log("Verification link (also emailed to you):");
    console.log(`  ${data.verificationUrl}`);
    console.log("");
    console.log("Listings stay hidden from public search until verification completes.");
  }

  console.log("");
  console.log("Next steps:");
  console.log("  1. Click the link in your email to verify.");
  console.log("  2. Draft your listing:      agentmarketplace publish     # scaffolds agent.json");
  console.log("  3. Pay for your own listing: agentmarketplace try <slug> # one-command flow");
}
