/**
 * paygate v3 — x402 paywall middleware for Express and Fastify.
 *
 * Accept payment from AI agents in two lines of code. Merchants don't
 * hold keys, agents pay per-request, USDC settles in seconds on Base
 * mainnet via ArisPay's facilitator.
 *
 * Express:
 *   import { paygate } from 'paygate/express';
 *   const pw = paygate({ merchantId: process.env.PAYGATE_MERCHANT_ID });
 *   app.get('/api/data', pw({ priceCents: 10 }), handler);
 *
 * Fastify:
 *   import paygate from 'paygate/fastify';
 *   await app.register(paygate, { merchantId: process.env.PAYGATE_MERCHANT_ID });
 *   app.get('/api/data', { config: { paygate: { priceCents: 10 } } }, handler);
 *
 * v2 callers (`wallet` + `network` + `price`) keep working via a compat
 * shim; a deprecation warning fires on first use. The shim is removed
 * in v4.
 */

// Core (framework-agnostic)
export { handlePaywall, DEFAULT_FACILITATOR, DEFAULT_API_URL } from "./core.js";
export type {
  PaygateConfig,
  PaygateCurrency,
  RoutePrice,
  PaywallResult,
  DiscoveryRateLimitConfig,
} from "./core.js";

// Express
export { paygate } from "./express.js";

// Fastify
export { paygatePlugin } from "./fastify.js";
export { default as paygatePluginDefault } from "./fastify.js";

// Ghost Pay — strategic partner SDK
export { GhostPayPartner } from "./ghost-partner.js";
export type {
  GhostPayPartnerConfig,
  GhostPaymentLink,
  GhostWebhookPayload,
} from "./ghost-partner.js";
