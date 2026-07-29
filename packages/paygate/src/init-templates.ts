/**
 * `paygate init` — template generation.
 *
 * Pure functions only: every generator returns `{ path, content }[]` and
 * never touches the filesystem, so the whole surface is unit-testable.
 *
 * Two families of template:
 *
 * 1. Account-free x402 seller (default). Uses the upstream `@x402/*`
 *    packages (`@x402/express`, `@x402/fastify`, `@x402/hono`,
 *    `@x402/next`, or the `x402` pip package) pointed at a facilitator.
 *    No ArisPay account, no API key — just a wallet address that
 *    receives the funds. Modeled on `examples/x402-demo/server.js`,
 *    which is proven live against facilitator.arispay.app.
 *
 * 2. Hosted PayGate mode (`--merchant-id`, express/fastify only).
 *    Uses this package's own SDK (`paygate({ merchantId })`); payout
 *    wallet / network / facilitator come from the merchant's capability
 *    manifest. Requires a merchant account at paygate.arispay.app.
 *
 * Network truthfulness: the public ArisPay facilitator settles Base
 * MAINNET only. Testnet (`base-sepolia`, the default) templates point
 * FACILITATOR_URL at Coinbase's public testnet facilitator
 * (https://x402.org/facilitator) and say so; production templates
 * (`--network base`) default to https://facilitator.arispay.app.
 */

export type InitFramework = "express" | "fastify" | "next" | "hono" | "workers" | "fastapi";
export type InitNetwork = "base" | "base-sepolia";
export type InitCurrency = "USD" | "EUR";
export type InitMethod = "GET" | "POST" | "PUT" | "DELETE";

export const INIT_FRAMEWORKS: readonly InitFramework[] = [
  "express",
  "fastify",
  "next",
  "hono",
  "workers",
  "fastapi",
];

export const MAINNET_FACILITATOR = "https://facilitator.arispay.app";
/** Coinbase's public testnet facilitator — used by the upstream x402 examples. */
export const TESTNET_FACILITATOR = "https://x402.org/facilitator";

export const CAIP2: Record<InitNetwork, string> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
};

/**
 * Circle EURC on Base mainnet — address + EIP-712 domain verified on-chain
 * (see packages/paygate/src/core.ts EURC_ADDRESSES). EUR templates are
 * restricted to `base` because the testnet default facilitator does not
 * settle EURC.
 */
export const EURC_BASE_MAINNET = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42";

export interface TemplateOptions {
  framework: InitFramework;
  /** 0x-prefixed 40-hex EVM address. Public — safe to write to .env.example. May be absent in --dry-run. */
  wallet?: string;
  /** Paid route path, starts with "/". */
  route: string;
  method: InitMethod;
  /** Integer cents (USD or EUR). */
  priceCents: number;
  currency: InitCurrency;
  network: InitNetwork;
  /** Hosted PayGate mode (express/fastify only). */
  merchantId?: string;
  /** Directory-name-ish project name, used in package.json / wrangler.toml. */
  projectName: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

export function defaultFacilitatorFor(network: InitNetwork): string {
  return network === "base" ? MAINNET_FACILITATOR : TESTNET_FACILITATOR;
}

/** "$0.01"-style money string from integer cents. */
export function centsToMoneyString(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const rem = cents % 100;
  return `$${dollars}.${String(rem).padStart(2, "0")}`;
}

/** cents → 6-decimal atomic units (USDC/EURC): cents * 10^4. */
export function centsToAtomic(cents: number): string {
  return (BigInt(cents) * BigInt(10_000)).toString();
}

function humanPrice(opts: TemplateOptions): string {
  const base = centsToMoneyString(opts.priceCents);
  return opts.currency === "EUR" ? `${base.replace("$", "€")} (EURC)` : base;
}

/**
 * The x402 `price` value as a JS expression string.
 * USD → money string ("$0.01"); the upstream server resolves it to USDC.
 * EUR → explicit AssetAmount pinning Circle EURC on Base mainnet.
 */
function priceExprJs(opts: TemplateOptions): string {
  if (opts.currency === "EUR") {
    return [
      `{`,
      `          // Circle EURC on Base mainnet — ${opts.priceCents} EUR cents as 6-decimal atomic units (cents * 10^4).`,
      `          asset: '${EURC_BASE_MAINNET}',`,
      `          amount: '${centsToAtomic(opts.priceCents)}',`,
      `          extra: { name: 'EURC', version: '2' },`,
      `        }`,
    ].join("\n");
  }
  return `'${centsToMoneyString(opts.priceCents)}'`;
}

function priceExprPy(opts: TemplateOptions): string {
  if (opts.currency === "EUR") {
    return (
      `{\n` +
      `        # Circle EURC on Base mainnet — ${opts.priceCents} EUR cents as 6-decimal atomic units (cents * 10^4).\n` +
      `        "asset": "${EURC_BASE_MAINNET}",\n` +
      `        "amount": "${centsToAtomic(opts.priceCents)}",\n` +
      `        "extra": {"name": "EURC", "version": "2"},\n` +
      `    }`
    );
  }
  return `"${centsToMoneyString(opts.priceCents)}"`;
}

function networkBanner(opts: TemplateOptions): string {
  if (opts.network === "base") {
    return (
      `// Production: Base mainnet (eip155:8453), settled by the ArisPay facilitator\n` +
      `// (${MAINNET_FACILITATOR}) — no facilitator fee; the seller pays chain gas.`
    );
  }
  return (
    `// Testnet: Base Sepolia (eip155:84532). The public ArisPay facilitator\n` +
    `// (${MAINNET_FACILITATOR}) settles Base MAINNET ONLY, so this template\n` +
    `// defaults FACILITATOR_URL to Coinbase's public testnet facilitator\n` +
    `// (${TESTNET_FACILITATOR}). For production, switch NETWORK to 'base' and\n` +
    `// FACILITATOR_URL to ${MAINNET_FACILITATOR}.`
  );
}

function envExample(opts: TemplateOptions): string {
  const lines: string[] = [
    `# Wallet (EVM address) that receives settled funds.`,
    `# A wallet ADDRESS is public information — safe to commit. Never put a`,
    `# private key or API key in this file.`,
    `PAY_TO_ADDRESS=${opts.wallet ?? ""}`,
    ``,
    `# x402 facilitator used for verify + settle.`,
  ];
  if (opts.network === "base") {
    lines.push(
      `# Production default: the ArisPay facilitator (Base mainnet, USDC + EURC).`,
      `FACILITATOR_URL=${MAINNET_FACILITATOR}`,
    );
  } else {
    lines.push(
      `# Testnet default: Coinbase's public testnet facilitator. The ArisPay`,
      `# facilitator (${MAINNET_FACILITATOR}) settles Base MAINNET ONLY —`,
      `# switch to it (and NETWORK=base) when you go to production.`,
      `FACILITATOR_URL=${TESTNET_FACILITATOR}`,
    );
  }
  lines.push(``, `# Port for the local server.`, `PORT=3000`, ``);
  return lines.join("\n");
}

const GITIGNORE = `node_modules/
dist/
.env
.dev.vars
__pycache__/
.venv/
`;

function curlExample(opts: TemplateOptions, port: number): string {
  const methodFlag = opts.method === "GET" ? "" : ` -X ${opts.method}`;
  return `curl -i${methodFlag} http://localhost:${port}${opts.route}`;
}

function readmeCommon(opts: TemplateOptions, runCmd: string, port: number): string {
  const testnet = opts.network === "base-sepolia";
  return `## Test the 402

\`\`\`bash
${curlExample(opts, port)}
\`\`\`

You should see \`HTTP/1.1 402 Payment Required\` with a JSON body listing the
payment requirements (asset, amount, payTo, network). That 402 body is the
whole protocol surface — any x402-capable client can take it from there.

## Pay it end-to-end without risking real funds

${
  testnet
    ? `This template targets **Base Sepolia** (testnet), so full payment loops move
testnet USDC only. Fund a testnet wallet from a Base Sepolia faucet, then use
any x402 client (for example \`npx payagent pay <url>\`, or the upstream
\`@x402/fetch\` client) against your route.`
    : `This template targets **Base mainnet** — payments move real USDC${opts.currency === "EUR" ? "/EURC" : ""}.
To rehearse without moving real funds first, re-run \`npx paygate init\` with
\`--network base-sepolia\` and test the same code path on testnet, or just
inspect the 402 challenge with the curl above (issuing the challenge never
moves funds — money only moves when a payer signs and the facilitator
settles).`
}

## Discovery (Bazaar)

The paid route declares an x402 Bazaar discovery extension. Once your endpoint
is live and the first payment verifies through a Bazaar-participating
facilitator, the resource becomes eligible for the public x402 catalog — no
extra registration step.

## Learn more

- Machine-readable facilitator docs: https://facilitator.arispay.app/llms.txt
- Live facilitator policy (networks/assets/fees): https://facilitator.arispay.app/supported

## Run

\`\`\`bash
${runCmd}
\`\`\`
`;
}

// ── Direct-mode templates (upstream @x402/*) ───────────────────────────

function jsRouteConfig(opts: TemplateOptions, resourceIndent = ""): string {
  // Route config for @x402 paymentMiddleware-style APIs (RouteConfig from
  // @x402/core 2.8: accepts, description, mimeType, extensions).
  const i = resourceIndent;
  return `{
${i}      accepts: {
${i}        scheme: 'exact',
${i}        price: ${priceExprJs(opts)},
${i}        network: NETWORK_CAIP2,
${i}        payTo: PAY_TO_ADDRESS,
${i}        maxTimeoutSeconds: 60,
${i}      },
${i}      description: 'Paid ${opts.method} ${opts.route} (${humanPrice(opts)})',
${i}      mimeType: 'application/json',
${i}      // Bazaar discovery declaration — makes the route eligible for the
${i}      // public x402 catalog after its first successful verify.
${i}      extensions: declareDiscoveryExtension({
${i}        output: { example: { ok: true, data: 'paid content' } },
${i}      }),
${i}    }`;
}

function jsHeader(opts: TemplateOptions, framework: string): string {
  return `/**
 * x402 seller (${framework}) — generated by \`npx paygate init\`.
 *
 * Routes:
 *   GET /health           unpaid health check
 *   ${opts.method.padEnd(4)}${opts.route.padEnd(18)}${humanPrice(opts)} per request, gated by x402
 *
${networkBanner(opts)
  .split("\n")
  .map((l) => ` ${l.replace(/^\/\//, "*")}`)
  .join("\n")}
 */`;
}

function commonJsConsts(opts: TemplateOptions): string {
  return `const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS;
const FACILITATOR_URL = process.env.FACILITATOR_URL || '${defaultFacilitatorFor(opts.network)}';
const NETWORK = process.env.NETWORK || '${opts.network}';
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!PAY_TO_ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(PAY_TO_ADDRESS)) {
  console.error('PAY_TO_ADDRESS env var is required and must be a 0x-prefixed EVM address');
  process.exit(1);
}

const NETWORK_TO_CAIP2 = {
  'base-sepolia': '${CAIP2["base-sepolia"]}',
  'base': '${CAIP2.base}',
};
const NETWORK_CAIP2 = NETWORK_TO_CAIP2[NETWORK] || NETWORK;`;
}

function expressServerJs(opts: TemplateOptions): string {
  return `${jsHeader(opts, "Express")}
import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';

${commonJsConsts(opts)}

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  NETWORK_CAIP2,
  new ExactEvmScheme(),
);

const app = express();

// Health check — unprotected.
app.get('/health', (_req, res) => {
  res.json({ ok: true, network: NETWORK, facilitator: FACILITATOR_URL });
});

// Paywall — every matching request must carry a valid X-PAYMENT header.
app.use(
  paymentMiddleware(
    {
      '${opts.method} ${opts.route}': ${jsRouteConfig(opts)},
    },
    resourceServer,
  ),
);

// Protected resource. Only reached after payment settles.
app.${opts.method.toLowerCase()}('${opts.route}', (_req, res) => {
  res.json({ ok: true, data: 'paid content', servedAt: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(\`x402 seller listening on :\${PORT}\`);
  console.log(\`network=\${NETWORK} price=${humanPrice(opts).replace(/'/g, "")} payTo=\${PAY_TO_ADDRESS}\`);
  console.log(\`facilitator=\${FACILITATOR_URL}\`);
});
`;
}

function fastifyServerJs(opts: TemplateOptions): string {
  return `${jsHeader(opts, "Fastify")}
import Fastify from 'fastify';
import { paymentMiddleware, x402ResourceServer } from '@x402/fastify';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';

${commonJsConsts(opts)}

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  NETWORK_CAIP2,
  new ExactEvmScheme(),
);

const app = Fastify({ logger: true });

// Health check — unprotected.
app.get('/health', async () => ({ ok: true, network: NETWORK, facilitator: FACILITATOR_URL }));

// Paywall — every matching request must carry a valid X-PAYMENT header.
paymentMiddleware(
  app,
  {
    '${opts.method} ${opts.route}': ${jsRouteConfig(opts)},
  },
  resourceServer,
);

// Protected resource. Only reached after payment settles.
app.${opts.method.toLowerCase()}('${opts.route}', async () => ({
  ok: true,
  data: 'paid content',
  servedAt: new Date().toISOString(),
}));

app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  console.log(\`x402 seller listening on :\${PORT} network=\${NETWORK} facilitator=\${FACILITATOR_URL}\`);
});
`;
}

function honoServerJs(opts: TemplateOptions): string {
  return `${jsHeader(opts, "Hono")}
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { paymentMiddleware, x402ResourceServer } from '@x402/hono';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';

${commonJsConsts(opts)}

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  NETWORK_CAIP2,
  new ExactEvmScheme(),
);

const app = new Hono();

// Health check — unprotected.
app.get('/health', (c) => c.json({ ok: true, network: NETWORK, facilitator: FACILITATOR_URL }));

// Paywall — every matching request must carry a valid X-PAYMENT header.
app.use(
  paymentMiddleware(
    {
      '${opts.method} ${opts.route}': ${jsRouteConfig(opts)},
    },
    resourceServer,
  ),
);

// Protected resource. Only reached after payment settles.
app.${opts.method.toLowerCase()}('${opts.route}', (c) =>
  c.json({ ok: true, data: 'paid content', servedAt: new Date().toISOString() }),
);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(\`x402 seller listening on :\${PORT} network=\${NETWORK} facilitator=\${FACILITATOR_URL}\`);
});
`;
}

function workersIndexJs(opts: TemplateOptions): string {
  return `${jsHeader(opts, "Cloudflare Workers + Hono")}
import { Hono } from 'hono';
import { paymentMiddleware, x402ResourceServer } from '@x402/hono';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';

const NETWORK_TO_CAIP2 = {
  'base-sepolia': '${CAIP2["base-sepolia"]}',
  'base': '${CAIP2.base}',
};

const app = new Hono();

// Health check — unprotected.
app.get('/health', (c) =>
  c.json({ ok: true, network: c.env.NETWORK, facilitator: c.env.FACILITATOR_URL }),
);

// Workers expose env bindings per-request (c.env), not at module scope, so
// the x402 middleware is built lazily on first request and reused after.
let x402;
app.use('*', async (c, next) => {
  if (!x402) {
    const PAY_TO_ADDRESS = c.env.PAY_TO_ADDRESS;
    if (!PAY_TO_ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(PAY_TO_ADDRESS)) {
      return c.json({ error: 'PAY_TO_ADDRESS var is required (see wrangler.toml [vars])' }, 500);
    }
    const FACILITATOR_URL = c.env.FACILITATOR_URL || '${defaultFacilitatorFor(opts.network)}';
    const NETWORK = c.env.NETWORK || '${opts.network}';
    const NETWORK_CAIP2 = NETWORK_TO_CAIP2[NETWORK] || NETWORK;
    const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
    const resourceServer = new x402ResourceServer(facilitatorClient).register(
      NETWORK_CAIP2,
      new ExactEvmScheme(),
    );
    x402 = paymentMiddleware(
      {
        '${opts.method} ${opts.route}': {
          accepts: {
            scheme: 'exact',
            price: ${priceExprJs(opts)},
            network: NETWORK_CAIP2,
            payTo: PAY_TO_ADDRESS,
            maxTimeoutSeconds: 60,
          },
          description: 'Paid ${opts.method} ${opts.route} (${humanPrice(opts)})',
          mimeType: 'application/json',
          // Bazaar discovery declaration — makes the route eligible for the
          // public x402 catalog after its first successful verify.
          extensions: declareDiscoveryExtension({
            output: { example: { ok: true, data: 'paid content' } },
          }),
        },
      },
      resourceServer,
    );
  }
  return x402(c, next);
});

// Protected resource. Only reached after payment settles.
app.${opts.method.toLowerCase()}('${opts.route}', (c) =>
  c.json({ ok: true, data: 'paid content', servedAt: new Date().toISOString() }),
);

export default app;
`;
}

function wranglerToml(opts: TemplateOptions): string {
  return `name = "${opts.projectName}"
main = "src/index.js"
compatibility_date = "2026-07-01"
compatibility_flags = ["nodejs_compat"]

[vars]
# Wallet (EVM address) that receives settled funds. A wallet ADDRESS is
# public information — safe to commit. Never put a private key here.
PAY_TO_ADDRESS = "${opts.wallet ?? ""}"
${
  opts.network === "base"
    ? `# Production: the ArisPay facilitator (Base mainnet, USDC + EURC).
FACILITATOR_URL = "${MAINNET_FACILITATOR}"`
    : `# Testnet default: Coinbase's public testnet facilitator. The ArisPay
# facilitator (${MAINNET_FACILITATOR}) settles Base MAINNET ONLY —
# switch to it (and NETWORK = "base") when you go to production.
FACILITATOR_URL = "${TESTNET_FACILITATOR}"`
}
NETWORK = "${opts.network}"
`;
}

function nextRouteFileDir(route: string): string {
  // "/api/paid" → "app/api/paid" (App Router route handler directory).
  return `app${route.replace(/\/+$/, "")}`;
}

function nextLibX402Js(opts: TemplateOptions): string {
  return `${jsHeader(opts, "Next.js (App Router)")}
import { x402ResourceServer } from '@x402/next';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';

export const FACILITATOR_URL = process.env.FACILITATOR_URL || '${defaultFacilitatorFor(opts.network)}';
export const NETWORK = process.env.NETWORK || '${opts.network}';
export const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS;

const NETWORK_TO_CAIP2 = {
  'base-sepolia': '${CAIP2["base-sepolia"]}',
  'base': '${CAIP2.base}',
};
export const NETWORK_CAIP2 = NETWORK_TO_CAIP2[NETWORK] || NETWORK;

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

export const resourceServer = new x402ResourceServer(facilitatorClient).register(
  NETWORK_CAIP2,
  new ExactEvmScheme(),
);
`;
}

function nextPaidRouteJs(opts: TemplateOptions): string {
  // withX402(handler, routeConfig, server) — verified against @x402/next
  // 2.20.0 (README + dist exports). It settles only after the handler
  // succeeds, so failed responses are never charged.
  // Route file lives at app/<route>/route.js; lib/x402.js is at the project
  // root, so hop up one level per route segment plus one for app/.
  const up = "../".repeat(opts.route.split("/").filter(Boolean).length + 1);
  return `import { NextResponse } from 'next/server';
import { withX402 } from '@x402/next';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { resourceServer, NETWORK_CAIP2, PAY_TO_ADDRESS } from '${up}lib/x402.js';

const handler = async (_req) => {
  return NextResponse.json({ ok: true, data: 'paid content', servedAt: new Date().toISOString() });
};

export const ${opts.method} = withX402(
  handler,
  {
    accepts: {
      scheme: 'exact',
      price: ${priceExprJs(opts)},
      network: NETWORK_CAIP2,
      payTo: PAY_TO_ADDRESS,
      maxTimeoutSeconds: 60,
    },
    description: 'Paid ${opts.method} ${opts.route} (${humanPrice(opts)})',
    mimeType: 'application/json',
    // Bazaar discovery declaration — makes the route eligible for the
    // public x402 catalog after its first successful verify.
    extensions: declareDiscoveryExtension({
      output: { example: { ok: true, data: 'paid content' } },
    }),
  },
  resourceServer,
);
`;
}

function nextHealthRouteJs(_opts: TemplateOptions): string {
  return `import { NextResponse } from 'next/server';
import { FACILITATOR_URL, NETWORK } from '../../../lib/x402.js';

export const GET = async () => {
  return NextResponse.json({ ok: true, network: NETWORK, facilitator: FACILITATOR_URL });
};
`;
}

function fastapiMainPy(opts: TemplateOptions): string {
  return `"""x402 seller (FastAPI) — generated standalone template by \`npx paygate init\`.

Uses the \`x402\` pip package (FastAPI middleware, verified against x402
2.17.0). Routes:

    GET /health           unpaid health check
    ${opts.method} ${opts.route}         ${humanPrice(opts)} per request, gated by x402

${
  opts.network === "base"
    ? `Production: Base mainnet (eip155:8453), settled by the ArisPay facilitator
(${MAINNET_FACILITATOR}) — no facilitator fee; the seller pays chain gas.`
    : `Testnet: Base Sepolia (eip155:84532). The public ArisPay facilitator
(${MAINNET_FACILITATOR}) settles Base MAINNET ONLY, so this template
defaults FACILITATOR_URL to Coinbase's public testnet facilitator
(${TESTNET_FACILITATOR}). For production, switch NETWORK to "base" and
FACILITATOR_URL to ${MAINNET_FACILITATOR}.`
}
"""

import os
import re

from fastapi import FastAPI
from x402 import x402ResourceServer
from x402.extensions.bazaar import declare_discovery_extension
from x402.http import HTTPFacilitatorClient
from x402.http.middleware.fastapi import payment_middleware
from x402.mechanisms.evm.exact import ExactEvmServerScheme

PAY_TO_ADDRESS = os.environ.get("PAY_TO_ADDRESS", "")
FACILITATOR_URL = os.environ.get("FACILITATOR_URL", "${defaultFacilitatorFor(opts.network)}")
NETWORK = os.environ.get("NETWORK", "${opts.network}")

if not re.fullmatch(r"0x[0-9a-fA-F]{40}", PAY_TO_ADDRESS):
    raise SystemExit("PAY_TO_ADDRESS env var is required and must be a 0x-prefixed EVM address")

NETWORK_TO_CAIP2 = {
    "base-sepolia": "${CAIP2["base-sepolia"]}",
    "base": "${CAIP2.base}",
}
NETWORK_CAIP2 = NETWORK_TO_CAIP2.get(NETWORK, NETWORK)

facilitator = HTTPFacilitatorClient(url=FACILITATOR_URL)
server = x402ResourceServer(facilitator)
server.register(NETWORK_CAIP2, ExactEvmServerScheme())
server.initialize()

app = FastAPI()

routes = {
    "${opts.method} ${opts.route}": {
        "accepts": {
            "scheme": "exact",
            "price": ${priceExprPy(opts)},
            "network": NETWORK_CAIP2,
            "payTo": PAY_TO_ADDRESS,
            "maxTimeoutSeconds": 60,
        },
        "description": "Paid ${opts.method} ${opts.route} (${humanPrice(opts)})",
        "mime_type": "application/json",
        # Bazaar discovery declaration — makes the route eligible for the
        # public x402 catalog after its first successful verify.
        "extensions": declare_discovery_extension(
            output={"example": {"ok": True, "data": "paid content"}},
        ),
    },
}

_x402 = payment_middleware(routes, server)


@app.middleware("http")
async def x402_middleware(request, call_next):
    return await _x402(request, call_next)


@app.get("/health")
async def health():
    """Unpaid health check."""
    return {"ok": True, "network": NETWORK, "facilitator": FACILITATOR_URL}


@app.${opts.method.toLowerCase()}("${opts.route}")
async def paid_route():
    """Protected resource. Only reached after payment settles."""
    return {"ok": True, "data": "paid content"}
`;
}

// ── Hosted PayGate mode (merchantId) ───────────────────────────────────

function merchantEnvExample(opts: TemplateOptions): string {
  return `# Hosted PayGate merchant id (from https://paygate.arispay.app).
# Not a secret, but keeping it in env makes per-environment setups easier.
PAYGATE_MERCHANT_ID=${opts.merchantId ?? ""}

# Port for the local server.
PORT=3000

# NOTE: in merchantId mode the payout wallet, network, and facilitator all
# come from your merchant capability manifest (configured in the PayGate
# dashboard) — there is nothing else to configure here. The default
# facilitator behind hosted PayGate is ${MAINNET_FACILITATOR}.
`;
}

function merchantExpressServerJs(opts: TemplateOptions): string {
  const currencyLine = opts.currency === "EUR" ? `\n  currency: 'EUR',` : "";
  return `/**
 * Hosted PayGate seller (Express) — generated by \`npx paygate init\`.
 *
 * This template uses the hosted PayGate product: the \`paygate\` SDK fetches
 * your payout wallet, network, and facilitator from your merchant capability
 * manifest. It requires a merchant account at https://paygate.arispay.app.
 * (For the account-free path, re-run \`npx paygate init\` without
 * \`--merchant-id\`.)
 */
import express from 'express';
import { paygate } from 'paygate/express';

const PORT = parseInt(process.env.PORT || '3000', 10);
const MERCHANT_ID = process.env.PAYGATE_MERCHANT_ID;

if (!MERCHANT_ID) {
  console.error('PAYGATE_MERCHANT_ID env var is required (see .env.example)');
  process.exit(1);
}

const pw = paygate({
  merchantId: MERCHANT_ID,${currencyLine}
});

const app = express();

// Health check — unprotected.
app.get('/health', (_req, res) => {
  res.json({ ok: true, merchantId: MERCHANT_ID });
});

// ${humanPrice(opts)} per request.
app.${opts.method.toLowerCase()}('${opts.route}', pw({ priceCents: ${opts.priceCents} }), (_req, res) => {
  res.json({ ok: true, data: 'paid content', servedAt: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(\`hosted-paygate seller listening on :\${PORT} merchantId=\${MERCHANT_ID}\`);
});
`;
}

function merchantFastifyServerJs(opts: TemplateOptions): string {
  const currencyLine = opts.currency === "EUR" ? `\n  currency: 'EUR',` : "";
  return `/**
 * Hosted PayGate seller (Fastify) — generated by \`npx paygate init\`.
 *
 * This template uses the hosted PayGate product: the \`paygate\` SDK fetches
 * your payout wallet, network, and facilitator from your merchant capability
 * manifest. It requires a merchant account at https://paygate.arispay.app.
 * (For the account-free path, re-run \`npx paygate init\` without
 * \`--merchant-id\`.)
 */
import Fastify from 'fastify';
import { paygatePlugin } from 'paygate/fastify';

const PORT = parseInt(process.env.PORT || '3000', 10);
const MERCHANT_ID = process.env.PAYGATE_MERCHANT_ID;

if (!MERCHANT_ID) {
  console.error('PAYGATE_MERCHANT_ID env var is required (see .env.example)');
  process.exit(1);
}

const app = Fastify({ logger: true });

await app.register(paygatePlugin, {
  merchantId: MERCHANT_ID,${currencyLine}
});

// Health check — unprotected.
app.get('/health', async () => ({ ok: true, merchantId: MERCHANT_ID }));

// ${humanPrice(opts)} per request.
app.${opts.method.toLowerCase()}('${opts.route}', {
  config: { paygate: { priceCents: ${opts.priceCents} } },
}, async () => ({ ok: true, data: 'paid content', servedAt: new Date().toISOString() }));

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(\`hosted-paygate seller listening on :\${PORT} merchantId=\${MERCHANT_ID}\`);
`;
}

// ── package.json builders ──────────────────────────────────────────────

function pkgJson(opts: TemplateOptions, deps: Record<string, string>, extra?: object): string {
  return `${JSON.stringify(
    {
      name: opts.projectName,
      version: "0.1.0",
      private: true,
      type: "module",
      description: `x402 seller (${opts.framework}) generated by paygate init`,
      scripts:
        opts.framework === "workers"
          ? { dev: "wrangler dev", deploy: "wrangler deploy" }
          : opts.framework === "next"
            ? { dev: "next dev", build: "next build", start: "next start" }
            : {
                // --env-file makes `cp .env.example .env && npm start` work
                // without a dotenv dependency (Node >= 20.6).
                start: "node --env-file=.env server.js",
                dev: "node --env-file=.env --watch server.js",
              },
      engines: { node: ">=20.6" },
      dependencies: deps,
      ...(extra ?? {}),
    },
    null,
    2,
  )}\n`;
}

// Upstream versions: @x402/express verified in-repo at 2.8.0 (the proven
// live demo); @x402/fastify, @x402/hono, @x402/next verified from the
// published 2.20.0 tarballs.
const X402_EXPRESS_RANGE = "^2.8.0";
const X402_OTHER_RANGE = "^2.20.0";

// ── Entry point ────────────────────────────────────────────────────────

export function generateFiles(opts: TemplateOptions): GeneratedFile[] {
  if (opts.merchantId && (opts.framework === "express" || opts.framework === "fastify")) {
    return generateMerchantFiles(opts);
  }

  switch (opts.framework) {
    case "express":
      return [
        {
          path: "package.json",
          content: pkgJson(opts, {
            "@x402/core": X402_EXPRESS_RANGE,
            "@x402/evm": X402_EXPRESS_RANGE,
            "@x402/express": X402_EXPRESS_RANGE,
            "@x402/extensions": X402_EXPRESS_RANGE,
            express: "^4.21.2",
          }),
        },
        { path: "server.js", content: expressServerJs(opts) },
        { path: ".env.example", content: envExample(opts) },
        { path: ".gitignore", content: GITIGNORE },
        {
          path: "README.md",
          content: `# ${opts.projectName}\n\nAccount-free x402 seller (Express) generated by \`npx paygate init\`. No\nArisPay account or API key — the wallet in \`PAY_TO_ADDRESS\` receives funds\ndirectly.\n\n\`\`\`bash\nnpm install\ncp .env.example .env   # set PAY_TO_ADDRESS\nnpm start\n\`\`\`\n\n${readmeCommon(opts, "npm start", 3000)}`,
        },
      ];
    case "fastify":
      return [
        {
          path: "package.json",
          content: pkgJson(opts, {
            "@x402/core": X402_OTHER_RANGE,
            "@x402/evm": X402_OTHER_RANGE,
            "@x402/fastify": X402_OTHER_RANGE,
            "@x402/extensions": X402_OTHER_RANGE,
            fastify: "^5.0.0",
          }),
        },
        { path: "server.js", content: fastifyServerJs(opts) },
        { path: ".env.example", content: envExample(opts) },
        { path: ".gitignore", content: GITIGNORE },
        {
          path: "README.md",
          content: `# ${opts.projectName}\n\nAccount-free x402 seller (Fastify) generated by \`npx paygate init\`. No\nArisPay account or API key — the wallet in \`PAY_TO_ADDRESS\` receives funds\ndirectly.\n\n\`\`\`bash\nnpm install\ncp .env.example .env   # set PAY_TO_ADDRESS\nnpm start\n\`\`\`\n\n${readmeCommon(opts, "npm start", 3000)}`,
        },
      ];
    case "hono":
      return [
        {
          path: "package.json",
          content: pkgJson(opts, {
            "@hono/node-server": "^1.13.0",
            "@x402/core": X402_OTHER_RANGE,
            "@x402/evm": X402_OTHER_RANGE,
            "@x402/extensions": X402_OTHER_RANGE,
            "@x402/hono": X402_OTHER_RANGE,
            hono: "^4.6.0",
          }),
        },
        { path: "server.js", content: honoServerJs(opts) },
        { path: ".env.example", content: envExample(opts) },
        { path: ".gitignore", content: GITIGNORE },
        {
          path: "README.md",
          content: `# ${opts.projectName}\n\nAccount-free x402 seller (Hono, Node.js) generated by \`npx paygate init\`.\nNo ArisPay account or API key — the wallet in \`PAY_TO_ADDRESS\` receives\nfunds directly.\n\n\`\`\`bash\nnpm install\ncp .env.example .env   # set PAY_TO_ADDRESS\nnpm start\n\`\`\`\n\n${readmeCommon(opts, "npm start", 3000)}`,
        },
      ];
    case "workers":
      return [
        {
          path: "package.json",
          content: pkgJson(
            opts,
            {
              "@x402/core": X402_OTHER_RANGE,
              "@x402/evm": X402_OTHER_RANGE,
              "@x402/extensions": X402_OTHER_RANGE,
              "@x402/hono": X402_OTHER_RANGE,
              hono: "^4.6.0",
            },
            { devDependencies: { wrangler: "^4.0.0" } },
          ),
        },
        { path: "src/index.js", content: workersIndexJs(opts) },
        { path: "wrangler.toml", content: wranglerToml(opts) },
        { path: ".gitignore", content: GITIGNORE },
        {
          path: "README.md",
          content: `# ${opts.projectName}\n\nAccount-free x402 seller on Cloudflare Workers (Hono) generated by\n\`npx paygate init\`. No ArisPay account or API key — the wallet in the\n\`PAY_TO_ADDRESS\` var (see \`wrangler.toml\` \`[vars]\`) receives funds directly.\n\n\`\`\`bash\nnpm install\n# set PAY_TO_ADDRESS in wrangler.toml [vars]\nnpx wrangler dev\n\`\`\`\n\nDeploy with \`npx wrangler deploy\`. Local dev serves on port 8787.\n\n${readmeCommon(opts, "npx wrangler dev", 8787)}`,
        },
      ];
    case "next": {
      const routeDir = nextRouteFileDir(opts.route);
      return [
        {
          path: "package.json",
          content: pkgJson(opts, {
            "@x402/core": X402_OTHER_RANGE,
            "@x402/evm": X402_OTHER_RANGE,
            "@x402/extensions": X402_OTHER_RANGE,
            "@x402/next": X402_OTHER_RANGE,
            next: "^16.2.6",
            react: "^19.0.0",
            "react-dom": "^19.0.0",
          }),
        },
        { path: "lib/x402.js", content: nextLibX402Js(opts) },
        { path: `${routeDir}/route.js`, content: nextPaidRouteJs(opts) },
        { path: "app/api/health/route.js", content: nextHealthRouteJs(opts) },
        { path: ".env.example", content: envExample(opts) },
        { path: ".gitignore", content: GITIGNORE },
        {
          path: "README.md",
          content: `# ${opts.projectName}\n\nAccount-free x402 seller (Next.js App Router) generated by\n\`npx paygate init\`. No ArisPay account or API key — the wallet in\n\`PAY_TO_ADDRESS\` receives funds directly. The paid route handler is wrapped\nwith \`withX402\` from \`@x402/next\` (verified against @x402/next 2.20.0),\nwhich settles only after your handler succeeds — failed responses are never\ncharged.\n\nNote: this scaffold contains only the API route handlers (no pages). Drop\nthe \`app/\` + \`lib/\` folders into an existing Next.js project, or add a\nminimal \`app/layout.js\` + \`app/page.js\` to run it standalone.\n\n\`\`\`bash\nnpm install\ncp .env.example .env.local   # set PAY_TO_ADDRESS\nnpm run dev\n\`\`\`\n\n${readmeCommon(opts, "npm run dev", 3000)}`,
        },
      ];
    }
    case "fastapi":
      return [
        { path: "main.py", content: fastapiMainPy(opts) },
        {
          path: "requirements.txt",
          content: `# x402 pip package (FastAPI middleware + EVM mechanism), verified against 2.17.0\nx402[fastapi,evm]>=2.17.0\nfastapi>=0.115.0\nuvicorn>=0.30.0\n`,
        },
        { path: ".env.example", content: envExample(opts) },
        { path: ".gitignore", content: GITIGNORE },
        {
          path: "README.md",
          content: `# ${opts.projectName}\n\nAccount-free x402 seller (FastAPI) — a generated standalone Python template\nfrom \`npx paygate init\` (it does not use the \`paygate\` npm package at\nruntime). No ArisPay account or API key — the wallet in \`PAY_TO_ADDRESS\`\nreceives funds directly.\n\n\`\`\`bash\npython -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\ncp .env.example .env   # set PAY_TO_ADDRESS, then export the vars\nexport $(grep -v '^#' .env | xargs)\nuvicorn main:app --port 3000\n\`\`\`\n\n${readmeCommon(opts, "uvicorn main:app --port 3000", 3000)}`,
        },
      ];
  }
}

function generateMerchantFiles(opts: TemplateOptions): GeneratedFile[] {
  const isExpress = opts.framework === "express";
  const frameworkDep: Record<string, string> = isExpress
    ? { express: "^4.21.2" }
    : { fastify: "^5.0.0" };
  return [
    {
      path: "package.json",
      content: pkgJson(opts, { paygate: "^5.3.0", ...frameworkDep }),
    },
    {
      path: "server.js",
      content: isExpress ? merchantExpressServerJs(opts) : merchantFastifyServerJs(opts),
    },
    { path: ".env.example", content: merchantEnvExample(opts) },
    { path: ".gitignore", content: GITIGNORE },
    {
      path: "README.md",
      content: `# ${opts.projectName}

Hosted PayGate seller (${isExpress ? "Express" : "Fastify"}) generated by \`npx paygate init --merchant-id\`.

**This is the hosted PayGate product path** — it needs a merchant account at
https://paygate.arispay.app. The \`paygate\` SDK fetches your payout wallet,
network, asset, trust policy, and facilitator from your merchant capability
manifest, so those are configured in the dashboard rather than in this repo.
Settlement runs through the facilitator named by your manifest (default:
${MAINNET_FACILITATOR}, Base mainnet).

**Prefer the account-free path?** Re-run \`npx paygate init\` without
\`--merchant-id\` to scaffold a standalone x402 seller that pays a wallet
address directly with no account at all.

\`\`\`bash
npm install
cp .env.example .env   # set PAYGATE_MERCHANT_ID
npm start
\`\`\`

## Test the 402

\`\`\`bash
${curlExample(opts, 3000)}
\`\`\`

You should see \`HTTP/1.1 402 Payment Required\` with a JSON body listing the
payment requirements. Issuing the challenge never moves funds — money only
moves when a payer signs and the facilitator settles.

## Learn more

- Machine-readable facilitator docs: https://facilitator.arispay.app/llms.txt
- Live facilitator policy (networks/assets/fees): https://facilitator.arispay.app/supported
`,
    },
  ];
}
