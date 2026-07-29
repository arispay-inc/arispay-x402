# buyforme-mcp

MCP server alias for [`@arispay/payagent-mcp`](https://www.npmjs.com/package/@arispay/payagent-mcp).

Configure your MCP-capable client (Claude Desktop, Cursor, Windsurf, …) to spawn `buyforme-mcp` and the model gets a "buy for me" tool that pays any x402-priced URL via ArisPay delegated custody — no private keys in your process.

## Claude Desktop / Cursor / Windsurf config

```jsonc
{
  "mcpServers": {
    "buyforme": {
      "command": "npx",
      "args": ["-y", "buyforme-mcp"]
    }
  }
}
```

That's identical to using `@arispay/payagent-mcp` directly — the proxy spawns the upstream server with stdio inherited, so the JSON-RPC stream flows through without inspection or modification.

## What you get inside the model

The same MCP tools the upstream server exposes — `pay_api`, `check_wallet`, `create_agent`, `fund_agent`, `get_balance`, `list_agents` — backed by [ArisPay](https://arispay.app)'s delegated-custody wallets: Coinbase CDP holds the signing key, ArisPay enforces per-tx, daily, monthly, and allowed-domain limits server-side, and signs on the agent's behalf when it hits an HTTP 402.

For the full tool surface, see the [`@arispay/payagent-mcp` README](https://www.npmjs.com/package/@arispay/payagent-mcp).

## Related

- [`buyforme`](https://www.npmjs.com/package/buyforme) — the matching CLI alias (`npx buyforme <url>`)
- [`payagent`](https://www.npmjs.com/package/payagent) — the underlying SDK + CLI

## License

MIT © Polar Industries Ltd
