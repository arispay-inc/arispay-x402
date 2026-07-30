/**
 * `paygate doctor <url>` — read-only x402 seller readiness check.
 *
 * The network path is deliberately tiny: one GET, no auth, no payment
 * headers, redirects disabled. It can inspect a 402 challenge but cannot pay.
 */

const BASE_MAINNET_NETWORKS = new Set(["base", "eip155:8453"]);
const BASE_MAINNET_ASSETS = new Map([
  ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "USDC"],
  ["0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", "EURC"],
]);

export interface DoctorCheck {
  id: "unpaid-402" | "resource-url" | "x402-version" | "base-network" | "asset" | "bazaar";
  ok: boolean;
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  url: string;
  status?: number;
  checks: DoctorCheck[];
  error?: string;
}

interface DoctorIO {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

interface DoctorOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface ParsedChallenge {
  x402Version?: unknown;
  resource?: unknown;
  accepts?: unknown;
  extensions?: unknown;
}

function check(
  id: DoctorCheck["id"],
  ok: boolean,
  passMessage: string,
  failMessage: string,
): DoctorCheck {
  return { id, ok, message: ok ? passMessage : failMessage };
}

function parseHttpsUrl(value: unknown): URL | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function resourceUrlFrom(challenge: ParsedChallenge): string | undefined {
  if (typeof challenge.resource === "string") return challenge.resource;
  if (
    challenge.resource &&
    typeof challenge.resource === "object" &&
    typeof (challenge.resource as { url?: unknown }).url === "string"
  ) {
    return (challenge.resource as { url: string }).url;
  }
  return undefined;
}

function acceptsFrom(challenge: ParsedChallenge): Array<Record<string, unknown>> {
  if (!Array.isArray(challenge.accepts)) return [];
  return challenge.accepts.filter(
    (value): value is Record<string, unknown> => value !== null && typeof value === "object",
  );
}

function hasBazaarMetadata(challenge: ParsedChallenge): boolean {
  if (!challenge.extensions || typeof challenge.extensions !== "object") return false;
  const bazaar = (challenge.extensions as { bazaar?: unknown }).bazaar;
  if (!bazaar || typeof bazaar !== "object") return false;
  const info = (bazaar as { info?: unknown }).info;
  return Boolean(info && typeof info === "object" && Object.keys(info).length > 0);
}

function decodeChallengeHeader(value: string): unknown {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
}

export function validateDoctorChallenge(
  requestedUrl: string,
  status: number,
  body: unknown,
): DoctorReport {
  const challenge =
    body && typeof body === "object" ? (body as ParsedChallenge) : ({} as ParsedChallenge);
  const accepts = acceptsFrom(challenge);
  const baseAccepts = accepts.filter(
    (accept) =>
      typeof accept.network === "string" && BASE_MAINNET_NETWORKS.has(accept.network.toLowerCase()),
  );
  const supportedAssets = baseAccepts
    .map((accept) =>
      typeof accept.asset === "string"
        ? BASE_MAINNET_ASSETS.get(accept.asset.toLowerCase())
        : undefined,
    )
    .filter((asset): asset is string => Boolean(asset));
  const declaredResource = resourceUrlFrom(challenge);
  const declaredHttps = parseHttpsUrl(declaredResource);
  const requestedHttps = parseHttpsUrl(requestedUrl);

  const checks: DoctorCheck[] = [
    check(
      "unpaid-402",
      status === 402,
      "unpaid request returned HTTP 402",
      `expected unpaid HTTP 402, got ${status}`,
    ),
    check(
      "resource-url",
      Boolean(requestedHttps && declaredHttps),
      `resource URL is HTTPS (${declaredHttps?.toString()})`,
      requestedHttps ? "challenge is missing an HTTPS resource.url" : "target URL must use HTTPS",
    ),
    check(
      "x402-version",
      challenge.x402Version === 2,
      "x402 version is 2",
      `expected x402Version 2, got ${String(challenge.x402Version ?? "missing")}`,
    ),
    check(
      "base-network",
      baseAccepts.length > 0,
      "challenge accepts Base mainnet (eip155:8453)",
      "challenge has no Base mainnet payment option",
    ),
    check(
      "asset",
      supportedAssets.length > 0,
      `Base asset is ${[...new Set(supportedAssets)].join(" or ")}`,
      "Base payment option must use official USDC or EURC",
    ),
    check(
      "bazaar",
      hasBazaarMetadata(challenge),
      "Bazaar discovery metadata is present",
      "challenge is missing extensions.bazaar.info metadata",
    ),
  ];

  return {
    ok: checks.every((item) => item.ok),
    url: requestedUrl,
    status,
    checks,
  };
}

export async function doctorUrl(url: string, options: DoctorOptions = {}): Promise<DoctorReport> {
  if (!parseHttpsUrl(url)) {
    return validateDoctorChallenge(url, 0, null);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Upstream x402 v2 middleware commonly puts the challenge in a header.
    }

    const bodyHasAccepts =
      body !== null &&
      typeof body === "object" &&
      Array.isArray((body as { accepts?: unknown }).accepts);
    if (!bodyHasAccepts) {
      const header =
        response.headers.get("payment-required") ?? response.headers.get("x-payment-required");
      if (header) {
        try {
          body = decodeChallengeHeader(header);
        } catch {
          // The validation report below will identify the missing fields.
        }
      }
    }

    return validateDoctorChallenge(url, response.status, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      url,
      checks: [],
      error: `fetch failed: ${message}`,
    };
  }
}

export const DOCTOR_HELP_TEXT = `paygate doctor <https-url> [--json]

Read-only Base mainnet readiness check. Sends one unpaid, unauthenticated GET
with redirects disabled and validates:
  HTTP 402 · HTTPS resource URL · x402 v2 · Base mainnet
  official USDC/EURC asset · Bazaar discovery metadata

Aliases:
  paygate check <https-url>
`;

export async function runDoctor(
  argv: string[],
  io: DoctorIO = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
  options: DoctorOptions = {},
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.stdout(DOCTOR_HELP_TEXT);
    return 0;
  }
  const json = argv.includes("--json");
  const positional = argv.filter((value) => !value.startsWith("-"));
  const url = positional[0];
  if (!url) {
    io.stderr("paygate doctor: <https-url> is required.\n");
    return 1;
  }
  const unknownFlags = argv.filter(
    (value) => value.startsWith("-") && !["--json", "--help", "-h"].includes(value),
  );
  if (unknownFlags.length > 0) {
    io.stderr(`paygate doctor: unknown flag ${unknownFlags[0]}.\n`);
    return 1;
  }

  const report = await doctorUrl(url, options);
  if (json) {
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  }

  io.stdout(`Paygate doctor: ${url}\n`);
  for (const item of report.checks) {
    io.stdout(`${item.ok ? "PASS" : "FAIL"}  ${item.message}\n`);
  }
  if (report.error) io.stderr(`FAIL  ${report.error}\n`);
  io.stdout(
    report.ok
      ? "\nReady for Base mainnet. No payment or auth headers were sent.\n"
      : "\nNot ready. No payment or auth headers were sent.\n",
  );
  return report.ok ? 0 : 1;
}
