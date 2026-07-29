/* eslint-disable no-console */
/**
 * `agentmarketplace tool search [query]` — Phase-2 preview, tool-level
 * indexing across listings. Will eventually gain `tool call`. Hidden
 * from --help unless AGENTMARKETPLACE_EXPERIMENTAL=1.
 */
import { DEFAULT_BASE_URL, loadConfig, parseFlags } from "../lib/cli-helpers.js";

export async function cmdTool(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (sub !== "search") {
    console.error("Usage: agentmarketplace tool search [query] [--limit=N]");
    console.error("       agentmarketplace tool call <slug>/<tool>  (coming soon)");
    process.exit(1);
  }
  console.log(
    "[experimental] tool-level indexing is incomplete; expect empty results for most queries.",
  );
  const { positional, flags } = parseFlags(rest);
  const q = positional.join(" ").trim() || undefined;
  const cfg = loadConfig();
  const baseUrl = process.env.AGENTMARKETPLACE_URL ?? cfg.baseUrl ?? DEFAULT_BASE_URL;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (flags.limit) params.set("limit", flags.limit);
  const url = `${baseUrl}/tools${params.toString() ? `?${params}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`tool search failed: ${res.status}`);
    process.exit(1);
  }
  const body = (await res.json()) as {
    tools: Array<{
      name: string;
      description?: string;
      listingSlug: string;
      listingName: string;
    }>;
    nextCursor?: string;
  };
  if (body.tools.length === 0) {
    console.log("No tools found.");
    console.log("(Tool-level indexing is in progress — check back after the next crawl.)");
    return;
  }
  for (const t of body.tools) {
    console.log(`  ${t.listingName}/${t.name}`);
    console.log(`    slug:   ${t.listingSlug}/${t.name}`);
    if (t.description) console.log(`    ${t.description}`);
    console.log();
  }
  if (body.nextCursor) console.log("— more results available");
}
