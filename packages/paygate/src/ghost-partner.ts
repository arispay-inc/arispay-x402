/**
 * Ghost Pay — partner SDK.
 *
 * Strategic partners (e.g. Polymarket) use this helper to create payment links
 * and verify Ghost Pay webhooks from their server-side integration.
 *
 * Example:
 *   const partner = new GhostPayPartner({ apiKey: process.env.ARISPAY_API_KEY });
 *   const link = await partner.createPaymentLink({ amountCents: 1000, reference: "order-123" });
 *   // In webhook handler:
 *   const payload = partner.verifyWebhook(sig, ts, rawBody);
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface GhostPayPartnerConfig {
  /** ArisPay API base URL. Defaults to https://api.arispay.app */
  apiUrl?: string;
  /** Merchant API key issued during partner onboarding (`mp_live_*`). */
  apiKey: string;
  /** Webhook signing secret configured for the merchant. Required only for verifyWebhook. */
  webhookSecret?: string;
}

export interface GhostPaymentLink {
  linkId: string;
  token: string;
  amountCents: number;
  currency: string;
  memo: string | null;
  reference: string | null;
  status: string;
  expiresAt: string | null;
  url: string;
}

export interface GhostWebhookPayload {
  type: "ghost.payment.succeeded" | "ghost.payment.failed";
  data: {
    paymentId: string;
    merchantReference: string;
    amountCents: number;
    currency: string;
    feeCents: number;
    settlementProvider: string;
    settlementTxRef: string | null;
    reference: string | null;
    settledAt: string | null;
  };
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export class GhostPayPartner {
  private apiUrl: string;
  private apiKey: string;
  private webhookSecret?: string;

  constructor(config: GhostPayPartnerConfig) {
    this.apiUrl = (config.apiUrl ?? "https://api.arispay.app").replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret;
  }

  private async request<T>(path: string, body?: unknown): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const res = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let message = `ArisPay API error ${res.status}`;
      try {
        const json = (await res.json()) as ApiErrorBody;
        if (json.error?.message) message = json.error.message;
        if (json.error?.code) message = `${json.error.code}: ${message}`;
      } catch {
        // ignore non-JSON error bodies
      }
      throw new Error(message);
    }

    return (await res.json()) as T;
  }

  /**
   * Create a Ghost Pay payment link for the configured merchant.
   */
  async createPaymentLink(input: {
    amountCents: number;
    currency?: string;
    memo?: string;
    reference?: string;
    expiresInMinutes?: number;
  }): Promise<GhostPaymentLink> {
    return this.request<GhostPaymentLink>("/v1/merchants/me/ghost/payment-links", {
      amountCents: input.amountCents,
      currency: input.currency ?? "USD",
      memo: input.memo,
      reference: input.reference,
      expiresInMinutes: input.expiresInMinutes,
    });
  }

  /**
   * Verify the HMAC-SHA256 signature on a Ghost Pay webhook.
   *
   * Throws if the signature is missing, malformed, or does not match the
   * configured webhook secret.
   */
  verifyWebhook(
    signatureHeader: string | null | undefined,
    timestampHeader: string | null | undefined,
    rawBody: string,
  ): GhostWebhookPayload {
    if (!this.webhookSecret) {
      throw new Error("GhostPayPartner webhookSecret is required to verify webhooks");
    }
    if (!signatureHeader || !timestampHeader) {
      throw new Error("Missing Ghost webhook signature or timestamp header");
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isInteger(timestamp) || timestamp <= 0) {
      throw new Error("Invalid Ghost webhook timestamp header");
    }

    // Reject webhooks older than 5 minutes to mitigate replay attacks.
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (nowSeconds - timestamp > 300) {
      throw new Error("Ghost webhook timestamp too old");
    }

    const expected = createHmac("sha256", this.webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    const expectedBuf = Buffer.from(expected, "hex");
    const actualBuf = Buffer.from(signatureHeader, "hex");
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      throw new Error("Invalid Ghost webhook signature");
    }

    return JSON.parse(rawBody) as GhostWebhookPayload;
  }
}
