/**
 * Pure helper — turn `payagent pay <url>` flags into a launch config.
 *
 * Isolated from `cli.ts` so tests can exercise the derivation without
 * triggering the CLI `main()`. Name resolution order:
 *
 *   1. `--agent <name>` flag
 *   2. first stored agent (lowest createdAt) if any
 *   3. literal `default`
 *
 * Default limits: $5 per-tx, $20 per-day, $100 per-month, on Base mainnet,
 * with `allowedDomains` seeded from the URL's hostname. Each can be
 * overridden via `--per-tx`, `--daily`, `--monthly`, `--network`, `--domains`.
 */

export type DerivedPayDefaults =
  | {
      ok: true;
      name: string;
      perTx: number;
      daily: number;
      monthly: number;
      network: "base" | "base-sepolia" | "ethereum" | "polygon";
      allowedDomains: string[];
    }
  | { ok: false; error: string };

export function derivePayDefaults(
  urlStr: string,
  flags: Record<string, string | boolean>,
  firstStoredAgentName?: string,
): DerivedPayDefaults {
  const explicitName = typeof flags.agent === "string" ? flags.agent : undefined;
  const name = explicitName ?? firstStoredAgentName ?? "default";

  let host: string;
  try {
    host = new URL(urlStr).hostname;
  } catch {
    return { ok: false, error: `payagent pay: \`${urlStr}\` is not a valid URL.` };
  }

  const domainsRaw = typeof flags.domains === "string" ? flags.domains : host;
  const allowedDomains = domainsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let perTx: number;
  let daily: number;
  let monthly: number;
  try {
    perTx = flags["per-tx"] !== undefined ? parseAmountCents(flags["per-tx"], "--per-tx") : 500;
    daily = flags.daily !== undefined ? parseAmountCents(flags.daily, "--daily") : 2000;
    monthly = flags.monthly !== undefined ? parseAmountCents(flags.monthly, "--monthly") : 10000;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const network = (typeof flags.network === "string" ? flags.network : "base") as
    | "base"
    | "base-sepolia"
    | "ethereum"
    | "polygon";

  return { ok: true, name, perTx, daily, monthly, network, allowedDomains };
}

/** Parse `"5"`, `"5.00"`, `"$5.00"` into 500 (cents). Throws on invalid input. */
export function parseAmountCents(raw: string | boolean | undefined, label: string): number {
  if (raw === undefined || raw === true || raw === false) {
    throw new Error(`payagent: ${label} is required.`);
  }
  const s = String(raw)
    .replace(/[$£€,]/g, "")
    .trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`payagent: ${label} must be a positive decimal (e.g. 5.00). Got \`${raw}\`.`);
  }
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(`${frac}00`.slice(0, 2));
  if (!Number.isFinite(cents) || cents < 0) {
    throw new Error(`payagent: ${label} must be a non-negative amount.`);
  }
  return cents;
}
