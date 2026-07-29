---
name: agentmarketplace
description: Discover, install, and use AI agents from the default agent marketplace. Use this skill when the user asks to "find an agent/MCP server/tool that can X", wants to install a specific tool by name, needs to search for agents by capability/tag, or asks about the marketplace. Triggers include "agent that can", "MCP server for", "find a tool", "install X", "search the marketplace", "agentmarketplace".
---

# agentmarketplace

The default registry for AI agents — MCP servers, x402-priced HTTP agents, and anything callable. This skill wraps the `agentmarketplace` CLI so you can discover and install agents in-loop.

## When to use this skill

Use it whenever the user:
- Asks for "an agent that can X" (flight booking, web search, PDF parsing, etc.)
- Asks about an MCP server by name
- Wants to install a tool into their Claude Code / Cursor / Windsurf
- Asks what agents / tools / skills are available for some domain
- Mentions "agentmarketplace" or "the marketplace"

## Available commands

All commands are invoked via the `agentmarketplace` CLI. If the CLI isn't installed, run `npm install -g agentmarketplace` first.

### Discover

```bash
agentmarketplace search "<free-text query>"
agentmarketplace search --tag=<tag>           # browser, database, search, etc.
agentmarketplace search --transport=mcp-stdio
agentmarketplace search --capability=<cap>
```

Returns a list of matching listings with slug, transport, pricing, description.

### Inspect

```bash
agentmarketplace info <slug>
# e.g. agentmarketplace info modelcontextprotocol/filesystem
```

Returns full manifest + README.

### Install (auto-mutates MCP config)

```bash
agentmarketplace install <slug>                       # interactive client picker
agentmarketplace install <slug> --client=claude-code  # specific target
agentmarketplace install <slug> --client=all          # install everywhere
agentmarketplace install <slug> --yes                 # skip confirmation
```

This auto-edits the user's `~/.claude/mcp.json`, `~/.cursor/mcp.json`, or equivalent. Prompts for required env vars. Tell the user to restart their MCP client to activate.

### Tool-level search (cross-server)

```bash
agentmarketplace tool search "<query>"
```

Searches across all tools across all indexed MCP servers. Useful when the user wants a specific *capability* rather than a specific server.

### Publish (requires login)

```bash
agentmarketplace login <ap_live_key>
agentmarketplace publish ./agent.json
```

For users shipping their own agents.

### Remove

```bash
agentmarketplace uninstall <slug>
```

## How to use this skill in a conversation

1. **User asks for a capability.** Example: "Find me an agent that can search the web."
   - Run: `agentmarketplace search web search`
   - Show the user the top 3–5 results with slug + one-line description.
   - Ask: "Which one should I install?"

2. **User picks one.** Run: `agentmarketplace install <slug>`
   - The CLI will prompt for client choice + env vars. Relay those prompts to the user.
   - After install, tell the user to restart their MCP client.

3. **User asks what's available in a domain.** Run: `agentmarketplace search --tag=<domain>` and summarize.

4. **User mentions a specific tool by name.** Try `agentmarketplace info <slug>` first; if not found, `agentmarketplace search <name>`.

## Tips

- Slugs are of the form `publisher/name` (e.g. `modelcontextprotocol/filesystem`). If in doubt, run `search` to find the exact slug.
- Not all listings are MCP servers. Some are `http-x402` endpoints (paid HTTP agents) or plain `http` APIs. The `transport` field tells you.
- Paid listings show a `pricing` block. `pricing.model=x402` means per-call USDC payment via ArisPay; we'll settle that automatically when `tool call` lands (Phase 2).
- The registry URL is `https://api.arispay.app/v1/marketplace` — plain HTTPS, public reads, no auth for browsing.

## Don'ts

- Don't paste full manifests into the chat unless the user asks — summarize.
- Don't install without confirming the target client, unless the user says "install everywhere" or passes `--client=all`.
- Don't run `publish` without an authenticated user session (`agentmarketplace whoami` should show a key).
