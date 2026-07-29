# paygate

Make your API payable in one command.

```bash
npx paygate init
```

`paygate init` scaffolds a **working x402 seller** — an HTTP API where a paid
route answers `402 Payment Required` until an AI agent (or any x402 client)
pays it in stablecoins. Pick a framework, give it the wallet address that
should receive the money, and you have a payable endpoint in under five
minutes. No account, no API key: funds settle on-chain straight to your
wallet through the [ArisPay facilitator](https://facilitator.arispay.app).

```bash
# Non-interactive (agents / CI): everything via flags
npx paygate init \
  --framework express \
  --wallet 0xYourAddress \
  --route /api/data --price 10 \
  --yes

cd x402-express-seller && npm install && cp .env.example .env && npm start
curl -i localhost:3000/api/data   # → HTTP 402 with the payment requirements
```

Supported templates: `express`, `fastify`, `next` (App Router), `hono`,
`workers` (Cloudflare Workers + Hono), `fastapi` (standalone Python).
Every template ships a `/health` route, a paid route with Bazaar discovery
metadata (so the endpoint can enter the public x402 catalog), a `.env.example`,
and a README with a copy-paste 402 test.

Useful flags: `--price <integer cents>` (never floats), `--method`,
`--currency USD|EUR` (EUR settles in Circle EURC and requires
`--network base`), `--network base|base-sepolia`, `--merchant-id` (hosted
PayGate mode, see below), `--dry-run` (print the file plan, write nothing),
`--yes` (accept defaults, never prompt). Run `npx paygate init --help` for
the full list.

**Networks:** the default is `base-sepolia` (testnet) so you can rehearse
without moving real funds — testnet templates point at Coinbase's public
testnet facilitator (`https://x402.org/facilitator`) because the ArisPay
facilitator settles **Base mainnet only**. Pass `--network base` for
production; that flips `FACILITATOR_URL` to `https://facilitator.arispay.app`.

See also the full quickstart: `docs/quickstart-accept-x402.md` in the
[ArisPay repo](https://github.com/arispay-inc/ArisPay).

---

## The SDK

If you'd rather wire the paywall into an existing app yourself, install the
middleware:

```bash
npm install paygate
```

PayGate handles the x402 challenge, verifies/settles through a facilitator,
and lets your handler run only after payment settles.

There are **two ways to configure it**:

- **Direct (wallet) mode** — pass `wallet` + `network`. No ArisPay account:
  the 402 challenge points straight at your wallet and the SDK settles
  through `facilitatorUrl` (default `https://facilitator.arispay.app`).
- **Hosted PayGate mode** — pass `merchantId` (from
  [paygate.arispay.app](https://paygate.arispay.app)). The SDK fetches your
  payout wallet, network, asset, trust policy, **and facilitator** from your
  merchant capability manifest.

`merchantId` is optional — direct mode is fully supported. (Direct mode is
configured via the fields the v3 docs label "v2 compat"; they keep working
and are what `paygate init` account-free templates rely on conceptually.)

## Express

```js
import express from 'express';
import { paygate } from 'paygate/express';

const app = express();

const pw = paygate({
  merchantId: process.env.PAYGATE_MERCHANT_ID,
});

// $0.10 per request
app.get('/api/data', pw({ priceCents: 10 }), (req, res) => {
  res.json({ data: 'premium content' });
});

// Dynamic pricing
app.post('/api/analyze', pw({
  priceCents: (req) => req.body.depth === 'deep' ? 50 : 10,
}), (req, res) => {
  res.json({ result: '...' });
});

app.listen(3000);
```

## Fastify

```js
import Fastify from 'fastify';
import paygate from 'paygate/fastify';

const app = Fastify();

await app.register(paygate, {
  merchantId: process.env.PAYGATE_MERCHANT_ID,
});

// Route-config-driven paywall
app.get('/api/data', {
  config: { paygate: { priceCents: 10 } },
}, async (req, reply) => {
  reply.send({ data: 'premium content' });
});

// Or imperative API
app.get('/api/research', async (req, reply) => {
  const { paid } = await req.paygatePay({ priceCents: 5 });
  if (!paid) return; // 402 challenge already sent
  reply.send({ results: '...' });
});

await app.listen({ port: 3000 });
```

## Hosted proxy

For a no-code merchant integration:

1. Register at `https://paygate.arispay.app/merchant-register`.
2. Add a primary USDC payout wallet in the PayGate dashboard.
3. Create an API endpoint offer with `method`, `path`, `targetUrl`, and `priceCents`.
4. Agents call `https://paygate.arispay.app/{slug}{path}`.

Example agent test:

```bash
npx payagent pay https://paygate.arispay.app/acme/forecast?city=London
```

API equivalent for offer creation:

```bash
curl -X POST https://api.arispay.app/v1/merchants/me/products \
  -H 'authorization: Bearer mp_live_…' \
  -H 'content-type: application/json' \
  -d '{
    "method": "GET",
    "path": "/forecast",
    "targetUrl": "https://api.acme.com/v1/forecast",
    "priceCents": 2,
    "description": "Weather forecast"
  }'
```

## How it works

```
Agent                    Your API / Proxy       ArisPay Facilitator
  │                         │                        │
  ├─── GET /api/data ──────►│                        │
  │                         │  no X-Payment header   │
  │◄── 402 + requirements ──┤                        │
  │                         │                        │
  │   agent signs USDC transfer authorization        │
  │                         │                        │
  ├─── GET /api/data ──────►│                        │
  │    + X-Payment header   ├── POST /settle ────────►│
  │                         │                        │ verify + settle
  │                         │◄── { success, txHash } ─┤
  │◄── 200 + data ──────────┤                        │
```

The agent-side [`payagent`](https://www.npmjs.com/package/payagent) CLI and SDK handle the 402 loop automatically.

## Config

| Option | Required | Default | Description |
|---|---|---|---|
| `merchantId` | No¹ | — | Hosted PayGate merchant ID from the dashboard. When set, the SDK fetches payout rail, wallet, asset, facilitator, and trust policy from ArisPay — the manifest is authoritative. |
| `wallet` | No¹ | — | Direct mode: the EVM address that receives funds. Pair with `network`. |
| `network` | No¹ | — | Direct mode: CAIP-2 id or short name (`base`, `base-sepolia`, `ethereum`, `polygon`). |
| `currency` | No | `"USD"` | `"USD"` (USDC) or `"EUR"` (Circle EURC). `priceCents` is then integer cents of that currency — the cents → 6-decimal conversion factor is 10⁴ for both assets. In direct mode EURC addresses are known for Base mainnet + Base Sepolia (other networks need an explicit `asset`); in merchantId mode the SDK selects the merchant's EURC rail and errors clearly if there is none. |
| `asset` | No | derived | Direct mode only: settlement token contract, auto-derived from `network` + `currency`. Ignored in merchantId mode. |
| `facilitatorUrl` | No | `https://facilitator.arispay.app` | **Direct mode only.** In merchantId mode this option is ignored — the facilitator comes from the merchant capability manifest, which is authoritative. |
| `apiUrl` | No | `https://api.arispay.app` | Override ArisPay API URL for staging/self-hosting (merchantId mode). |
| `timeout` | No | `30000` | ArisPay/facilitator call timeout in ms. |
| `cacheTtlMs` | No | `300000` | Merchant capability cache TTL. |
| `selfSettle` | No | — | `{ privateKey, rpcUrl? }`. Submit settlements from your own funded key: verification runs against the facilitator (free), then the SDK submits the EIP-3009 `transferWithAuthorization` itself. You pay chain gas (~$0.001/settle on Base) and nobody else — no facilitator fee, no subsidy that ends. The key is any funded EOA; it pays gas only and never receives or holds customer funds. Replay protection is on-chain (the EIP-3009 nonce). Defaults to public Base RPCs; set `rpcUrl` for other networks or your own provider. |

¹ Pass either `merchantId` (hosted mode) **or** `wallet` + `network` (direct
mode). Direct mode currently emits a deprecation warning pointing at
`merchantId`; it remains supported.

Per-route config (`pw({ ... })`): `priceCents` (integer cents, or a function
of the request for dynamic pricing). A `description` field is accepted for
forward compatibility but is **reserved/currently unused** — it does not
appear in the 402 challenge today.

### EUR pricing

```ts
const pw = paygate({
  merchantId: "m_123",
  currency: "EUR", // settles in Circle EURC; priceCents = EUR cents
});
```

### Self-settle

```ts
const pw = paygate({
  merchantId: "m_123",
  selfSettle: { privateKey: process.env.SETTLE_KEY! }, // funded with a few $ of Base ETH
});
```

Requires the optional peer dependency `ethers` (v6): `npm install ethers`. The
facilitator path never loads it.

Verified end-to-end against Circle's real USDC on Base Sepolia (2026-07-19): a
signed EIP-3009 authorization settled on-chain via `submitSelfSettle` — 0.01
USDC transferred, gas paid by the self-settle key — tx
[`0xe151fe05…dda4cb0`](https://sepolia.basescan.org/tx/0xe151fe058f2e03f74f7a6ec4bea95224515592bf3bee8f689b37caf04dda4cb0)
(`AuthorizationUsed` + `Transfer` events). This confirms Circle USDC accepts the
9-arg split-signature `transferWithAuthorization` form the SDK submits.

## Networks

PayGate settles **USDC and EURC** on EVM networks — in merchantId mode the
networks advertised by your merchant capability manifest, in direct mode the
network you pass. Base mainnet (`eip155:8453`) is the recommended production
network.

## Facilitator

PayGate settles through [**facilitator.arispay.app**](https://facilitator.arispay.app) by default (direct mode) — a non-custodial x402 facilitator, live on Base mainnet, settling USDC and EURC. It verifies signed payment authorizations and submits settlement on-chain; funds move directly from buyer to seller (no held funds, no balances, no payouts to release). No facilitator fee: the seller pays chain gas (self-settle with your own key, or the default relayer path, where the facilitator fronts limited launch-period gas with ≥30 days' notice before any change). The live policy is machine-readable at [`/supported`](https://facilitator.arispay.app/supported); the discovery document is at [`/facilitator`](https://facilitator.arispay.app/facilitator). Point `facilitatorUrl` elsewhere if you run your own (direct mode; in merchantId mode the manifest names the facilitator).

## License

MIT
