# arispay-x402

Public source for ArisPay's x402 npm packages:

| Package | What it is |
|---|---|
| [`payagent`](packages/payagent) | Agent-side x402 SDK + CLI (delegated-custody wallets, discover/inspect/pay) |
| [`@arispay/payagent-mcp`](packages/payagent-mcp) | MCP server over payagent |
| [`paygate`](packages/paygate) | Seller-side middleware + `npx paygate init` scaffolder |
| [`@arispay/skill`](packages/skill) | Agent skill (SKILL.md) |
| [`buyforme`](packages/buyforme) / [`buyforme-mcp`](packages/buyforme-mcp) | User-brand aliases |
| [`agentmarketplace`](packages/agentmarketplace) | Marketplace CLI + client (publish, claim, validate, discover) |
| [`agentmarketplace-mcp`](packages/agentmarketplace-mcp) | Marketplace MCP server (search, call_agent, proxy_tool_call, publish) |

Generated from ArisPay's private monorepo — see [GENERATED-SOURCE.md](GENERATED-SOURCE.md).
Facilitator: https://facilitator.arispay.app · Docs: https://arispay.app

```bash
pnpm install --frozen-lockfile && pnpm build && pnpm test
```
