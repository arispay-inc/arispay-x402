# agentmarketplace-mcp

MCP server that lets Claude, Cursor, Windsurf, and any MCP client discover, install, invoke, and publish AI agents from the default agent marketplace (`https://api.arispay.app/v1/marketplace`).

Once installed, your agent can ask itself things like:

> "Find me an MCP server that can book flights and costs nothing per call."

…and get actionable install instructions — or make the paid call directly — without leaving the loop.

## Install

### Claude Desktop / `~/.claude/mcp.json`

```json
{
  "mcpServers": {
    "agentmarketplace": {
      "command": "npx",
      "args": ["-y", "agentmarketplace-mcp"]
    }
  }
}
```

Add `"env": { "ARISPAY_API_KEY": "ap_live_..." }` to enable paid (`x402`) calls and publishing.

### Cursor / `~/.cursor/mcp.json`

Same config as above.

### Global install

```bash
npm install -g agentmarketplace-mcp
agentmarketplace-mcp   # runs on stdio
```

## Tools

| Tool | Purpose |
|------|---------|
| `search_agents` | Find agents by free-text query, tag, transport, or capability |
| `get_agent` | Full manifest + README for one agent by slug |
| `search_tools` | Tool-level search across all indexed listings (optionally scoped to one listing) |
| `list_tools_for_agent` | List the crawled tools of a single listing |
| `install_agent` | Ready-to-paste MCP config snippet or endpoint info for a listing |
| `call_agent` | Invoke an `http` / `http-x402` listing's endpoint directly. x402-priced calls settle via ArisPay (`payagent`'s delegated payment flow) and require `ARISPAY_API_KEY`. Non-2xx statuses are reported in-band as `HTTP <status>`. |
| `proxy_tool_call` | Tool-scoped invocation: appends the `tool` name to the listing's endpoint URL as a path segment and POSTs `args` as a JSON body. Same x402 payment handling as `call_agent`; bumps the listing's advisory install count on success. `http` / `http-x402` transports only — for MCP-transport listings use `install_agent` (subprocess/session lifecycle belongs in the MCP host). |
| `publish_agent` | Publish a new listing (requires `ARISPAY_API_KEY`). `pricingAmount` is **integer cents** (`25` = $0.25/call). |

### Related discovery tooling

`@arispay/payagent-mcp` ships a `discover_paid_api` tool backed by the same registry's `/discover` ranking endpoint — use that server when the goal is pay-flow integration (discover → pay in one toolchain). This server is the marketplace-native surface: search, tool indexes, install snippets, invocation, and publishing. The `agentmarketplace` CLI's `publish` / `claim` / `validate` commands remain the full self-serve publisher path.

## Environment

| Var | Purpose | Default |
|-----|---------|---------|
| `AGENTMARKETPLACE_URL` | Registry base URL | `https://api.arispay.app/v1/marketplace` |
| `ARISPAY_API_KEY` | Required for `publish_agent` and any x402-priced `call_agent` / `proxy_tool_call` | — |
| `ARISPAY_URL` | ArisPay API base used to settle paid calls | `https://api.arispay.app` |

## License

MIT
