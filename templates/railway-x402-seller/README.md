# Railway x402 seller

Standalone source for the ArisPay Railway seller template. It deploys one
Express service with:

- `GET /health` — unpaid health check.
- `GET /api/paid` — `$0.01` USDC on Base mainnet.
- `https://facilitator.arispay.app` — default facilitator.
- x402 v2 Bazaar discovery metadata.

There is no ArisPay account, API key, database, custody, or application secret.
The only required value is `PAY_TO_ADDRESS`, the public EVM address that
receives settled USDC.

## Railway template configuration

Create the Railway template from the public source mirror after this change is
merged and synced:

| Setting | Value |
|---|---|
| Source | `https://github.com/arispay-inc/arispay-x402` (`main`) |
| Root directory | `/templates/railway-x402-seller` |
| Public networking | Enabled |
| Required variable | `PAY_TO_ADDRESS` — public 0x EVM recipient address |
| Health check | `/health` |
| Start command | From `railway.toml` (`npm start`) |

`FACILITATOR_URL` is optional and defaults to
`https://facilitator.arispay.app`. Do not add an ArisPay key or wallet private
key to the template.

## Exact deployed smoke

After Railway reports the service healthy and assigns its HTTPS domain:

```bash
export SELLER_URL=https://YOUR-SERVICE.up.railway.app

curl --fail --silent --show-error "$SELLER_URL/health"
npx paygate@latest doctor "$SELLER_URL/api/paid"
```

Expected:

```text
PASS  unpaid request returned HTTP 402
PASS  resource URL is HTTPS (...)
PASS  x402 version is 2
PASS  challenge accepts Base mainnet (eip155:8453)
PASS  Base asset is USDC
PASS  Bazaar discovery metadata is present

Ready for Base mainnet. No payment or auth headers were sent.
```

This smoke is read-only. It sends no payment or authorization header and makes
no payment. A paid smoke requires a separate, explicit authorization.
