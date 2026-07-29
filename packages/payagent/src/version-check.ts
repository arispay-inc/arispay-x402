/**
 * Best-effort version-staleness nudge.
 *
 * Compares the running CLI's version against `npm view payagent version`
 * and prints a one-line warning when the user is behind. Runs out-of-band
 * with a tight timeout so a slow npm registry never blocks the CLI.
 *
 * Two thresholds:
 *   - >= 1 major behind: hard warning to stderr.
 *   - >= 2 minors behind on the same major: soft suggestion.
 *
 * Opt out via `PAYAGENT_NO_UPDATE_CHECK=1` (CI, scripts).
 */

const REGISTRY_TIMEOUT_MS = 1500;

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

function parseVersion(raw: string): ParsedVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

interface NpmRegistryResponse {
  "dist-tags"?: { latest?: string };
}

async function fetchLatest(packageName: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
  try {
    const res = await fetch(`https://registry.npmjs.org/${packageName}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as NpmRegistryResponse;
    return body["dist-tags"]?.latest;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check if `current` is significantly behind the published latest.
 * Returns one of `'major' | 'minor' | 'fresh' | 'unknown'`.
 *
 * Pure helper, easy to unit-test by stubbing `latest`.
 */
export function classifyStaleness(
  current: string,
  latest: string | undefined,
): "major" | "minor" | "fresh" | "unknown" {
  const cur = parseVersion(current);
  const lat = latest ? parseVersion(latest) : undefined;
  if (!cur || !lat) return "unknown";
  if (lat.major > cur.major) return "major";
  if (lat.major === cur.major && lat.minor - cur.minor >= 2) return "minor";
  return "fresh";
}

/**
 * Print a one-line nudge to stderr if the running CLI is behind. Never throws,
 * never blocks for more than `REGISTRY_TIMEOUT_MS`. Honors
 * `PAYAGENT_NO_UPDATE_CHECK=1`.
 */
export async function maybePrintStalenessNudge(
  packageName: string,
  current: string,
): Promise<void> {
  if (process.env.PAYAGENT_NO_UPDATE_CHECK === "1") return;
  if (!current || current.startsWith("0.0.0")) return; // dev / unbundled
  const latest = await fetchLatest(packageName);
  const verdict = classifyStaleness(current, latest);
  if (verdict === "major") {
    process.stderr.write(
      `payagent: you are on ${packageName}@${current}; latest is ${latest}. ` +
        `Run \`npm install -g ${packageName}@latest\` — older majors may not work against the live API.\n`,
    );
  } else if (verdict === "minor") {
    process.stderr.write(
      `payagent: ${packageName}@${current} is more than two minor versions behind ${latest}. ` +
        `Consider \`npm install -g ${packageName}@latest\`.\n`,
    );
  }
}
