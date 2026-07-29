/**
 * paygate/fastify — Fastify plugin for x402 paywalls (v3).
 *
 * Usage (v3):
 *   import Fastify from 'fastify';
 *   import paygate from 'paygate/fastify';
 *
 *   const app = Fastify();
 *   await app.register(paygate, { merchantId: process.env.PAYGATE_MERCHANT_ID });
 *
 *   // Route-config-driven paywall
 *   app.get('/api/data',
 *     { config: { paygate: { priceCents: 10 } } },
 *     async (req, reply) => reply.send({ data: 'premium' })
 *   );
 *
 *   // Or imperative
 *   app.get('/api/premium', async (req, reply) => {
 *     const { paid } = await req.paygatePay({ priceCents: 25 });
 *     if (!paid) return;
 *     reply.send({ data: '...' });
 *   });
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { type PaygateConfig, type RoutePrice, handlePaywall } from "./core.js";

export type { PaygateConfig, RoutePrice };

declare module "fastify" {
  interface FastifyRequest {
    paygate?: {
      paid: boolean;
      txHash?: string;
      trustTier?: string;
      merchant?: string;
    };
    paygatePay: (routePrice: RoutePrice) => Promise<{ paid: boolean }>;
  }
  interface FastifyContextConfig {
    paygate?: RoutePrice;
    /** @deprecated — v2 key. Use `paygate` instead. */
    x402?: RoutePrice;
  }
}

function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]!.trim();
  return request.ip;
}

async function resolveRoutePrice(
  routePrice: RoutePrice,
  request: FastifyRequest,
): Promise<RoutePrice> {
  const out: RoutePrice = { ...routePrice };
  if (typeof routePrice.priceCents === "function") {
    out.priceCents = await routePrice.priceCents(request);
  }
  if (typeof routePrice.price === "function") {
    out.price = await routePrice.price(request);
  }
  return out;
}

const paygatePlugin: FastifyPluginAsync<PaygateConfig> = async (
  fastify: FastifyInstance,
  config: PaygateConfig,
) => {
  fastify.decorateRequest("paygate", undefined as any);
  fastify.decorateRequest("paygatePay", (async (_routePrice: RoutePrice) => ({
    paid: false,
  })) as any);

  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const clientIp = getClientIp(request);

    request.paygatePay = async (routePrice: RoutePrice) => {
      const resourceUrl = `${request.protocol}://${request.hostname}${request.url}`;
      const paymentHeader = request.headers["x-payment"] as string | undefined;
      const resolved = await resolveRoutePrice(routePrice, request);
      const result = await handlePaywall(config, resolved, resourceUrl, paymentHeader, clientIp);

      if (result.paid) {
        request.paygate = result.receipt ?? { paid: true };
        if (result.receipt) {
          reply.header("X-Paygate-Receipt", JSON.stringify(result.receipt));
        }
        return { paid: true };
      }

      if (result.challenge) {
        for (const [key, value] of Object.entries(result.challenge.headers)) {
          reply.header(key, value);
        }
        reply.status(402).send(result.challenge.body);
        return { paid: false };
      }

      if (result.error) {
        reply.status(result.error.statusCode).send(result.error.body);
        return { paid: false };
      }

      return { paid: false };
    };

    const ctx = (request.routeOptions?.config as any) ?? {};
    const routePrice = (ctx.paygate ?? ctx.x402) as RoutePrice | undefined;
    if (routePrice) {
      const { paid } = await request.paygatePay(routePrice);
      if (!paid) return;
    }
  });
};

export default paygatePlugin;
export { paygatePlugin };
