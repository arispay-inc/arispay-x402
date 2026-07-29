import { InvalidRequirementsError, PaymentRejectedError } from "./errors.js";
/**
 * payagent — Delegated fetch wrapper.
 *
 * Server-side signing variant: instead of holding the private key locally and
 * signing with ethers, call an ArisPay delegated-sign endpoint that signs via
 * the CDP-managed wallet AND enforces per-tx / daily / monthly limits +
 * allowedDomains. This is the path to use with agents created via
 * `DelegationClient.createX402Agent()`.
 *
 * Usage:
 *   const fetch402 = payFetchDelegated({
 *     arispayUrl: 'http://localhost:3001',
 *     apiKey: 'ap_test_...',          // the agent's own key
 *   });
 *   const res = await fetch402('https://api.example.com/premium');
 */
import { parseRequirements } from "./payment.js";

export interface PayFetchDelegatedConfig {
  /** Base URL for the ArisPay API (no trailing slash). */
  arispayUrl: string;
  /** The x402 agent's own API key (returned by DelegationClient.createX402Agent). */
  apiKey: string;
  /** Override for the ArisPay delegated-sign path. Default: /v1/x402/delegated-sign */
  signPath?: string;
  /** Request timeout for the sign call (ms). Default: 15000. */
  signTimeoutMs?: number;
  /**
   * Fires once per paid request, right after ArisPay signs (spend counters
   * are already committed server-side at that point), with the amount and
   * the agent's remaining budget. Advisory: a throwing callback is swallowed
   * and never breaks the payment flow.
   */
  onPayment?: (info: DelegatedPaymentInfo) => void;
}

export type PayFetchFn = (url: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Per-payment budget snapshot surfaced via `onPayment`. All amounts are
 * integer cents. Spend counters and remaining headroom are AFTER this
 * payment (the server returns post-increment counters).
 */
export interface DelegatedPaymentInfo {
  /** Cents charged for this payment. */
  amountCents: number;
  chain: string;
  walletAddress: string;
  /** Cents spent today (UTC calendar day), including this payment. */
  dailySpend: number;
  /** Cents spent this month (UTC calendar month), including this payment. */
  monthlySpend: number;
  limits: { maxPerTx: number; maxDaily: number; maxMonthly: number };
  /** Cents of daily budget left after this payment. */
  remainingDaily: number;
  /** Cents of monthly budget left after this payment. */
  remainingMonthly: number;
}

interface DelegatedSignResponse {
  paymentHeader: string;
  chain: string;
  status: "settled" | "pending" | "failed";
  walletAddress: string;
  spend: {
    amountCents: number;
    dailySpend: number;
    monthlySpend: number;
    limits: { maxPerTx: number; maxDaily: number; maxMonthly: number };
  };
}

/**
 * Create a fetch wrapper that delegates EIP-3009 signing to ArisPay.
 * No private key lives on the caller's machine; ArisPay enforces the
 * delegation limits before signing and increments spend counters on success.
 */
export function payFetchDelegated(config: PayFetchDelegatedConfig): PayFetchFn {
  if (!config.arispayUrl) throw new Error("arispayUrl is required");
  if (!config.apiKey) throw new Error("apiKey is required");
  const baseUrl = config.arispayUrl.replace(/\/$/, "");
  const signPath = config.signPath ?? "/v1/x402/delegated-sign";
  const timeoutMs = config.signTimeoutMs ?? 15_000;

  return async (url, init) => {
    const urlStr = url.toString();
    const response = await fetch(urlStr, init);
    if (response.status !== 402) return response;

    const { accepts, rawAccepts, x402Version } = await parseRequirements(response);
    if (accepts.length === 0) {
      throw new InvalidRequirementsError("no payment options in 402 response");
    }
    // The delegated-sign endpoint only supports eip155 (EVM) variants.
    const acceptIdx = accepts.findIndex((a) => a.network.startsWith("eip155:"));
    const accept = acceptIdx >= 0 ? accepts[acceptIdx] : accepts[0];
    // rawAccept is the byte-for-byte challenge accept for this option (pre-normalisation).
    // Required for v2 deepEqual(paymentRequirements, paymentPayload.accepted) matching.
    const rawAccept = acceptIdx >= 0 ? rawAccepts[acceptIdx] : rawAccepts[0];
    if (!accept.network.startsWith("eip155:")) {
      throw new InvalidRequirementsError(
        `delegated-sign requires an eip155 variant, got ${accept.network}`,
      );
    }

    // Derive ArisPay's `chain` label from CAIP-2.
    const chainId = Number.parseInt(accept.network.split(":")[1] ?? "", 10);
    const chainLabel = CHAIN_LABELS[chainId];
    if (!chainLabel) {
      throw new InvalidRequirementsError(`Unsupported chainId for delegated-sign: ${chainId}`);
    }

    // Ask ArisPay to sign.
    //
    // We forward the RAW challenge accept object as `acceptedRequirement` so
    // the server can use it verbatim as `paymentPayload.accepted`. x402 v2's
    // findMatchingRequirements uses deepEqual(paymentRequirements, payload.accepted) —
    // any added/missing field breaks the match silently (402 with {}). Do NOT
    // modify or normalise fields between here and the signer.
    const signRes = await fetch(`${baseUrl}${signPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        paymentRequirements: {
          chain: chainLabel,
          tokenAddress: accept.asset,
          payeeAddress: accept.payTo,
          amount: accept.amount,
          extra: accept.extra,
        },
        resourceUrl: urlStr,
        x402Version,
        acceptedRequirement: rawAccept,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!signRes.ok) {
      const body = (await signRes.json().catch(() => ({}))) as { error?: { message?: string } };
      const msg = body?.error?.message ?? `${signRes.status} ${signRes.statusText}`;
      throw new PaymentRejectedError(signRes.status, `ArisPay delegated-sign rejected: ${msg}`);
    }

    const signed = (await signRes.json()) as DelegatedSignResponse;
    if (signed.status === "failed" || !signed.paymentHeader) {
      throw new PaymentRejectedError(502, "ArisPay delegated-sign returned no header");
    }

    if (config.onPayment && signed.spend) {
      const { amountCents, dailySpend, monthlySpend, limits } = signed.spend;
      try {
        config.onPayment({
          amountCents,
          chain: signed.chain,
          walletAddress: signed.walletAddress,
          dailySpend,
          monthlySpend,
          limits,
          remainingDaily: Math.max(0, limits.maxDaily - dailySpend),
          remainingMonthly: Math.max(0, limits.maxMonthly - monthlySpend),
        });
      } catch {
        // Advisory metadata must never break the payment flow.
      }
    }

    // Debug: dump the decoded X-PAYMENT so we can diagnose verifier rejects.
    // Enable with PAYAGENT_DEBUG=1. Prints to stderr so it doesn't corrupt
    // stdout piping. Contains only public challenge data + a signature.
    if (process.env.PAYAGENT_DEBUG === "1") {
      try {
        const decoded = Buffer.from(signed.paymentHeader, "base64").toString("utf-8");
        process.stderr.write(`[payagent] X-PAYMENT (decoded): ${decoded}\n`);
      } catch {
        process.stderr.write(`[payagent] X-PAYMENT (base64): ${signed.paymentHeader}\n`);
      }
    }

    // Retry with the X-PAYMENT header.
    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set("X-PAYMENT", signed.paymentHeader);
    const paid = await fetch(urlStr, { ...init, headers: retryHeaders });
    if (paid.status === 402) {
      // Read the seller's response body so callers can see the verifier's
      // actual rejection reason instead of a generic "server returned 402".
      const body = await paid.text().catch(() => "");
      throw new PaymentRejectedError(
        402,
        `Server returned 402 after payment was signed and sent. Seller response: ${body.slice(0, 1000)}`,
      );
    }
    return paid;
  };
}

// CAIP-2 chainId → ArisPay provider chain label.
const CHAIN_LABELS: Record<number, string> = {
  1: "ethereum",
  137: "polygon",
  8453: "base",
  84532: "base-sepolia",
};
