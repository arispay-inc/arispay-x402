/* eslint-disable no-console */
/** `agentmarketplace search [query] [--tag=X --capability=X --transport=X --publisher=X --limit=N]` */
import { formatListing, getClient, parseFlags } from "../lib/cli-helpers.js";

export async function cmdSearch(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const q = positional.join(" ").trim() || undefined;
  const client = getClient();
  const result = await client.search({
    q,
    tag: flags.tag,
    capability: flags.capability,
    transport: flags.transport as never,
    publisher: flags.publisher,
    limit: flags.limit ? Number.parseInt(flags.limit, 10) : undefined,
  });
  if (result.agents.length === 0) {
    console.log("No agents found.");
    return;
  }
  for (const a of result.agents) {
    console.log(formatListing(a));
    console.log();
  }
  if (result.nextCursor) console.log(`— more results available (cursor: ${result.nextCursor})`);
}
