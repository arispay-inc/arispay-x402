# agentmarketplace

The default registry for AI agents. Publish and discover MCP servers, x402-priced HTTP agents, and any callable agent service. Settled by ArisPay.

Humans browse at <https://agentmarketplace.arispay.app/>. Machines use the registry at `https://api.arispay.app/v1/marketplace`.

This CLI is **the self-serve publisher path**: the hosted marketplace surface is read-only, so `publish`, `claim`, and `validate` here are how listings get created, owned, and health-checked. There is no dashboard alternative.

## Ten-minute path

```bash
npm install -g agentmarketplace
agentmarketplace init                  # wizard — pick agent / publisher / browse
agentmarketplace merchant signup       # create a publisher account, no dashboard
agentmarketplace publish               # scaffolds agent.json if missing
agentmarketplace try mycompany/my-agent   # one command: agent + funding + paid call
```

## Install

```bash
npm install agentmarketplace
# or globally for the CLI:
npm install -g agentmarketplace
```

## CLI

```bash
# First run
agentmarketplace init                              # setup wizard
agentmarketplace merchant signup                   # publisher account — no dashboard needed
agentmarketplace agent create                      # agent wallet with spend limits
agentmarketplace agent balance <agentId>           # on-chain USDC balance of an agent's wallet

# Discover
agentmarketplace search "flight booking"
agentmarketplace search --tag=mcp --transport=mcp-stdio
agentmarketplace info hermes/booking

# Publish your own (the only publisher path — the web surface is read-only)
agentmarketplace publish                           # scaffolds agent.json on first run
agentmarketplace claim mycompany/my-agent          # claim an unclaimed listing via well-known
agentmarketplace validate mycompany/my-agent       # probe the endpoint: 402 + price match

# Install + run
agentmarketplace install hermes/booking            # writes MCP config for your client
agentmarketplace uninstall hermes/booking          # remove it again
agentmarketplace call arispay/x402-demo            # pay + call an http-x402 endpoint
agentmarketplace try arispay/x402-demo             # one-command: create agent, fund, call

# Auth
agentmarketplace login <ap_live_...>               # store ArisPay API key
agentmarketplace logout
agentmarketplace whoami
```

### Publishing

`agentmarketplace publish [path]` reads `agent.json` (scaffolding one interactively if missing), then pre-flights the endpoint with a HEAD request before uploading: paid x402 listings must answer `402`; everything else just has to respond. `--force` skips the pre-flight.

### Claiming

Unclaimed listings (aggregator-ingested or seeded) can be claimed by their real owners. `agentmarketplace claim <slug>` requires a developer key (`ap_live_` / `ap_test_`), prints a SHA-256 claim token, and walks you through serving it at `<homepage>/.well-known/arispay-claim.txt` before asking the server to verify. `--dry-run` prints the token and URL without attempting verification.

### Validating

`agentmarketplace validate <slug>` asks the registry to actively probe the listing's endpoint — for x402 listings it checks the 402 challenge and that the observed price matches — and persists `healthy` / `lastCheckedAt` server-side. Exits non-zero (with the reason) when unhealthy.

### Discovery for agents

`agentmarketplace search` is the human-facing lookup. For programmatic paid-API discovery inside an agent loop, agents can also use `payagent discover "QUERY" [--budget CENTS]` (the `payagent` CLI) or the `discover_paid_api` tool in `@arispay/payagent-mcp` — both hit the same `/v1/marketplace/discover` ranking endpoint, which accepts a budget cap in **integer cents**. The library below exposes it as `client.discover()`.

## `agent.json` manifest

```json
{
  "slug": "mycompany/booking",
  "name": "Booking Agent",
  "description": "Books flights and hotels.",
  "tags": ["travel", "booking"],
  "capabilities": ["flight-booking", "hotel-booking"],
  "endpoint": {
    "transport": "mcp-stdio",
    "command": "npx",
    "args": ["-y", "mycompany-booking-mcp", "{{ALLOWED_DIR}}"],
    "envKeys": ["MYCOMPANY_API_KEY"],
    "argPrompts": {
      "{{ALLOWED_DIR}}": {
        "description": "Directory the server can read from",
        "example": "/Users/you/documents",
        "required": true
      }
    }
  },
  "pricing": { "model": "free" },
  "homepage": "https://mycompany.example",
  "repository": "https://github.com/mycompany/booking"
}
```

### Transports

| Transport   | Required fields                         | When to use |
|-------------|-----------------------------------------|-------------|
| `mcp-stdio` | `command`, `args?`, `envKeys?`          | MCP server shipped as an npm package |
| `mcp-http`  | `url`                                   | Hosted MCP server |
| `http-x402` | `url`                                   | HTTP endpoint priced per call via x402 |
| `http`      | `url`, `envKeys?`                       | Plain HTTP agent (free or API-key) |

### Pricing models

`free` · `x402` (micropayment per call) · `apikey` (BYO key) · `subscription`

For `x402` listings set `amount` in **integer cents** (`25` = $0.25/call) and optional `currency` / `per` (`call` | `session` | `month`). Amounts are never floats or dollar strings.

## Library

```ts
import { HttpMarketplaceClient } from 'agentmarketplace';

const client = new HttpMarketplaceClient({
  baseUrl: 'https://api.arispay.app/v1/marketplace',
  apiKey: process.env.ARISPAY_API_KEY,
});

const { agents } = await client.search({ q: 'booking' });
const detail = await client.get('hermes/booking');

// Budget-bounded discovery (budget in integer cents):
const { candidates } = await client.discover({ intent: 'book a flight', budgetCentsMax: 100 });

// Publisher surface:
const published = await client.publish(manifest);   // POST /agents (bearer key required)
const health = await client.validate('mycompany/my-agent');
```

Exports: `HttpMarketplaceClient`, `parseManifest`, `WEB_BASE_URL`, `PLACEHOLDER_TOKEN_PATTERN`, `HEURISTIC_PLACEHOLDER_PATTERNS`, and all types (`AgentListing`, `AgentEndpoint`, `AgentPricing`, `AgentArgPrompt`, `MarketplaceSearchQuery`, `MarketplaceSearchResult`, `PublishAgentInput`, `DiscoverInput`, `DiscoverResult`, `ValidateResult`, `ListingCategory`, `ListingSource`).

### Placeholder args

Listings with mcp-stdio commands that take a user-supplied path or key should declare the placeholder tokens in `argPrompts`. `agentmarketplace install` scans the command + args for any `{{TOKEN}}` (uppercase-snake) and for legacy styles like `/path/to/...`, `YOUR_API_KEY`, `<path>` — then prompts the user before writing the MCP config. Pass `--no-placeholder-heuristic` to skip the legacy detection.

## Environment

| Var | Purpose | Default |
|-----|---------|---------|
| `ARISPAY_API_KEY` | Overrides the stored API key | — |
| `AGENTMARKETPLACE_URL` | Registry base URL | `https://api.arispay.app/v1/marketplace` |
| `AGENTMARKETPLACE_WEB_URL` | Human-facing web URL | `https://agentmarketplace.arispay.app` |
| `AGENTMARKETPLACE_EXPERIMENTAL` | `1` surfaces experimental commands in `--help` | — |

## MCP server

For in-loop discovery from agent tools (Claude, Cursor, etc.), install the MCP companion:

```bash
npm install -g agentmarketplace-mcp
```

## License

MIT
