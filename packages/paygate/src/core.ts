/**
 * paygate v3 — core x402 paywall logic.
 *
 * v3 change: one config knob (`merchantId`). The SDK fetches the merchant's
 * capability manifest from api.arispay.app on boot, caches it for 5 minutes,
 * and derives wallet/network/asset/trustMinTier from the response.
 *
 * v2 callers (who passed `wallet` + `network` directly) are supported via
 * a compatibility shim until v4.
 *
 * See docs/paygate-v2.md §7.
 */

// ── Default facilitator ─────────────────────────────
export const DEFAULT_FACILITATOR = "https://facilitator.arispay.app";
export const DEFAULT_API_URL = "https://api.arispay.app";
export const CAPABILITY_CACHE_TTL_MS = 5 * 60 * 1000;

// ── Known USDC addresses per network ───────────────
// Canonical source is `@arispay/x402-core` (USDC_BASE_MAINNET, etc.).
// This duplicate is intentional: `paygate` is a published, standalone npm
// package with `ethers` as its only runtime dep (see paygate CLAUDE.md). It
// must NOT take a workspace dep on the private `@arispay/x402-core` package
// — npm consumers wouldn't resolve it. Keep these four values in sync with
// packages/x402-core/src/constants.ts by hand. Do not "DRY" by importing —
// see P2-4 blocker discussion.
const USDC_ADDRESSES: Record<string, string> = {
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base Mainnet
  "eip155:1": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Ethereum
  "eip155:137": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Polygon
};

// Circle EURC — the EUR settlement asset (`currency: "EUR"`). Entries exist
// only for networks where the address + EIP-712 domain were verified
// on-chain (eth_call name()/version(), 2026-06-11). Same FiatToken family
// as USDC → EIP-3009 supported, 6 decimals, domain name "EURC" version "2"
// on both networks. EUR on other networks requires an explicit `asset`.
const EURC_ADDRESSES: Record<string, string> = {
  "eip155:84532": "0x808456652fdb597867f38412077A9182bf77359F", // Base Sepolia
  "eip155:8453": "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", // Base Mainnet
};

export type PaygateCurrency = "USD" | "EUR";

const NETWORK_ALIASES: Record<string, string> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
  ethereum: "eip155:1",
  polygon: "eip155:137",
};

function normalizeNetwork(network: string): string {
  return NETWORK_ALIASES[network] ?? network;
}

/**
 * Build the response headers for an x402 402 challenge in the canonical
 * wire format observed across Bazaar-listed endpoints.
 *
 * - `payment-required: <base64(JSON)>` — primary, what 95.3% of live
 *   x402 endpoints emit (audited 2026-04-30; see
 *   docs/x402-wire-format-audit.md). base64 also dodges the Latin1
 *   `ByteString` constraint on Node response headers, so a description
 *   containing an em dash or smart quote no longer 500s the response.
 *
 * - `X-Payment-Requirements: <raw JSON of {x402Version, accepts}>` —
 *   paygate's pre-v5.1 header name, kept for one minor cycle as a
 *   deprecated alias so existing `payagent` consumers (and any other
 *   client that reads our legacy emit) keep working. Will be removed
 *   in paygate v6. Strip non-printable-ASCII defensively in case a
 *   description picks up Unicode in the meantime.
 *
 * - `WWW-Authenticate: x402` — RFC 7235 challenge advertisement.
 *
 * - `Access-Control-Expose-Headers` — without this, browser-based
 *   agents (Anthropic MCP-in-browser, Chrome WebMCP, …) can't read
 *   `payment-required` cross-origin. 80% of live endpoints don't
 *   bother; we do.
 *
 * Exported for tests; consumers should not rely on this signature.
 */
export function buildChallengeHeaders(
  challengeBody: Record<string, unknown>,
  accepts: X402PaymentAccept[],
): Record<string, string> {
  const canonical = Buffer.from(JSON.stringify(challengeBody), "utf8").toString("base64");
  const legacy = JSON.stringify({ x402Version: 2, accepts })
    .replace(/[\r\n\0]/g, " ")
    .replace(/[^\x20-\x7E]/g, "?");
  return {
    "payment-required": canonical,
    "X-Payment-Requirements": legacy,
    "WWW-Authenticate": "x402",
    "Access-Control-Expose-Headers": "payment-required, x-payment-response, www-authenticate",
  };
}

const USDC_DOMAIN_NAMES: Record<string, string> = {
  "eip155:84532": "USDC",
  "eip155:8453": "USD Coin",
  "eip155:1": "USD Coin",
  "eip155:137": "USD Coin",
};

// EURC's EIP-712 domain name is "EURC" on every verified network.
const EURC_DOMAIN_NAME = "EURC";

/** EIP-712 domain name for the selected currency's asset on a network. */
function domainNameFor(currency: PaygateCurrency, network: string): string {
  if (currency === "EUR") return EURC_DOMAIN_NAME;
  return USDC_DOMAIN_NAMES[network] ?? "USD Coin";
}

// ── Configuration (v3) ─────────────────────────────

/**
 * v3 config.
 *
 * New callers pass `merchantId` (required). The SDK will fetch the
 * merchant's capability manifest and derive everything else.
 *
 * v2 callers can still pass `wallet` + `network`; the shim translates
 * this into a direct PaymentRequirements build without an apps/api
 * lookup. Emits a `console.warn` on first use suggesting migration.
 */
export interface PaygateConfig {
  /** v3 — the merchant id (a cuid from /v1/merchants/me). */
  merchantId?: string;

  /**
   * v2 compat — USDC wallet address.
   * @deprecated Pass `merchantId` instead. Will be removed in v4.
   */
  wallet?: string;

  /**
   * v2 compat — CAIP-2 or short name.
   * @deprecated Pass `merchantId` instead. Will be removed in v4.
   */
  network?: string;

  /**
   * Settlement currency. Default `"USD"` (USDC). `"EUR"` settles in Circle
   * EURC; `priceCents` then means integer EUR cents (the cents → 6-decimals
   * conversion factor is the same 10^4 for both assets).
   *
   * v2-shim path: resolves the EURC address for the network (Base mainnet +
   * Base Sepolia known; other networks need an explicit `asset`).
   * v3 path: selects the merchant-manifest rail whose `assetName` matches
   * (`EURC` for EUR); errors clearly if the merchant has no EUR rail.
   */
  currency?: PaygateCurrency;

  /**
   * Settlement token contract address. Auto-derived from `network` +
   * `currency` if omitted. Ignored in the v3 path (merchant manifest is
   * authoritative).
   */
  asset?: string;

  /** Override the default facilitator URL. */
  facilitatorUrl?: string;

  /**
   * Self-settle: submit the settlement transaction from your own funded key
   * instead of the facilitator's relayer. You pay chain gas (~$0.001 per
   * settle on Base) and nobody else — the never-sponsor / never-charge
   * policy's direct-payout path. Verification still runs against the
   * facilitator (free — no chain writes). Replay protection is on-chain:
   * EIP-3009 consumes the authorization nonce, so a duplicate submit
   * reverts.
   */
  selfSettle?: {
    /** 0x-hex private key of any funded EOA. Pays gas only; never receives or holds customer funds. */
    privateKey: string;
    /** JSON-RPC URL for the settlement network. Defaults to the public Base RPCs for `eip155:8453` / `eip155:84532`. */
    rpcUrl?: string;
  };

  /** Override the default apps/api URL (for staging / self-hosted). */
  apiUrl?: string;

  /** Facilitator call timeout in ms. Default 30s. */
  timeout?: number;

  /** Merchant-capability cache TTL in ms. Default 5 min. */
  cacheTtlMs?: number;

  /** Discovery probe rate limit. */
  discoveryRateLimit?: DiscoveryRateLimitConfig;
}

export interface RoutePrice {
  /** Price in integer USD cents. 10 = $0.10. */
  priceCents?: number | ((request: unknown) => number | Promise<number>);

  /**
   * v2 compat — floating-point USDC price.
   * @deprecated Use `priceCents` (integer). Will be removed in v4.
   */
  price?: number | ((request: unknown) => number | Promise<number>);

  /** Optional description shown in the 402 response. */
  description?: string;
}

export interface DiscoveryRateLimitConfig {
  maxProbes: number;
  windowMs: number;
}

const DEFAULT_DISCOVERY_LIMIT: DiscoveryRateLimitConfig = {
  maxProbes: 10,
  windowMs: 60_000,
};

const discoveryWindows = new Map<string, number[]>();

function checkDiscoveryRateLimit(
  key: string,
  config: DiscoveryRateLimitConfig = DEFAULT_DISCOVERY_LIMIT,
): boolean {
  const now = Date.now();
  const cutoff = now - config.windowMs;
  let timestamps = discoveryWindows.get(key);
  if (!timestamps) {
    timestamps = [];
    discoveryWindows.set(key, timestamps);
  }
  while (timestamps.length > 0 && timestamps[0]! < cutoff) timestamps.shift();
  if (timestamps.length >= config.maxProbes) return false;
  timestamps.push(now);
  return true;
}

// ── Capability manifest — fetched from apps/api ────

interface CapabilityManifest {
  version: "1";
  merchant: { slug: string; name: string };
  trust: { minTier: "any" | "payagent-verified"; upgradeUrl?: string };
  rails: Array<{
    scheme: "x402";
    network: string;
    asset: string;
    assetName: string; // "USDC" | "EURC" | future assets
    payTo: string;
    facilitator: string;
  }>;
  products?: unknown;
  updated: string;
}

interface ResolvedMerchantConfig {
  network: string; // CAIP-2
  asset: string;
  /** EIP-712 domain name of the settlement asset. */
  domainName: string;
  payTo: string;
  facilitator: string;
  trustMinTier: "any" | "payagent-verified";
  slug: string;
  fetchedAt: number;
}

const capabilityCache = new Map<string, ResolvedMerchantConfig>();

let v2ShimWarned = false;
function warnV2Shim() {
  if (v2ShimWarned) return;
  v2ShimWarned = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[paygate] v2 config detected (`wallet` + `network`). Pass `merchantId` instead; v2 will be removed in v4. See https://paygate.arispay.app/docs#v3-migration",
  );
}

async function fetchMerchantConfig(config: PaygateConfig): Promise<ResolvedMerchantConfig> {
  if (!config.merchantId) {
    throw new Error("paygate: merchantId is required for v3 flow");
  }

  const currency: PaygateCurrency = config.currency ?? "USD";
  const cacheKey = `${config.merchantId}:${currency}`;
  const cached = capabilityCache.get(cacheKey);
  const cacheTtl = config.cacheTtlMs ?? CAPABILITY_CACHE_TTL_MS;
  if (cached && Date.now() - cached.fetchedAt < cacheTtl) {
    return cached;
  }

  const apiUrl = config.apiUrl ?? DEFAULT_API_URL;
  const url = `${apiUrl}/v1/merchants/${encodeURIComponent(config.merchantId)}/capabilities`;

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(config.timeout ?? 30_000),
    });
  } catch (err: unknown) {
    if (cached) {
      // Extend stale cache on network blip — don't take down the merchant.
      return { ...cached, fetchedAt: Date.now() - cacheTtl + 60_000 };
    }
    throw new Error(
      `paygate: failed to fetch merchant capabilities: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (res.status === 404) {
    capabilityCache.delete(cacheKey);
    throw new Error(`paygate: merchantId "${config.merchantId}" not found at ${apiUrl}`);
  }
  if (res.status >= 500 && cached) {
    return { ...cached, fetchedAt: Date.now() - cacheTtl + 60_000 };
  }
  if (!res.ok) {
    throw new Error(`paygate: capability fetch failed HTTP ${res.status}`);
  }

  const manifest = (await res.json()) as CapabilityManifest;
  const wantedAssetName = currency === "EUR" ? "EURC" : "USDC";
  // Prefer the rail matching the requested currency; USD callers keep the
  // historical rails[0] fallback so pre-EUR manifests behave identically.
  const rail =
    manifest.rails?.find((r) => r.assetName === wantedAssetName) ??
    (currency === "USD" ? manifest.rails?.[0] : undefined);
  if (!rail) {
    throw new Error(
      currency === "EUR"
        ? `paygate: merchant "${config.merchantId}" has no EUR (EURC) payout rail — add one in the dashboard or use currency: "USD"`
        : `paygate: merchant "${config.merchantId}" has no active payout rail — add a PayoutMethod in the dashboard`,
    );
  }

  // v3 manifests must specify an HTTPS facilitator per rail. The SDK no longer
  // silently falls back to the production default, which would hide
  // misconfiguration and let a rogue facilitator claim successful settlement (L7).
  const facilitator = rail.facilitator;
  if (!facilitator || !facilitator.startsWith("https://")) {
    throw new Error(
      `paygate: merchant "${config.merchantId}" rail has invalid facilitator URL`,
    );
  }

  const resolved: ResolvedMerchantConfig = {
    network: rail.network,
    asset: rail.asset,
    domainName: domainNameFor(currency, rail.network),
    payTo: rail.payTo,
    facilitator,
    trustMinTier: manifest.trust?.minTier ?? "any",
    slug: manifest.merchant.slug,
    fetchedAt: Date.now(),
  };
  capabilityCache.set(cacheKey, resolved);
  return resolved;
}

/**
 * v2 shim — synthesise a ResolvedMerchantConfig from `wallet` + `network`.
 * No apps/api round-trip; trustMinTier defaults to "any" because the
 * caller didn't configure anything and v2 never knew about tiers.
 */
function resolveV2Shim(config: PaygateConfig): ResolvedMerchantConfig {
  warnV2Shim();
  if (!config.wallet) {
    throw new Error("paygate: wallet is required in v2-shim mode");
  }
  if (!config.network) {
    throw new Error("paygate: network is required in v2-shim mode");
  }
  const currency: PaygateCurrency = config.currency ?? "USD";
  const network = normalizeNetwork(config.network);
  const knownAddresses = currency === "EUR" ? EURC_ADDRESSES : USDC_ADDRESSES;
  const asset = config.asset ?? knownAddresses[network];
  if (!asset) {
    throw new Error(
      `paygate: unsupported network ${network} — no known ${currency === "EUR" ? "EURC" : "USDC"} address (pass \`asset\` explicitly)`,
    );
  }
  return {
    network,
    asset,
    domainName: domainNameFor(currency, network),
    payTo: config.wallet,
    facilitator: config.facilitatorUrl ?? DEFAULT_FACILITATOR,
    trustMinTier: "any",
    slug: "v2-shim",
    fetchedAt: Date.now(),
  };
}

// ── Price resolution ───────────────────────────────

async function resolvePriceCents(routePrice: RoutePrice, request: unknown): Promise<number> {
  const v3 = routePrice.priceCents;
  if (v3 !== undefined) {
    const cents = typeof v3 === "function" ? await v3(request) : v3;
    if (!Number.isInteger(cents) || cents < 1) {
      throw new Error(
        `paygate: priceCents must be a positive integer. Got ${JSON.stringify(cents)}. If you meant $0.10, use priceCents: 10.`,
      );
    }
    return cents;
  }
  const v2 = routePrice.price;
  if (v2 !== undefined) {
    warnV2Shim();
    const dollars = typeof v2 === "function" ? await v2(request) : v2;
    if (typeof dollars !== "number" || dollars <= 0) {
      throw new Error("paygate: price must be a positive number");
    }
    return Math.round(dollars * 100);
  }
  throw new Error("paygate: RoutePrice requires `priceCents` (preferred) or `price` (v2 compat)");
}

// ── x402 types ─────────────────────────────────────

interface TransferAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

interface X402PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: string;
    authorization: TransferAuthorization;
  };
}

interface X402PaymentAccept {
  scheme: string;
  network: string;
  amount: string;
  resource: string;
  asset: string;
  payTo: string;
  extra?: Record<string, string>;
}

interface FacilitatorSettleResponse {
  success: boolean;
  transaction?: string;
  payer?: string;
  errorReason?: string;
  errorMessage?: string;
}

// ── Self-settle (seller-submitted settlement) ──────────────────────────
// EIP-3009 transferWithAuthorization, split-signature form — present on
// USDC and EURC, the assets the default facilitator stands behind.
const EIP3009_ABI = [
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
];

const DEFAULT_RPC_BY_NETWORK: Record<string, string> = {
  "eip155:8453": "https://mainnet.base.org",
  "eip155:84532": "https://sepolia.base.org",
  base: "https://mainnet.base.org",
  "base-sepolia": "https://sepolia.base.org",
};

async function submitSelfSettle(
  selfSettle: NonNullable<PaygateConfig["selfSettle"]>,
  paymentPayload: X402PaymentPayload,
  accept: X402PaymentAccept,
  timeoutMs: number,
): Promise<FacilitatorSettleResponse> {
  const rpcUrl = selfSettle.rpcUrl ?? DEFAULT_RPC_BY_NETWORK[accept.network];
  if (!rpcUrl) {
    return {
      success: false,
      errorReason: "SELF_SETTLE_CONFIG",
      errorMessage: `paygate: no default RPC for network "${accept.network}" — set selfSettle.rpcUrl`,
    };
  }
  // `ethers` is an optional peer dependency — only self-settle needs it, so
  // the facilitator path never pulls it. Surface a clear install hint rather
  // than a raw MODULE_NOT_FOUND if a self-settle merchant hasn't installed it.
  let ethers: typeof import("ethers");
  try {
    ethers = await import("ethers");
  } catch {
    return {
      success: false,
      errorReason: "SELF_SETTLE_CONFIG",
      errorMessage:
        "paygate: self-settle requires the optional peer dependency `ethers` — run `npm install ethers`",
    };
  }
  try {
    const { JsonRpcProvider, Wallet, Contract, Signature } = ethers;
    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(selfSettle.privateKey, provider);
    const token = new Contract(accept.asset, EIP3009_ABI, wallet);
    const auth = paymentPayload.payload.authorization;
    const sig = Signature.from(paymentPayload.payload.signature);
    const tx = await token.transferWithAuthorization!(
      auth.from,
      auth.to,
      auth.value,
      auth.validAfter,
      auth.validBefore,
      auth.nonce,
      sig.v,
      sig.r,
      sig.s,
    );
    const receipt = await tx.wait(1, timeoutMs);
    if (!receipt || receipt.status !== 1) {
      return {
        success: false,
        errorReason: "SETTLEMENT_REVERTED",
        errorMessage: "paygate: self-settle transaction reverted",
      };
    }
    return { success: true, transaction: receipt.hash, payer: auth.from };
  } catch (err: unknown) {
    return {
      success: false,
      errorReason: "SELF_SETTLE_ERROR",
      errorMessage: err instanceof Error ? err.message : "paygate: self-settle failed",
    };
  }
}

function decodePaymentHeader(header: string): X402PaymentPayload {
  try {
    const decoded = Buffer.from(header, "base64").toString("utf8");
    return JSON.parse(decoded) as X402PaymentPayload;
  } catch {
    return JSON.parse(header) as X402PaymentPayload;
  }
}

// ── Paywall result ─────────────────────────────────

export interface PaywallResult {
  paid: boolean;
  receipt?: {
    paid: true;
    txHash?: string;
    trustTier: string;
    merchant: string;
  };
  settlement?: FacilitatorSettleResponse;
  challenge?: {
    statusCode: 402;
    headers: Record<string, string>;
    body: {
      error: string;
      x402Version: number;
      accepts: X402PaymentAccept[];
      facilitator: string;
      trustMinTier: string;
      gasSponsored: boolean;
    };
  };
  error?: { statusCode: number; body: { error: string; code: string } };
}

// ── Core paywall handler ───────────────────────────

export async function handlePaywall(
  config: PaygateConfig,
  routePrice: RoutePrice,
  resourceUrl: string,
  paymentHeader: string | undefined,
  clientIp?: string,
): Promise<PaywallResult> {
  // Resolve the merchant: v3 fetch vs v2 shim
  let resolved: ResolvedMerchantConfig;
  try {
    resolved = config.merchantId ? await fetchMerchantConfig(config) : resolveV2Shim(config);
  } catch (err: unknown) {
    return {
      paid: false,
      error: {
        statusCode: 500,
        body: {
          error: err instanceof Error ? err.message : "paygate: configuration error",
          code: "PAYGATE_CONFIG",
        },
      },
    };
  }

  const priceCents = await resolvePriceCents(routePrice, undefined);
  const priceBaseUnits = (BigInt(priceCents) * BigInt(10_000)).toString();

  // No payment header → 402 challenge
  if (!paymentHeader) {
    if (clientIp) {
      if (!checkDiscoveryRateLimit(clientIp, config.discoveryRateLimit)) {
        return {
          paid: false,
          error: {
            statusCode: 429,
            body: {
              error: "Too many discovery requests. Try again later.",
              code: "DISCOVERY_RATE_LIMITED",
            },
          },
        };
      }
    }

    const accepts: X402PaymentAccept[] = [
      {
        scheme: "exact",
        network: resolved.network,
        amount: priceBaseUnits,
        resource: resourceUrl,
        asset: resolved.asset,
        payTo: resolved.payTo,
        extra: { name: resolved.domainName, version: "2" },
      },
    ];

    const challengeBody = {
      error: "Payment Required",
      x402Version: 2,
      accepts,
      facilitator: resolved.facilitator,
      trustMinTier: resolved.trustMinTier,
      gasSponsored: true,
    };

    return {
      paid: false,
      challenge: {
        statusCode: 402,
        headers: buildChallengeHeaders(challengeBody, accepts),
        body: challengeBody,
      },
    };
  }

  // Decode X-Payment
  let paymentPayload: X402PaymentPayload;
  try {
    paymentPayload = decodePaymentHeader(paymentHeader);
  } catch {
    return {
      paid: false,
      error: {
        statusCode: 400,
        body: { error: "Invalid X-Payment header", code: "INVALID_PAYMENT" },
      },
    };
  }

  // Settle via facilitator
  const accept: X402PaymentAccept = {
    scheme: "exact",
    network: resolved.network,
    amount: priceBaseUnits,
    resource: resourceUrl,
    asset: resolved.asset,
    payTo: resolved.payTo,
    extra: { name: resolved.domainName, version: "2" },
  };

  try {
    let settlement: FacilitatorSettleResponse;
    if (config.selfSettle) {
      // Verify via the facilitator (free — no chain writes), then submit
      // the settlement from the seller's own key: gas is the seller's,
      // per the never-sponsor / never-charge policy.
      const verifyRes = await fetch(`${resolved.facilitator}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x402Version: 2,
          paymentPayload,
          paymentRequirements: accept,
        }),
        signal: AbortSignal.timeout(config.timeout ?? 30_000),
      });
      const verdict = (await verifyRes.json()) as { isValid: boolean; invalidReason?: string };
      if (!verdict.isValid) {
        return {
          paid: false,
          error: {
            statusCode: 402,
            body: {
              error: verdict.invalidReason || "Payment verification failed",
              code: verdict.invalidReason || "VERIFICATION_FAILED",
            },
          },
        };
      }
      settlement = await submitSelfSettle(
        config.selfSettle,
        paymentPayload,
        accept,
        config.timeout ?? 30_000,
      );
    } else {
      const res = await fetch(`${resolved.facilitator}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x402Version: 2,
          paymentPayload,
          paymentRequirements: accept,
        }),
        signal: AbortSignal.timeout(config.timeout ?? 30_000),
      });
      settlement = (await res.json()) as FacilitatorSettleResponse;
    }

    if (!settlement.success) {
      return {
        paid: false,
        error: {
          statusCode: 402,
          body: {
            error: settlement.errorMessage || settlement.errorReason || "Payment settlement failed",
            code: settlement.errorReason || "SETTLEMENT_FAILED",
          },
        },
      };
    }

    // Validate the successful settlement before trusting it (L7). Require a
    // non-empty transaction hash and, when the facilitator reports a payer,
    // ensure it matches the address that signed the authorization.
    const expectedPayer = paymentPayload.payload.authorization.from;
    if (
      typeof settlement.transaction !== "string" ||
      settlement.transaction.length === 0 ||
      (settlement.payer && settlement.payer.toLowerCase() !== expectedPayer.toLowerCase())
    ) {
      return {
        paid: false,
        error: {
          statusCode: 502,
          body: {
            error: "Facilitator returned an invalid settlement",
            code: "INVALID_SETTLEMENT",
          },
        },
      };
    }

    return {
      paid: true,
      settlement,
      receipt: {
        paid: true,
        txHash: settlement.transaction,
        trustTier: "any", // SDK path has no tier check in v1
        merchant: resolved.slug,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Facilitator unreachable";
    return {
      paid: false,
      error: {
        statusCode: 502,
        body: { error: `Facilitator error: ${message}`, code: "FACILITATOR_ERROR" },
      },
    };
  }
}
