/**
 * payagent — inspect.
 *
 * Read-only x402 challenge inspection. Fetch a URL with NO payment header
 * and NO auth, expect HTTP 402, and parse the challenge body so an agent
 * (or human) can see the price, asset, network, and payment requirements
 * BEFORE deciding to pay. This module never sends money — the follow-up
 * paid call is `payagent pay <url>` (CLI) or `payFetchDelegated` (SDK).
 *
 * Some challenge bodies (paygate's, for one) name the facilitator the
 * SERVER settles through. That is the server's choice — surfacing it here
 * is informational only; the inspecting agent never talks to (let alone
 * replaces) a server's facilitator.
 *
 * Money rule: amounts stay in the asset's base units (string) plus, when
 * they divide evenly, integer cents. Never floats. For 6-decimal assets
 * (USDC, EURC): cents = baseUnits / 10^4.
 */

/** Known 6-decimal EUR settlement assets (Circle EURC), lowercase. */
const EURC_ASSETS = new Set([
  "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", // Base mainnet
  "0x808456652fdb597867f38412077a9182bf77359f", // Base Sepolia
]);

/** Known 6-decimal USD settlement assets (Circle USDC), lowercase. */
const USDC_ASSETS = new Set([
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base mainnet
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e", // Base Sepolia
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // Ethereum
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", // Polygon
]);

/** One payment option from the 402 challenge, normalized for display. */
export interface InspectedAccept {
  scheme: string;
  /** Network as sent on the wire (CAIP-2 like `eip155:8453`, or an alias). */
  network: string;
  /** Amount in the asset's base units, verbatim from the wire. */
  amountBaseUnits: string;
  /**
   * Amount converted to integer cents (6-decimal assets: baseUnits / 10^4).
   * Undefined when the base units don't divide evenly into whole cents or
   * aren't a parseable non-negative integer. Never a float.
   */
  amountCents?: number;
  /** ERC-20 asset contract address. */
  asset: string;
  /** Recipient address. */
  payTo: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  /** EIP-712 domain name from `extra.name` when present (e.g. "USD Coin", "EURC"). */
  assetName?: string;
  /** "USD" / "EUR" when the asset (or its name) is recognized; else undefined. */
  currency?: "USD" | "EUR";
}

export type InspectChallengeResult =
  | {
      gated: true;
      url: string;
      status: 402;
      x402Version?: number;
      accepts: InspectedAccept[];
      /**
       * Facilitator URL the SERVER declares in its challenge body (paygate
       * bodies carry a `facilitator` field). Informational only — the server
       * chose it, and the payer never calls or replaces it.
       */
      serverDeclaredFacilitator?: string;
    }
  | { gated: false; url: string; status: number };

export interface InspectChallengeOptions {
  /** Override the fetch implementation. Handy for tests. */
  fetch?: typeof globalThis.fetch;
  /** Request timeout in ms. Default 15000. */
  timeoutMs?: number;
  /** Optional AbortSignal; overrides the timeout signal when provided. */
  signal?: AbortSignal;
}

/** Thrown when a 402 response's body can't be parsed as an x402 challenge. */
export class InspectParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectParseError";
  }
}

/**
 * Convert a base-units string to integer cents for a 6-decimal asset
 * (cents = baseUnits / 10^4). Returns undefined when the value isn't a
 * clean non-negative integer number of cents — never rounds, never floats.
 */
export function centsFromBaseUnits(baseUnits: string): number | undefined {
  let bu: bigint;
  try {
    bu = BigInt(baseUnits);
  } catch {
    return undefined;
  }
  if (bu < 0n || bu % 10_000n !== 0n) return undefined;
  const cents = bu / 10_000n;
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : undefined;
}

function currencyFor(asset: string, assetName?: string): "USD" | "EUR" | undefined {
  const addr = asset.toLowerCase();
  if (USDC_ASSETS.has(addr)) return "USD";
  if (EURC_ASSETS.has(addr)) return "EUR";
  if (assetName === "EURC") return "EUR";
  if (assetName === "USD Coin" || assetName === "USDC") return "USD";
  return undefined;
}

function normalizeAccept(raw: Record<string, unknown>): InspectedAccept | undefined {
  // v2 spec name is `amount`; v1 legacy sellers send `maxAmountRequired`.
  const amount =
    typeof raw.amount === "string"
      ? raw.amount
      : typeof raw.maxAmountRequired === "string"
        ? raw.maxAmountRequired
        : undefined;
  const asset = typeof raw.asset === "string" ? raw.asset : undefined;
  const payTo = typeof raw.payTo === "string" ? raw.payTo : undefined;
  const network = typeof raw.network === "string" ? raw.network : undefined;
  if (amount === undefined || !asset || !payTo || !network) return undefined;
  const extra = raw.extra as Record<string, unknown> | undefined;
  const assetName = typeof extra?.name === "string" ? extra.name : undefined;
  const accept: InspectedAccept = {
    scheme: typeof raw.scheme === "string" ? raw.scheme : "exact",
    network,
    amountBaseUnits: amount,
    asset,
    payTo,
  };
  const cents = centsFromBaseUnits(amount);
  if (cents !== undefined) accept.amountCents = cents;
  if (typeof raw.resource === "string") accept.resource = raw.resource;
  if (typeof raw.description === "string") accept.description = raw.description;
  if (typeof raw.mimeType === "string") accept.mimeType = raw.mimeType;
  if (assetName) accept.assetName = assetName;
  const currency = currencyFor(asset, assetName);
  if (currency) accept.currency = currency;
  return accept;
}

/**
 * Fetch `url` with no payment and no auth. On HTTP 402, parse the x402
 * challenge (v2 `accepts` array, or the flat legacy form) and return the
 * normalized payment requirements. On any other status, return
 * `{ gated: false, status }`.
 *
 * Read-only and free: never sends an `X-PAYMENT` header, never signs,
 * never caches authorizations.
 *
 * @throws InspectParseError when a 402 body isn't parseable as a challenge.
 */
export async function inspectChallenge(
  url: string,
  opts: InspectChallengeOptions = {},
): Promise<InspectChallengeResult> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const signal = opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  const res = await fetchImpl(url, { method: "GET", signal });
  if (res.status !== 402) {
    return { gated: false, url, status: res.status };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  // x402 v2 servers built on the upstream @x402 middleware carry the
  // challenge in the base64 `payment-required` response header and default
  // the body to `{}` — fall back to the header whenever the body doesn't
  // hold an accepts array.
  const bodyHasAccepts =
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { accepts?: unknown }).accepts);
  if (!bodyHasAccepts) {
    const header =
      typeof res.headers?.get === "function" ? res.headers.get("payment-required") : null;
    if (header) {
      try {
        const decoded =
          typeof atob === "function"
            ? atob(header)
            : Buffer.from(header, "base64").toString("utf8");
        body = JSON.parse(decoded);
      } catch {
        // fall through to body-based error handling below
      }
    }
  }
  if (body === null) {
    throw new InspectParseError(
      `${url} returned HTTP 402 but neither the body nor the payment-required header carries a parseable x402 challenge.`,
    );
  }
  if (typeof body !== "object") {
    throw new InspectParseError(
      `${url} returned HTTP 402 but the body is not an x402 challenge object.`,
    );
  }
  const obj = body as Record<string, unknown>;

  const accepts: InspectedAccept[] = [];
  if (Array.isArray(obj.accepts)) {
    for (const raw of obj.accepts) {
      if (typeof raw === "object" && raw !== null) {
        const normalized = normalizeAccept(raw as Record<string, unknown>);
        if (normalized) accepts.push(normalized);
      }
    }
  } else {
    // Flat legacy form: requirements at the top level instead of `accepts[]`.
    const normalized = normalizeAccept(obj);
    if (normalized) accepts.push(normalized);
  }
  if (accepts.length === 0) {
    throw new InspectParseError(
      `${url} returned HTTP 402 but no payment option in the body could be parsed (missing amount/asset/payTo/network).`,
    );
  }

  const result: Extract<InspectChallengeResult, { gated: true }> = {
    gated: true,
    url,
    status: 402,
    accepts,
  };
  if (typeof obj.x402Version === "number") result.x402Version = obj.x402Version;
  if (typeof obj.facilitator === "string") result.serverDeclaredFacilitator = obj.facilitator;
  return result;
}
