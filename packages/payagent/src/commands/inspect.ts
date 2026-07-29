/* eslint-disable no-console */
/**
 * `payagent inspect <url>` — read-only x402 challenge inspection.
 *
 * Fetches the URL with NO payment header and NO auth, expecting HTTP 402,
 * and prints the parsed challenge: price, asset, network, payTo. Never
 * pays. When the challenge body names a facilitator, it is shown as the
 * "server-declared facilitator" — the SERVER chose it; the payer never
 * calls or replaces it.
 *
 * Money rule: amounts show base units AND the integer-cents conversion
 * (6-decimal assets: baseUnits / 10^4 = cents), formatted `$/€` only at
 * the display edge. Never floats.
 */
import { InspectParseError, inspectChallenge } from "../inspect.js";
import { formatMoneyCents, parseFlags, stderrLine } from "../lib/cli-helpers.js";

export async function cmdInspect(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const url = positional[0];
  if (!url) {
    stderrLine("payagent inspect: <url> is required.");
    process.exit(1);
  }

  let result: Awaited<ReturnType<typeof inspectChallenge>>;
  try {
    result = await inspectChallenge(url);
  } catch (err) {
    if (err instanceof InspectParseError) {
      stderrLine(`payagent inspect: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  if (!result.gated) {
    stderrLine(
      `payagent inspect: ${url} does not appear to be x402-gated (got HTTP ${result.status}, expected 402).`,
    );
    process.exit(1);
  }

  if (flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Resource:  ${url}`);
  if (result.x402Version !== undefined) console.log(`x402:      v${result.x402Version}`);
  for (const accept of result.accepts) {
    console.log("");
    console.log(`  Scheme:   ${accept.scheme}`);
    console.log(`  Network:  ${accept.network}`);
    console.log(`  Asset:    ${accept.asset}${accept.assetName ? ` (${accept.assetName})` : ""}`);
    console.log(`  Amount:   ${formatAmount(accept.amountBaseUnits, accept.amountCents, accept.currency)}`);
    console.log(`  Pay to:   ${accept.payTo}`);
    if (accept.resource) console.log(`  Resource: ${accept.resource}`);
    if (accept.description) console.log(`  About:    ${accept.description}`);
    if (accept.mimeType) console.log(`  Type:     ${accept.mimeType}`);
  }
  if (result.serverDeclaredFacilitator) {
    console.log("");
    console.log(`  Server-declared facilitator: ${result.serverDeclaredFacilitator}`);
    console.log("  (The server settles through this facilitator — its choice, not yours.)");
  }
  console.log("");
  console.log(`No payment was sent. Pay with: npx payagent pay ${url}`);
}

/** Base units always; integer cents + `$X.YY`/`€X.YY` when they divide cleanly. */
function formatAmount(baseUnits: string, cents: number | undefined, currency?: string): string {
  if (cents === undefined) return `${baseUnits} base units`;
  return `${baseUnits} base units = ${cents}¢ (${formatMoneyCents(cents, currency)})`;
}
