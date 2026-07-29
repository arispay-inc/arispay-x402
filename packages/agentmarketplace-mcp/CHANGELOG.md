# Changelog

## 0.4.1

### Patch Changes

- cc1263a: Re-supported: restored the Changesets release path, refreshed metadata, and documented call_agent / proxy_tool_call / publish_agent. No API changes.
- Updated dependencies [cc1263a]
  - agentmarketplace@0.7.1

## 0.4.0 — 2026-04-24

Adds `proxy_tool_call` — tool-scoped paid invocation for `http-x402` /
`http` listings. Agents pass `{ slug, tool, args }`; the MCP server
appends `tool` to the listing's endpoint URL as a path, posts `args` as
JSON, and pays via `payagent` when the listing is `x402`-priced.

`mcp-stdio` / `mcp-http` transports return a clear error pointing at
`install_agent` — subprocess / session lifecycle belongs in the MCP
host, not in this intermediate server.

On successful invocation the MCP server fires a non-blocking install
counter bump so marketplace ranking signals reflect actual usage.
