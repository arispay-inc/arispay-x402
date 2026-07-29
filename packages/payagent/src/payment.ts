import { InvalidRequirementsError } from "./errors.js";
/**
 * payagent — x402 402-response parsing utilities.
 *
 * These are the shared primitives used by `payFetchDelegated` to normalize
 * a seller's 402 body into a usable `accepts` list, independent of whether
 * it's emitted in x402-v2 standard shape or the legacy flat/AgFac shape.
 */
import type {
  AgfacFlatRequirements,
  PaymentRequirementsBody,
  X402Accept,
  X402Requirements,
} from "./types.js";

// Coinbase's reference x402 middleware emits short network names
// ("base-sepolia"), while the x402 v2 spec and our internal code use CAIP-2
// ("eip155:84532"). Accept either on the way in.
const NETWORK_SHORT_TO_CAIP2: Record<string, string> = {
  ethereum: "eip155:1",
  polygon: "eip155:137",
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
};

export function normalizeNetwork(network: string): string {
  if (network.includes(":")) return network; // already CAIP-2
  return NETWORK_SHORT_TO_CAIP2[network] ?? network;
}

const NETWORK_CAIP2_TO_SHORT: Record<string, string> = Object.fromEntries(
  Object.entries(NETWORK_SHORT_TO_CAIP2).map(([s, c]) => [c, s]),
);

/** Convert CAIP-2 back to the short network name x402 sellers emit on the wire. */
export function denormalizeNetwork(network: string): string {
  if (!network.includes(":")) return network; // already short
  return NETWORK_CAIP2_TO_SHORT[network] ?? network;
}

function isStandardFormat(body: PaymentRequirementsBody): body is X402Requirements {
  return "accepts" in body && Array.isArray(body.accepts);
}

function isFlatFormat(body: PaymentRequirementsBody): body is AgfacFlatRequirements {
  return "scheme" in body && "payTo" in body && !("accepts" in body);
}

/** Normalize both x402 v2 standard and AgFac flat format into accepts array. */
function extractAccepts(body: PaymentRequirementsBody): X402Accept[] {
  if (isStandardFormat(body)) {
    return body.accepts.map((a) => {
      // x402 v2 canonical name is `amount`; some legacy sellers still emit
      // the v1 name `maxAmountRequired`. Accept either, normalize to `amount`.
      const rawAmount =
        (a as { amount?: string }).amount ??
        (a as { maxAmountRequired?: string }).maxAmountRequired;
      return {
        ...a,
        network: normalizeNetwork(a.network),
        amount: rawAmount as string,
      };
    });
  }
  if (isFlatFormat(body)) {
    return [
      {
        scheme: body.scheme,
        network: normalizeNetwork(body.network),
        amount: (body.amount ?? body.maxAmountRequired) as string,
        resource: body.resource,
        asset: body.asset,
        payTo: body.payTo,
        extra: { name: "USDC", version: "2" },
      },
    ];
  }
  throw new InvalidRequirementsError("unrecognized format");
}

export interface ParsedRequirements {
  accepts: X402Accept[];
  /**
   * Raw accept objects, byte-for-byte as the seller advertised them. x402 v2
   * servers match paymentPayload.accepted against their paymentRequirements
   * via deepEqual — our signed payload must echo the original accept without
   * added/normalised fields, else the merchant rejects with a silent 402.
   */
  rawAccepts: unknown[];
  /** x402 protocol version advertised by the seller. Defaults to 1. */
  x402Version: number;
}

function extractRawAccepts(body: PaymentRequirementsBody): unknown[] {
  if (isStandardFormat(body)) return body.accepts as unknown[];
  if (isFlatFormat(body)) return [body as unknown];
  return [];
}

/**
 * Header names sellers use to advertise payment requirements, in
 * preference order. Audited against 128 live Bazaar-listed endpoints
 * on 2026-04-30 (see /docs/x402-wire-format-audit.md in the monorepo):
 *
 *   - `payment-required`        : 95.3% of canonical x402 emits
 *   - `x-payment-required`      :  10% (variant)
 *   - `x-payment-requirements`  : paygate ≤ 5.0 only (one in-house emit)
 *
 * Header values are usually base64-encoded JSON (canonical) but some
 * sellers (notably older paygate) emit raw JSON. Try base64 first,
 * fall back to raw JSON parse.
 */
const HEADER_LOOKUP_ORDER = [
  "payment-required",
  "x-payment-required",
  "x-payment-requirements",
] as const;

function tryParseHeaderValue(value: string): Record<string, unknown> | null {
  // base64 (canonical wire format).
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // not valid base64 JSON, try raw.
  }
  // Raw JSON (paygate's pre-5.1 emit; some custom sellers).
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // not parseable.
  }
  return null;
}

/** Parse the 402 response body and extract payment requirements. */
export async function parseRequirements(response: Response): Promise<ParsedRequirements> {
  // Header path: try the canonical name first, then variants. Any
  // header that yields a recognizable accepts array wins; otherwise we
  // fall through to body parsing.
  for (const headerName of HEADER_LOOKUP_ORDER) {
    const value = response.headers.get(headerName);
    if (!value) continue;
    const parsed = tryParseHeaderValue(value);
    if (!parsed) continue;
    try {
      const body = (parsed.requirements ?? parsed) as PaymentRequirementsBody;
      const accepts = extractAccepts(body);
      if (accepts.length > 0) {
        return {
          accepts,
          rawAccepts: extractRawAccepts(body),
          x402Version: typeof parsed.x402Version === "number" ? parsed.x402Version : 2,
        };
      }
    } catch {
      // unrecognized format from this header — try the next.
    }
  }

  let json: Record<string, unknown>;
  try {
    json = await response.json();
  } catch {
    throw new InvalidRequirementsError("response body is not valid JSON");
  }

  // Some servers nest requirements under a `requirements` key
  const body = (json.requirements ?? json) as PaymentRequirementsBody;

  if (!body || typeof body !== "object") {
    throw new InvalidRequirementsError("invalid 402 response body");
  }
  // x402Version 1 is what the Coinbase reference middleware emits; v2 is the
  // newer draft. Echo whichever version the seller advertised.
  const version =
    typeof (body as { x402Version?: unknown }).x402Version === "number"
      ? (body as { x402Version: number }).x402Version
      : 1;

  return {
    accepts: extractAccepts(body),
    rawAccepts: extractRawAccepts(body),
    x402Version: version,
  };
}
