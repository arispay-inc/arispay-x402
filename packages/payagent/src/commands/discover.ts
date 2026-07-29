/* eslint-disable no-console */
/**
 * `payagent discover "<query>"` — read-only marketplace catalog search.
 *
 * Wraps the SDK's `discover()` (`POST /v1/marketplace/discover` — public,
 * unauthenticated). Costs nothing, pays nothing, needs no API key. Prints
 * ranked candidates with endpoint URL and price so the user (or an agent)
 * can follow up with `payagent pay <url>` or `payagent inspect <url>`.
 *
 * Money rule: budgets and prices are integer cents in data; `$X.YY` / `€X.YY`
 * formatting happens only at the display edge.
 */
import {
  type DiscoverCandidate,
  type DiscoverCategory,
  type DiscoverInput,
  type DiscoverTransport,
  discover,
} from "../discover.js";
import { formatMoneyCents, parseFlags, stderrLine } from "../lib/cli-helpers.js";

export async function cmdDiscover(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const query = positional.join(" ").trim();
  if (!query) {
    stderrLine('payagent discover: a query is required, e.g. `payagent discover "flight search"`.');
    process.exit(1);
  }

  const input: DiscoverInput = { intent: query };

  const budgetRaw = flags.budget;
  if (budgetRaw !== undefined) {
    // Budget is integer CENTS on the wire — reject floats/dollars outright
    // rather than guess which unit the user meant.
    if (typeof budgetRaw !== "string" || !/^\d+$/.test(budgetRaw)) {
      stderrLine(
        `payagent discover: --budget must be an integer number of cents (e.g. --budget 500 for $5.00). Got \`${String(budgetRaw)}\`.`,
      );
      process.exit(1);
    }
    input.budgetCentsMax = Number(budgetRaw);
  }

  if (typeof flags.category === "string") input.category = flags.category as DiscoverCategory;
  if (typeof flags.transport === "string") input.transport = flags.transport as DiscoverTransport;
  if (flags.limit !== undefined) {
    if (typeof flags.limit !== "string" || !/^\d+$/.test(flags.limit)) {
      stderrLine(`payagent discover: --limit must be a positive integer. Got \`${String(flags.limit)}\`.`);
      process.exit(1);
    }
    input.limit = Number(flags.limit);
  }

  const { candidates } = await discover(input);

  if (flags.json === true) {
    console.log(JSON.stringify(candidates, null, 2));
    return;
  }

  if (candidates.length === 0) {
    console.log(`No paid APIs matched "${query}".`);
    console.log("Try a broader query, drop --category/--transport, or raise --budget.");
    return;
  }

  candidates.forEach((c, i) => {
    console.log(`${i + 1}. ${c.name}  [${formatCandidatePrice(c)}]`);
    if (c.endpoint.url) console.log(`   ${c.endpoint.url}`);
    console.log(`   ${formatCandidateFlags(c)}`);
  });
  console.log("");
  console.log("Pay one with: npx payagent pay <url>");
}

/** Display-edge price line. Data stays integer cents. */
function formatCandidatePrice(c: DiscoverCandidate): string {
  const p = c.pricing;
  if (!p || p.model === "free") return "free";
  if (typeof p.amount === "number" && Number.isInteger(p.amount)) {
    const per = p.per ? `/${p.per}` : "";
    return `${formatMoneyCents(p.amount, p.currency)}${per} (${p.amount}¢, ${p.model})`;
  }
  return p.model;
}

function formatCandidateFlags(c: DiscoverCandidate): string {
  const parts: string[] = [];
  parts.push(c.healthy === false ? "unhealthy" : "healthy");
  parts.push(c.verified ? "verified" : "unverified");
  if (c.source) parts.push(`source: ${c.source}`);
  return parts.join(" · ");
}
