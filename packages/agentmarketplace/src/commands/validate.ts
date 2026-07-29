/* eslint-disable no-console */
/**
 * `agentmarketplace validate <slug>` — actively probe a listing's
 * endpoint and verify it returns 402 + the right price.
 */
import { getClient } from "../lib/cli-helpers.js";

export async function cmdValidate(args: string[]): Promise<void> {
  const slug = args.find((a) => !a.startsWith("--"));
  if (!slug) {
    console.error("Usage: agentmarketplace validate <slug>");
    process.exit(1);
  }
  const client = getClient(false);
  const result = await client.validate(slug);
  if (result.healthy) {
    console.log(`✓ ${slug} validated at ${result.lastCheckedAt}`);
    if (result.observed) {
      const lines = ["  observed:"];
      if (result.observed.network) lines.push(`    network:  ${result.observed.network}`);
      if (result.observed.scheme) lines.push(`    scheme:   ${result.observed.scheme}`);
      if (result.observed.amount) lines.push(`    amount:   ${result.observed.amount} (atomic)`);
      console.log(lines.join("\n"));
    }
    return;
  }
  console.error(`✗ ${slug} unhealthy at ${result.lastCheckedAt}`);
  console.error(`  ${result.lastCheckError ?? "unknown reason"}`);
  process.exit(1);
}
