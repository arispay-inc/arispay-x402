# payagent

Let AI agents pay for APIs. The ArisPay SDK + CLI for [x402](https://github.com/coinbase/x402) USDC payments.

Two ways to pay:

- **Delegated custody** — ArisPay provisions a Coinbase CDP-managed wallet and signs on your agent's behalf. No private key ever lives in your process, and ArisPay enforces per-transaction, daily, monthly, and allowed-domain limits server-side.
- **Local signer (permissionless)** — `payFetchLocal({ privateKey })` signs EIP-3009 payments in your process with any funded key. No ArisPay account, no API key, no provisioning — `npm install payagent` is the whole setup. Settlement runs through whatever facilitator the seller uses (any upstream-compatible x402 facilitator, including [facilitator.arispay.app](https://facilitator.arispay.app) — [source](https://github.com/arispay-inc/facilitator)).

Honest trade-off: spend limits, domain allowlists, suspension, and the payment feed are server-side features of the delegated model and do **not** exist in local-signer mode — the only guardrail is an optional client-side per-transaction cap. Use a dedicated low-balance wallet for local signing.

## Install

```bash
npm install payagent
```

Requires Node.js >= 18.

## Quick start (local signer — no ArisPay account)

Point the CLI at any funded EOA key and pay in one step — nothing else to set up:

```bash
PAYAGENT_PRIVATE_KEY=0x… npx payagent pay https://api.example.com/premium
```

Library equivalent:

```ts
import { payFetchLocal } from "payagent";

const fetch402 = payFetchLocal({
  privateKey: process.env.PRIVATE_KEY!,
  maxPerTxBaseUnits: "1000000", // optional client-side cap: $1.00 USDC
});
const res = await fetch402("https://api.example.com/premium");
```

The `vercel` and `langchain` tool integrations accept either mode — pass
`{ privateKey }` for local signing or `{ arispayUrl, apiKey }` for delegated.

## Quick start (CLI)

One command. No dashboard trip, no separate `init`, no separate `agent create`, no manual funding step.

```bash
npx payagent pay https://api.example.com/premium
```

On a cold machine, `pay` self-bootstraps in order:

1. **Auth** — prints a verification URL + code (OAuth device-code flow). Open it, approve, the CLI picks up your API key.
2. **Agent** — auto-creates a local agent named `default` with conservative defaults ($5/tx, $20/day, $100/month, Base mainnet, URL hostname allowlisted). Persisted to `~/.payagent/config.json`, so subsequent runs skip this step.
3. **Funding** — if the agent has 0 USDC, prints a Coinbase Onramp link (or the raw wallet address if onramp isn't configured on the deployment) and polls until funds land.
4. **Pay** — retries the URL with a signed `X-PAYMENT` header.

Progress goes to stderr; the HTTP response body is written to stdout, so you can pipe it:

```bash
npx payagent pay https://api.example.com/premium | jq .
```

Overrides (all optional) let you tune the first-run defaults:

```bash
npx payagent pay <url> \
  --agent hermes \                        # name the agent (defaults to `default`)
  --per-tx 0.50 --daily 10 --monthly 100 \# dollars; cents stored server-side
  --network base \                        # base | base-sepolia | ethereum | polygon
  --domains api.example.com,api.example.net \
  --method POST --body '{"foo":"bar"}' \
  --amount 25                             # preset Coinbase Onramp amount (USD)
```

For advanced setups you can still run the gates manually:

```bash
npx payagent init                                     # OAuth device-code sign-in
npx payagent agent create --name hermes \
  --per-tx 0.50 --daily 10 --monthly 100              # amounts in dollars
npx payagent agent fund hermes --hosted 25            # Coinbase Onramp link for $25
```

The CLI and the [`@arispay/payagent-mcp`](https://www.npmjs.com/package/@arispay/payagent-mcp) server share the same `~/.payagent/config.json`, so an agent created on the command line is immediately available to Claude Desktop or any other MCP host.

## Quick start (programmatic)

```ts
import { launchAgent } from 'payagent';

const hermes = await launchAgent({
  name: 'hermes',
  limits: { perTx: 50, daily: 1000, monthly: 10000 }, // cents
  allowedDomains: ['api.example.com'],
});

console.log(`Fund this wallet with USDC on Base: ${hermes.walletAddress}`);
await hermes.waitUntilFunded();

const res = await hermes.fetch('https://api.example.com/premium');
const data = await res.json();
```

For finer-grained control, the low-level `DelegationClient` + `payFetchDelegated` primitives are still exported and used by `launchAgent` under the hood:

```ts
import { DelegationClient, payFetchDelegated } from 'payagent';

const client = new DelegationClient('https://api.arispay.app', process.env.ARISPAY_API_KEY);
const agent = await client.createX402Agent({
  name: 'my-agent',
  maxPerTx: 100,
  maxDaily: 1000,
  maxMonthly: 10000,
  allowedDomains: ['api.example.com'],
});
await client.pollUntilFunded(agent.agentId);

const fetch402 = payFetchDelegated({
  arispayUrl: 'https://api.arispay.app',
  apiKey: agent.apiKey,
});
const res = await fetch402('https://api.example.com/premium');
```

## CLI reference

| Command | Purpose |
|---|---|
| `payagent init` | Browser-based OAuth device-code flow. Saves the developer API key to `~/.payagent/config.json` (mode 0600). |
| `payagent status` / `payagent doctor` | Show local readiness: API target, key validity, cached agents, balances, and next command. |
| `payagent whoami` | Show the current developer key prefix, base URL, and config path. |
| `payagent logout` | Clear the developer key. Local agent records are kept. |
| `payagent agent create --name N --per-tx N --daily N --monthly N [--domains a,b] [--network base|base-sepolia|ethereum|polygon]` | Create an x402 agent, cache its credentials locally, and print a hosted funding link when available. |
| `payagent agent fund NAME` | Print the funding address, render a QR, and poll until the wallet first receives USDC. |
| `payagent agent balance NAME` | Show current balance + `fundedAt`. |
| `payagent agent list` | List locally-cached agents. |
| `payagent agent remove NAME` | Drop an agent from the local cache (the server-side agent remains). |
| `payagent pay URL [--agent N] [--method GET/POST/…] [--body STR]` | Make a single paid request through `payFetchDelegated`. |

Amounts on the CLI are in dollars (5, 5.00, or "$5.00" all mean 500 cents). Internally everything is integer cents, matching the ArisPay API.

Env overrides respected everywhere: `ARISPAY_API_KEY`, `ARISPAY_URL`, `PAYAGENT_CONFIG_DIR`.

## Hosted top-up (Coinbase Onramp)

For end-user-friendly funding — no crypto wallet required — ArisPay can
return a hosted Coinbase Onramp URL instead of a raw wallet address. The
user opens the URL, pays with card or Apple Pay, and Coinbase deposits
USDC straight into the agent's CDP wallet.

```ts
import { launchAgent, HostedTopupNotConfiguredError } from 'payagent';

const hermes = await launchAgent({
  name: 'hermes',
  limits: { perTx: 50, daily: 1000, monthly: 10000 },
});

try {
  const link = await hermes.getFundingLink({ amount: 50 });
  console.log(`Pay here: ${link.fundingUrl}`);
  // Expires at link.expiresAt, valid for ~2 hours.
  await hermes.waitUntilFunded();
} catch (err) {
  if (err instanceof HostedTopupNotConfiguredError) {
    // Deployment hasn't set ARISPAY_ONRAMP_PROVIDER — fall back to
    // the plain wallet address.
    console.log(`Send USDC on base to ${hermes.walletAddress}`);
    await hermes.waitUntilFunded();
  } else {
    throw err;
  }
}
```

Or via the CLI:

```bash
npx payagent agent fund hermes --hosted 50
```

Requires `ARISPAY_ONRAMP_PROVIDER=coinbase` + `COINBASE_ONRAMP_APP_ID`
on the API deployment. Without them, the `--hosted` flag falls back to
the manual path with a clear message.

## How x402 works

The [x402 protocol](https://github.com/coinbase/x402) uses HTTP status code 402 for machine-to-machine API payments:

1. **Server** returns `402 Payment Required` with payment requirements (chain, amount, recipient).
2. **payagent** asks ArisPay to sign an EIP-3009 `transferWithAuthorization` — a gasless USDC transfer authorization.
3. **ArisPay** validates the request against your delegation limits (`maxPerTx`, `maxDaily`, `maxMonthly`, `allowedDomains`), then signs via the CDP-managed wallet.
4. **payagent** retries the request with the signed payment in the `X-PAYMENT` header.
5. **Server's facilitator** submits the authorization on-chain and returns the API response.

Key properties:
- **No private keys in your agent** — the signing key lives in Coinbase CDP, never in your process.
- **Server-enforced limits** — ArisPay rejects requests that breach your delegation before signing.
- **No gas for agents** — you sign the payment off-chain (EIP-3009); the seller's facilitator submits it and pays chain gas, not you.
- **USDC stablecoins** — amounts are in dollars, no price volatility.

## API

### `DelegationClient` — provision and monitor agents

```ts
const client = new DelegationClient('https://api.arispay.app', process.env.ARISPAY_KEY);

const agent = await client.createX402Agent({
  name: 'hermes-prod',
  agentType: 'hermes',
  maxPerTx: 100,       // cents
  maxDaily: 1000,
  maxMonthly: 10000,
  allowedDomains: ['api.example.com'],
  network: 'base',     // default
});
// agent.agentId, agent.walletAddress, agent.apiKey (returned ONCE)

// Wait for the wallet to be funded with USDC.
await client.pollUntilFunded(agent.agentId);

// Or check manually:
const balance = await client.getBalance(agent.agentId);
// { walletAddress, usdcBalance, network, fundedAt }
```

Supported `network` values: `base` (default, mainnet), `base-sepolia`, `ethereum`, `polygon`.

The `apiKey` returned by `createX402Agent` is the credential for this agent only — ArisPay stores only its SHA-256 hash and cannot recover it. Store it securely.

### `payFetchDelegated(config)` — drop-in fetch

```ts
const fetch402 = payFetchDelegated({
  arispayUrl: 'https://api.arispay.app',
  apiKey: agent.apiKey,
});
const res = await fetch402('https://api.example.com/data');
```

Works like native `fetch`. On 402, payagent asks ArisPay to sign via CDP, then retries. If ArisPay rejects (limit breach, disallowed domain, etc.), throws `PaymentRejectedError`.

### `getUSDCBalance(address, chain?, rpcUrl?)` — direct on-chain read

```ts
import { getUSDCBalance, formatUSDC } from 'payagent';

const raw = await getUSDCBalance(agent.walletAddress);           // default chain: 'base'
const raw2 = await getUSDCBalance(agent.walletAddress, 'base');
console.log(formatUSDC(raw), 'USDC');
```

Utility that reads USDC balance directly from any EVM RPC — handy for sanity-checking wallet state independent of ArisPay's balance endpoint.

## Supported chains

| Chain | Network ID | Notes |
|-------|-----------|-------|
| Base | `eip155:8453` | **Default** — mainnet, lowest fees |
| Base Sepolia | `eip155:84532` | Testnet |
| Ethereum | `eip155:1` | Mainnet |
| Polygon | `eip155:137` | Mainnet |

## Errors

```ts
import {
  PaymentRejectedError,     // ArisPay denied signing, or server returned 402 after payment
  InvalidRequirementsError, // Could not parse the 402 response
  PayAgentError,            // Base class
} from 'payagent';
```

## Framework integrations

### Vercel AI SDK

```ts
import { createPayAgentTool } from 'payagent/vercel';
import { generateText } from 'ai';

const payTool = createPayAgentTool({
  arispayUrl: 'https://api.arispay.app',
  apiKey: process.env.ARISPAY_AGENT_KEY,
});

const { text } = await generateText({
  model: yourModel,
  tools: { pay_api: payTool },
  prompt: 'Get the premium forecast from https://weather-api.example.com/forecast',
});
```

Requires peer dependencies: `ai`, `zod`.

### LangChain

```ts
import { createPayAgentTool } from 'payagent/langchain';

const payTool = createPayAgentTool({
  arispayUrl: 'https://api.arispay.app',
  apiKey: process.env.ARISPAY_AGENT_KEY,
});
```

Requires peer dependency: `@langchain/core`.

### MCP server

Use [`@arispay/payagent-mcp`](https://www.npmjs.com/package/@arispay/payagent-mcp) to add payment capabilities to Claude Desktop, Cursor, or any MCP client.

## Migrating from 1.x

v2 removes the self-custody path (`payFetch`, `PayAgent`, raw private-key signing). ArisPay's product is delegated-custody only — keys live in Coinbase CDP with server-enforced limits.

Migration:
- Replace `payFetch({ privateKey })` with `payFetchDelegated({ arispayUrl, apiKey })`.
- Replace `new PayAgent({ privateKey, budget, maxPerRequest })` with `DelegationClient.createX402Agent({ maxPerTx, maxDaily, maxMonthly, ... })` to provision, then `payFetchDelegated` to transact.
- `BudgetExceededError`, `UnsupportedChainError`, and `DomainNotAllowedError` are gone — their equivalents are now server-side rejections surfaced as `PaymentRejectedError`.

## License

MIT
