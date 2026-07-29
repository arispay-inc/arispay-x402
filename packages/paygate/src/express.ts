/**
 * paygate/express — Express middleware for x402 paywalls (v3).
 *
 * Usage (v3):
 *   import express from 'express';
 *   import { paygate } from 'paygate/express';
 *
 *   const app = express();
 *
 *   // v3: one knob — merchantId. SDK fetches the rest from api.arispay.app.
 *   const pw = paygate({ merchantId: process.env.PAYGATE_MERCHANT_ID });
 *
 *   app.get('/api/data', pw({ priceCents: 10 }), (req, res) => {
 *     res.json({ data: 'premium content' });
 *   });
 *
 *   // Dynamic pricing
 *   app.post('/api/analyse', pw({
 *     priceCents: (req) => req.body.deep ? 50 : 10,
 *     description: 'AI analysis',
 *   }), handler);
 *
 * v2 config (`wallet` + `network`) still works via the compat shim.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { type PaygateConfig, type RoutePrice, handlePaywall } from "./core.js";

export type { PaygateConfig, RoutePrice };

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]!.trim();
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Create a paywall middleware factory.
 */
export function paygate(config: PaygateConfig) {
  return function paywall(routePrice: RoutePrice): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      const resourceUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
      const paymentHeader = req.headers["x-payment"] as string | undefined;
      const clientIp = getClientIp(req);

      // Resolve dynamic price functions against the real request.
      const resolved: RoutePrice = { ...routePrice };
      if (typeof routePrice.priceCents === "function") {
        resolved.priceCents = await routePrice.priceCents(req);
      }
      if (typeof routePrice.price === "function") {
        resolved.price = await routePrice.price(req);
      }

      const result = await handlePaywall(config, resolved, resourceUrl, paymentHeader, clientIp);

      if (result.paid) {
        // Attach settlement + emit receipt header — body stays pristine
        (req as any).paygate = result.receipt ?? { paid: true };
        if (result.receipt) {
          res.setHeader("X-Paygate-Receipt", JSON.stringify(result.receipt));
        }
        return next();
      }

      if (result.challenge) {
        for (const [key, value] of Object.entries(result.challenge.headers)) {
          res.setHeader(key, value);
        }
        return res.status(402).json(result.challenge.body);
      }

      if (result.error) {
        return res.status(result.error.statusCode).json(result.error.body);
      }
    };
  };
}
