/* eslint-disable no-console */
/**
 * `agentmarketplace call <slug>` — invoke an http / http-x402 listing
 * and pay via ArisPay if it's a paid endpoint.
 */
import { payFetchDelegated } from "payagent";
import { getClient, loadConfig, parseFlags, promptYesNo } from "../lib/cli-helpers.js";

export async function cmdCall(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const [slug] = positional;
  if (!slug) {
    console.error(
      "Usage: agentmarketplace call <slug> [--method=GET] [--body=<string>] [--header=K:V ...]",
    );
    process.exit(1);
  }

  const cfg = loadConfig();
  const apiKey = process.env.ARISPAY_API_KEY ?? cfg.apiKey;

  const client = getClient();
  const listing = await client.get(slug);
  if (!listing) {
    console.error(`Not found: ${slug}`);
    process.exit(1);
  }

  // Only HTTP-shaped transports are callable via this command. MCP servers
  // are invoked through the user's MCP client, not through us.
  if (listing.endpoint.transport !== "http" && listing.endpoint.transport !== "http-x402") {
    console.error(
      `This listing is transport=${listing.endpoint.transport}, not callable via 'call'.`,
    );
    console.error(
      `MCP servers are invoked through your MCP client after 'agentmarketplace install'.`,
    );
    process.exit(1);
  }

  const url = listing.endpoint.url;
  if (!url) {
    console.error("Listing has no endpoint URL.");
    process.exit(1);
  }

  const method = (flags.method ?? "GET").toUpperCase();
  const body = flags.body ?? undefined;
  const headers: Record<string, string> = {};
  // Multiple --header=K:V flags would overwrite each other in our flag
  // parser; supporting a repeatable form would require richer parsing. For
  // v1, document a single header flag.
  if (flags.header) {
    const [k, ...rest] = flags.header.split(":");
    if (k && rest.length) headers[k.trim()] = rest.join(":").trim();
  }

  const isPaid = listing.pricing?.model === "x402";
  if (isPaid && !apiKey) {
    console.error("This endpoint is x402-priced and requires an ArisPay API key for settlement.");
    console.error("Run: agentmarketplace login ap_live_...");
    process.exit(1);
  }

  if (isPaid) {
    const priceBlurb =
      listing.pricing?.amount != null
        ? `${(listing.pricing.amount / 100).toFixed(2)} ${listing.pricing.currency ?? "USD"}${listing.pricing.per ? ` per ${listing.pricing.per}` : ""}`
        : "variable";
    console.log(`${listing.name} — x402 pricing: ${priceBlurb}`);
    if (!flags.yes) {
      const ok = await promptYesNo("Proceed with paid call?");
      if (!ok) {
        console.log("Cancelled.");
        return;
      }
    }
  }

  try {
    let res: Response;
    if (isPaid) {
      const arispayUrl = process.env.ARISPAY_URL ?? "https://api.arispay.app";
      const fetch402 = payFetchDelegated({ arispayUrl, apiKey: apiKey! });
      res = await fetch402(url, { method, body, headers });
    } else {
      res = await fetch(url, { method, body, headers });
    }
    const text = await res.text();
    console.log(`HTTP ${res.status} ${res.statusText}`);
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        console.log(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        console.log(text);
      }
    } else {
      console.log(text);
    }
  } catch (err) {
    console.error("call failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
