/* eslint-disable no-console */
/**
 * `agentmarketplace publish [path=./agent.json]` — push a manifest to
 * the marketplace. Scaffolds a minimal `agent.json` interactively when
 * one isn't found and stdin is a TTY. Pre-flights the endpoint with a
 * HEAD request before publishing — paid x402 listings must respond 402;
 * everything else must respond at all. `--force` skips the pre-flight.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseManifest } from "../index.js";
import {
  formatListing,
  getClient,
  listingWebUrl,
  parseFlags,
  prompt,
  promptYesNo,
} from "../lib/cli-helpers.js";

async function scaffoldManifest(targetPath: string): Promise<void> {
  console.log("No agent.json found. Let's scaffold one.\n");
  const slug = (await prompt("Slug (e.g. yourname/cool-agent): ")).trim();
  if (!slug) {
    console.error("Slug is required.");
    process.exit(1);
  }
  const name = (await prompt(`Display name [${slug}]: `)).trim() || slug;
  const description = (await prompt("Short description (one line): ")).trim();

  console.log("\nTransport:");
  console.log("  1. http-x402  — paid HTTP endpoint (settles via ArisPay)");
  console.log("  2. http       — free HTTP endpoint");
  console.log("  3. mcp-http   — remote MCP server over HTTP");
  console.log("  4. mcp-stdio  — local MCP server (npx / docker / binary)");
  const tAns = (await prompt("Choice [1]: ")).trim() || "1";
  const transport =
    tAns === "2" ? "http" : tAns === "3" ? "mcp-http" : tAns === "4" ? "mcp-stdio" : "http-x402";

  const endpoint: Record<string, unknown> = { transport };
  if (transport === "mcp-stdio") {
    endpoint.command = (await prompt("Command (e.g. npx): ")).trim();
    const argsRaw = (await prompt("Args (space-separated, optional): ")).trim();
    endpoint.args = argsRaw ? argsRaw.split(/\s+/) : [];
  } else {
    endpoint.url = (await prompt("Endpoint URL (https://...): ")).trim();
  }

  let pricing: Record<string, unknown> | undefined;
  if (transport === "http-x402") {
    const priceCentsRaw = (await prompt("Price in cents [1]: ")).trim() || "1";
    const priceCents = Number.parseInt(priceCentsRaw, 10);
    if (!Number.isFinite(priceCents) || priceCents < 1) {
      console.error("Price must be a positive integer number of cents.");
      process.exit(1);
    }
    pricing = { model: "x402", amount: priceCents, currency: "USD", per: "call" };
  } else if (transport === "http" || transport === "mcp-http" || transport === "mcp-stdio") {
    pricing = { model: "free" };
  }

  const tagsRaw = (await prompt("Tags (comma-separated, optional): ")).trim();
  const tags = tagsRaw
    ? tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const manifest = {
    slug,
    name,
    description: description || undefined,
    tags,
    endpoint,
    pricing,
  };
  writeFileSync(targetPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n✓ wrote ${targetPath}`);
  console.log("Review the file and re-run `agentmarketplace publish` when ready.");
}

async function preflightEndpoint(
  url: string,
  expectX402: boolean,
): Promise<{ ok: boolean; reason?: string }> {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 5_000);
  try {
    const res = await fetch(url, { method: "HEAD", signal: ctl.signal, redirect: "follow" });
    if (expectX402) {
      if (res.status === 402) return { ok: true };
      return { ok: false, reason: `expected HTTP 402, got ${res.status}` };
    }
    if (res.status >= 200 && res.status < 500) return { ok: true };
    return { ok: false, reason: `got HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function cmdPublish(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const manifestPath = resolve(process.cwd(), positional[0] ?? "agent.json");

  if (!existsSync(manifestPath)) {
    if (!process.stdin.isTTY) {
      console.error(`Manifest not found: ${manifestPath}`);
      process.exit(1);
    }
    const create = await promptYesNo(`No agent.json at ${manifestPath}. Create one now?`, true);
    if (!create) process.exit(1);
    await scaffoldManifest(manifestPath);
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    console.error(`Invalid JSON: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  let manifest;
  try {
    manifest = parseManifest(raw);
  } catch (err) {
    console.error(`Invalid manifest: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Endpoint preflight — HEAD the URL before uploading. Paid x402 listings
  // must return 402; everything else must respond at all. --force skips.
  const force = flags.force === "true";
  const url = manifest.endpoint.url;
  if (url && !force) {
    const expectX402 = manifest.pricing?.model === "x402";
    const probe = await preflightEndpoint(url, expectX402);
    if (!probe.ok) {
      console.error(`Endpoint preflight failed: ${url}`);
      console.error(`  reason: ${probe.reason}`);
      if (expectX402) {
        console.error("Paid x402 listings must return HTTP 402 before payment.");
      }
      console.error("Re-run with --force to publish anyway.");
      process.exit(1);
    }
  }

  const client = getClient(true);
  const published = await client.publish(manifest);
  console.log(`Published ${published.slug}`);
  console.log(formatListing(published));
  console.log("");
  console.log(`Public URL: ${listingWebUrl(published.slug)}`);
  console.log("");
  console.log("Test the paid call flow (creates an agent + tops up if needed):");
  console.log(`  agentmarketplace try ${published.slug}`);
}
