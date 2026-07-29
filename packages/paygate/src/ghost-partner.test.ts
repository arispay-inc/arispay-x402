/**
 * Unit tests for the GhostPayPartner SDK helper.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GhostPayPartner } from "./ghost-partner.js";

describe("GhostPayPartner", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("createPaymentLink", () => {
    it("POSTs to the merchant payment-link endpoint", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          linkId: "link_1",
          token: "tok",
          amountCents: 1000,
          currency: "USD",
          memo: null,
          reference: "ref",
          status: "open",
          expiresAt: null,
          url: "https://arispay.app/ghost/pay/tok",
        }),
      });

      const partner = new GhostPayPartner({ apiKey: "mp_live_test" });
      const link = await partner.createPaymentLink({
        amountCents: 1000,
        reference: "ref",
      });

      expect(link.url).toBe("https://arispay.app/ghost/pay/tok");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.arispay.app/v1/merchants/me/ghost/payment-links",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer mp_live_test",
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("throws on API error", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: "INVALID_REQUEST", message: "bad" } }),
      });

      const partner = new GhostPayPartner({ apiKey: "mp_live_test" });
      await expect(partner.createPaymentLink({ amountCents: -1 })).rejects.toThrow(
        "INVALID_REQUEST: bad",
      );
    });
  });

  describe("verifyWebhook", () => {
    it("returns the payload when the signature is valid", () => {
      const secret = "super-secret-webhook-key";
      const partner = new GhostPayPartner({ apiKey: "mp_live_test", webhookSecret: secret });

      const payload = {
        type: "ghost.payment.succeeded" as const,
        data: {
          paymentId: "gp_1",
          merchantReference: "ref-1",
          amountCents: 1000,
          currency: "USD",
          feeCents: 15,
          settlementProvider: "usdc",
          settlementTxRef: "0xabc",
          reference: "order-123",
          settledAt: "2026-06-17T00:00:00.000Z",
        },
      };
      const body = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac("sha256", secret)
        .update(`${timestamp}.${body}`)
        .digest("hex");

      const result = partner.verifyWebhook(signature, String(timestamp), body);
      expect(result.type).toBe("ghost.payment.succeeded");
      expect(result.data.paymentId).toBe("gp_1");
    });

    it("throws when the signature is invalid", () => {
      const partner = new GhostPayPartner({
        apiKey: "mp_live_test",
        webhookSecret: "secret",
      });
      const ts = String(Math.floor(Date.now() / 1000));
      expect(() => partner.verifyWebhook("bad", ts, "{}")).toThrow("Invalid Ghost webhook signature");
    });

    it("throws when the timestamp is too old", () => {
      const partner = new GhostPayPartner({
        apiKey: "mp_live_test",
        webhookSecret: "secret",
      });
      const oldTs = String(Math.floor(Date.now() / 1000) - 400);
      expect(() => partner.verifyWebhook("a".repeat(64), oldTs, "{}")).toThrow("too old");
    });
  });
});
