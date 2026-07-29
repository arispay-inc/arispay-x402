import { ethers } from "ethers";
import { InvalidRequirementsError, PaymentRejectedError } from "./errors.js";
/**
 * payagent — Local-signer fetch wrapper (permissionless mode).
 *
 * Signs EIP-3009 `transferWithAuthorization` locally with ethers and settles
 * through whatever facilitator the *seller* uses. No ArisPay account, no
 * API key, no provisioning — `npm install payagent` plus a funded key is the
 * whole setup. This is the mode that makes payagent a drop-in x402 client
 * for the open ecosystem.
 *
 * Trade-offs vs `payFetchDelegated` (the custody mode), stated honestly:
 * spend limits, allowedDomains, suspension, and the payment feed are
 * server-side features of the delegated model and do NOT exist here — the
 * only guardrail is the optional per-transaction cap below, which is
 * client-side and therefore self-enforced. The private key lives in your
 * process; treat it accordingly (a dedicated low-balance wallet is the
 * intended pattern).
 *
 * Usage:
 *   const fetch402 = payFetchLocal({ privateKey: process.env.PRIVATE_KEY! });
 *   const res = await fetch402('https://api.example.com/premium');
 */
import { parseRequirements } from "./payment.js";

export interface PayFetchLocalConfig {
  /** Hex-encoded private key (`0x…`) of the EOA that pays. */
  privateKey: string;
  /**
   * Optional per-payment cap in the accepted asset's base units (USDC has 6
   * decimals, so "1000000" = $1.00). A 402 asking for more throws
   * `PaymentRejectedError` instead of signing. Client-side guardrail only.
   */
  maxPerTxBaseUnits?: string | bigint;
  /**
   * Fires once per paid request, right after signing. Advisory: a throwing
   * callback is swallowed and never breaks the payment flow.
   */
  onPayment?: (info: LocalPaymentInfo) => void;
}

export interface LocalPaymentInfo {
  /** Amount paid, in the asset's base units. */
  amount: string;
  /** CAIP-2 network the payment settled on. */
  network: string;
  asset: string;
  payTo: string;
  /** The EOA that paid (derived from the configured key). */
  walletAddress: string;
}

export type { PayFetchFn } from "./fetch-delegated.js";
import type { PayFetchFn } from "./fetch-delegated.js";

// EIP-712 `TransferWithAuthorization` — the EIP-3009 typehash fields.
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

/**
 * Create a fetch wrapper that pays x402 402s by signing locally. Mirrors
 * `payFetchDelegated`'s flow (parse → sign → retry with X-PAYMENT) with the
 * server round-trip replaced by local EIP-712 signing.
 */
export function payFetchLocal(config: PayFetchLocalConfig): PayFetchFn {
  if (!config.privateKey) throw new Error("privateKey is required");
  const wallet = new ethers.Wallet(config.privateKey);
  const maxPerTx =
    config.maxPerTxBaseUnits !== undefined ? BigInt(config.maxPerTxBaseUnits) : undefined;

  return async (url, init) => {
    const urlStr = url.toString();
    const response = await fetch(urlStr, init);
    if (response.status !== 402) return response;

    const { accepts, rawAccepts, x402Version } = await parseRequirements(response);
    if (accepts.length === 0) {
      throw new InvalidRequirementsError("no payment options in 402 response");
    }
    // Local signing is EVM-only today (EIP-3009); pick the first eip155 option.
    const acceptIdx = accepts.findIndex((a) => a.network.startsWith("eip155:"));
    if (acceptIdx < 0) {
      throw new InvalidRequirementsError(
        `local signer requires an eip155 variant, got ${accepts[0]?.network ?? "none"}`,
      );
    }
    const accept = accepts[acceptIdx]!;
    // The byte-for-byte challenge accept, used verbatim as
    // `paymentPayload.accepted` — x402 v2's findMatchingRequirements is a
    // deepEqual, so any added/missing field silently breaks the match.
    const rawAccept = rawAccepts[acceptIdx];

    if (maxPerTx !== undefined && BigInt(accept.amount) > maxPerTx) {
      throw new PaymentRejectedError(
        402,
        `402 asks ${accept.amount} base units, above maxPerTxBaseUnits ${maxPerTx}`,
      );
    }

    // The EIP-712 domain must come from the seller's requirements — every
    // token deployment has its own (name, version, chainId, contract), and a
    // wrong one produces a valid-looking signature that recovers wrong.
    const domainInfo = accept.extra;
    if (!domainInfo?.name || !domainInfo?.version) {
      throw new InvalidRequirementsError(
        "402 accept is missing extra.name/extra.version (EIP-712 domain) — cannot sign locally",
      );
    }
    const chainId = Number.parseInt(accept.network.split(":")[1] ?? "", 10);
    if (!Number.isFinite(chainId)) {
      throw new InvalidRequirementsError(`cannot parse chainId from network ${accept.network}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const authorization = {
      from: wallet.address,
      to: accept.payTo,
      value: accept.amount,
      validAfter: (now - 60).toString(),
      validBefore: (now + 480).toString(), // 8-minute window, mirrors x402-core signing
      nonce: ethers.hexlify(ethers.randomBytes(32)),
    };

    const signature = await wallet.signTypedData(
      {
        name: domainInfo.name,
        version: domainInfo.version,
        chainId,
        verifyingContract: ethers.getAddress(accept.asset),
      },
      TRANSFER_WITH_AUTHORIZATION_TYPES,
      {
        from: ethers.getAddress(authorization.from),
        to: ethers.getAddress(authorization.to),
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
    );

    const paymentHeader = Buffer.from(
      JSON.stringify({
        x402Version: x402Version ?? 2,
        payload: { signature, authorization },
        accepted: rawAccept,
        // v2 PaymentPayload.resource is a ResourceInfo object, not a bare
        // string (spec + what bazaar discovery extraction reads).
        resource: { url: accept.resource },
      }),
    ).toString("base64");

    if (config.onPayment) {
      try {
        config.onPayment({
          amount: accept.amount,
          network: accept.network,
          asset: accept.asset,
          payTo: accept.payTo,
          walletAddress: wallet.address,
        });
      } catch {
        // Advisory metadata must never break the payment flow.
      }
    }

    if (process.env.PAYAGENT_DEBUG === "1") {
      try {
        const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8");
        process.stderr.write(`[payagent] X-PAYMENT (decoded): ${decoded}\n`);
      } catch {
        process.stderr.write(`[payagent] X-PAYMENT (base64): ${paymentHeader}\n`);
      }
    }

    // Retry with the X-PAYMENT header.
    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set("X-PAYMENT", paymentHeader);
    const paid = await fetch(urlStr, { ...init, headers: retryHeaders });
    if (paid.status === 402) {
      // Surface the verifier's actual rejection reason, not a generic 402.
      const body = await paid.text().catch(() => "");
      throw new PaymentRejectedError(
        402,
        `Server returned 402 after payment was signed and sent. Seller response: ${body.slice(0, 1000)}`,
      );
    }
    return paid;
  };
}
