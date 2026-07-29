/* eslint-disable no-console */
/**
 * `payagent pay-merchant URL --amount $N --memo "..."` — multi-rail
 * merchant payment via /v1/payments. Rail is server-picked unless
 * overridden. For x402 API calls, use `payagent pay` instead.
 */
import { getAgent, listAgents } from "../config-store.js";
import {
  formatCents,
  getDelegationClient,
  parseAmount,
  parseFlags,
  requireStringFlag,
} from "../lib/cli-helpers.js";

export async function cmdPayMerchant(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const merchantUrl = positional[0];
  if (!merchantUrl) {
    console.error("payagent pay-merchant: <url> is required.");
    process.exit(1);
  }
  const agentName = typeof flags.agent === "string" ? flags.agent : listAgents()[0]?.name;
  if (!agentName) {
    console.error(
      "payagent pay-merchant: no agents stored. Create one with `payagent agent create`.",
    );
    process.exit(1);
  }
  const stored = getAgent(agentName);
  if (!stored) {
    console.error(`payagent pay-merchant: agent \`${agentName}\` not found.`);
    process.exit(1);
  }

  const amount = parseAmount(flags.amount, "--amount");
  const memo = requireStringFlag(flags.memo ?? flags.m, "--memo");
  const userId = typeof flags.user === "string" ? flags.user : undefined;
  const rail =
    typeof flags.rail === "string"
      ? (flags.rail as "card" | "crypto" | "balance" | "mpp")
      : undefined;
  const merchantName =
    typeof flags["merchant-name"] === "string" ? flags["merchant-name"] : undefined;
  const mcc = typeof flags.mcc === "string" ? flags.mcc : undefined;
  // Optional PayGate-registered merchant id (`mer_...`). When set, the API
  // applies the merchant's trust-tier floor and (for Clover-connected
  // merchants) fires the post-capture order mirror.
  const merchantId = typeof flags["merchant-id"] === "string" ? flags["merchant-id"] : undefined;

  const client = getDelegationClient();
  const payment = await client.createPayment(stored.agentId, {
    amount,
    memo,
    merchantUrl,
    merchantName,
    merchantCategoryCode: mcc,
    merchantId,
    userId,
    rail,
  });

  console.log(`Payment: ${payment.id}`);
  console.log(`  Status: ${payment.status}`);
  console.log(`  Rail:   ${payment.rail}`);
  console.log(`  Amount: ${formatCents(payment.amount)} ${payment.currency}`);
  if (payment.merchantName) console.log(`  Merchant: ${payment.merchantName}`);
  if (payment.txHash) console.log(`  Tx hash: ${payment.txHash}`);
  if (payment.nextAction) {
    console.log(`  Next action: ${payment.nextAction.type}`);
    if (payment.nextAction.challengeUrl) {
      console.log(`  3DS challenge URL: ${payment.nextAction.challengeUrl}`);
    }
  }
  if (payment.error) {
    console.log(`  Error: ${payment.error.code} — ${payment.error.message}`);
  }
}
