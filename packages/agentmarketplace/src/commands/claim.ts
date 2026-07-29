/* eslint-disable no-console */
/**
 * `agentmarketplace claim <slug>` — well-known claim flow for an
 * unclaimed listing. Prints the SHA-256 of the developer key and the
 * `/.well-known/arispay-claim.txt` URL, then verifies once the file is
 * up.
 */
import {
  getClient,
  listingWebUrl,
  loadConfig,
  parseFlags,
  promptYesNo,
} from "../lib/cli-helpers.js";

export async function cmdClaim(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const [slug] = positional;
  if (!slug) {
    console.error("Usage: agentmarketplace claim <slug>");
    process.exit(1);
  }

  const cfg = loadConfig();
  const devKey = cfg.developerKey ?? cfg.apiKey;
  if (!devKey || !/^ap_(live|test)_/.test(devKey)) {
    console.error("claim requires a developer key (ap_live_ / ap_test_).");
    console.error(
      "Run `agentmarketplace merchant signup` or `agentmarketplace login <ap_live_...>`.",
    );
    process.exit(1);
  }

  const client = getClient();
  const listing = await client.get(slug);
  if (!listing) {
    console.error(`Not found: ${slug}`);
    process.exit(1);
  }
  if (!listing.homepage) {
    console.error("Listing has no homepage URL — well-known claim requires one.");
    console.error("Ask the marketplace admins to add a homepage to this listing first.");
    process.exit(1);
  }

  const crypto = await import("node:crypto");
  const claimToken = crypto.createHash("sha256").update(devKey).digest("hex");
  const wellKnownUrl = `${listing.homepage.replace(/\/+$/, "")}/.well-known/arispay-claim.txt`;

  console.log("");
  console.log(`To claim ${listing.slug}, serve this token at:`);
  console.log("");
  console.log(`  ${wellKnownUrl}`);
  console.log("");
  console.log("Token contents (single line, plain text):");
  console.log("");
  console.log(`  ${claimToken}`);
  console.log("");

  if (flags["dry-run"] === "true") return;

  const ok = await promptYesNo("Have you uploaded the file? Attempt verification now?", true);
  if (!ok) {
    console.log("Cancelled. Re-run when the file is live.");
    return;
  }

  const arispayUrl = (
    process.env.AGENTMARKETPLACE_URL ??
    cfg.baseUrl ??
    "https://api.arispay.app/v1/marketplace"
  ).replace(/\/$/, "");
  const res = await fetch(`${arispayUrl}/agents/${encodeURIComponent(slug)}/claim`, {
    method: "POST",
    headers: { authorization: `Bearer ${devKey}`, "content-type": "application/json" },
    body: JSON.stringify({ method: "well-known" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Claim failed: ${res.status} ${body}`);
    process.exit(1);
  }
  const data = (await res.json()) as {
    claim: { verified: boolean; verifiedAt?: string };
    listing?: { claimed: boolean };
  };
  if (data.claim.verified) {
    console.log(`✓ Verified. ${listing.slug} is now yours.`);
    console.log(`  view: ${listingWebUrl(listing.slug)}`);
  } else {
    console.log("Claim recorded but not yet verified.");
  }
}
