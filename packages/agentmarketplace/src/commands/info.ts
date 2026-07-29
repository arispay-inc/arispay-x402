/* eslint-disable no-console */
/** `agentmarketplace info <slug>` — full manifest + README. */
import { formatListing, getClient } from "../lib/cli-helpers.js";

export async function cmdInfo(args: string[]): Promise<void> {
  const [slug] = args;
  if (!slug) {
    console.error("Usage: agentmarketplace info <slug>");
    process.exit(1);
  }
  const client = getClient();
  const a = await client.get(slug);
  if (!a) {
    console.error(`Not found: ${slug}`);
    process.exit(1);
  }
  console.log(formatListing(a));
  if (a.readme) {
    console.log("\n--- README ---\n");
    console.log(a.readme);
  }
}
