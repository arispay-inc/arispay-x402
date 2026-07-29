/**
 * payagent — Public type definitions.
 */

/** Record of a completed payment. */
export interface PaymentReceipt {
  /** The URL that was paid for. */
  url: string;
  /** USDC amount paid (human-readable, e.g. "0.10"). */
  amount: string;
  /** USDC amount in base units (e.g. "100000"). */
  amountBaseUnits: string;
  /** CAIP-2 network the payment was signed for. */
  network: string;
  /** The wallet address that received payment. */
  payTo: string;
  /** ISO timestamp of the payment. */
  timestamp: string;
}

/**
 * x402 v2 payment requirements — returned in HTTP 402 response body.
 * Standard format uses `accepts` array.
 */
export interface X402Requirements {
  x402Version: 2;
  accepts: X402Accept[];
}

/** A single payment option within a 402 response. */
export interface X402Accept {
  scheme: "exact";
  network: string;
  /** USDC amount in base units (6 decimals). x402 v2 spec name. */
  amount: string;
  /** @deprecated v1 alias for `amount`. Read-only fallback for legacy sellers. */
  maxAmountRequired?: string;
  resource: string;
  asset: string;
  payTo: string;
  extra?: { name: string; version: string };
}

/**
 * AgFac flat format — some servers return requirements as a flat object
 * instead of the standard accepts array.
 */
export interface AgfacFlatRequirements {
  x402Version: 2;
  scheme: "exact";
  network: string;
  /** USDC amount in base units. x402 v2 spec name. */
  amount?: string;
  /** v1 alias for `amount`. Accepted on parse, normalized to `amount`. */
  maxAmountRequired?: string;
  payTo: string;
  resource: string;
  asset: string;
  description?: string;
  expiry?: string;
}

/** Union of 402 response body formats payagent can handle. */
export type PaymentRequirementsBody = X402Requirements | AgfacFlatRequirements;
