# @arispay/skill

The ArisPay skill for AI agents. One install, one directive: any "pay this URL" request goes through `npx payagent pay <url>`.

No bespoke state files. No hand-rolled REST calls. No legacy x402 skill scripts. Just the `payagent` CLI doing what it already does — auth via device-code, agent provisioning with sensible defaults, Coinbase Onramp funding, and the paid fetch.

## Install

```bash
npm install -g @arispay/skill
arispay-skill install
```

That auto-detects where to put the skill:

- If you're inside a project root (the cwd has `package.json` or `.git`), it installs to `<cwd>/.claude/skills/arispay/` — the Claude Code project-local pattern.
- Otherwise it installs to `~/.claude/skills/arispay/` — the Claude Desktop / global pattern.

Override the destination explicitly:

| Flag | Destination | Use when |
|---|---|---|
| `--project` | `<cwd>/.claude/skills/arispay/` | Force Claude Code project-local (default in a project) |
| `--user` | `~/.claude/skills/arispay/` | Force Claude Desktop / global |
| `--hermes` | `~/.hermes/skills/arispay/` | Hermes-style hosts |
| `--dest PATH` | explicit | Anywhere else |

Print all candidates plus which is the default in this directory:

```bash
arispay-skill paths
```

If you're migrating from a legacy `x402-payagent-usdc` skill:

```bash
arispay-skill install --replace-legacy
```

That removes `~/.hermes/skills/x402-payagent-usdc/` so there's no ambiguity about which skill owns the flow.

## What the skill tells the agent

The shipped [`skill/SKILL.md`](./skill/SKILL.md) opens with a **PRIORITY DIRECTIVE**. For any paid API call, the agent runs:

```bash
npx payagent pay <url>
```

On a cold machine that single command prints (to stderr) a verification URL + code, creates a local agent with conservative spend limits, prints a Coinbase Onramp link for funding, polls until USDC arrives, and finally retries the URL with a signed `X-PAYMENT` header. The final HTTP body goes to stdout.

The directive also tells the agent:

- **NEVER bypass a 402** by trying a different URL, scraping, or asking the user to log in to the merchant.
- **NEVER ask the user for `ARISPAY_API_KEY`** — `payagent pay` handles that via device-code on first run.
- **NEVER maintain own state files** — `payagent` owns `~/.payagent/config.json`.
- **NEVER hand-roll REST calls** to authorize/sign payments — the CLI handles signing, retries, idempotency, and onramp fallback.
- **NEVER invoke legacy x402 skills** that predate `payagent 2.5.0`.
- **DO** relay verification URLs / onramp links / wallet addresses verbatim to the user and wait for the command to complete.

The skill also covers cold-start variants: `payagent quickstart` (no-browser email signup) and the `bootstrap_agent` / `pay_api` MCP tools for hosts running `@arispay/payagent-mcp`.

When the flow is ambiguous, agents should run:

```bash
npx payagent status
```

That command is the shared checklist for humans and agents: API target, auth state, cached agents, wallet funding, network, allowed domains, and the next command to run. If Coinbase Onramp is unavailable for the user's country or app, treat it as onramp availability, not a failed agent setup.

## What the skill does not do

It is intentionally short (~50 lines). The full REST API, SDK examples, webhook payloads, error catalog, and step-by-step flows for crypto / 3DS / x402 / autonomous-mode topup-and-spend are at:

- [arispay.app/docs](https://arispay.app/docs) — canonical reference
- [`payagent`](https://www.npmjs.com/package/payagent) on npm — SDK + CLI
- [`@arispay/payagent-mcp`](https://www.npmjs.com/package/@arispay/payagent-mcp) on npm — MCP server

The skill stays tight so an agent's context window isn't burned on REST reference it doesn't need at runtime.

## Layout

```
@arispay/skill
├── src/install.mjs       the `arispay-skill install` command
├── skill/                the literal skill directory copied on install
│   ├── SKILL.md          the priority directive + cold-start guidance
│   └── scripts/pay.mjs   thin fallback wrapper that spawns `npx payagent pay`
├── package.json
└── README.md             you are here
```

## Why it stays tiny

Every improvement to `payagent` (new rails, better errors, Coinbase Onramp tweaks) flows through `npx payagent pay` automatically on the next run. This package is intentionally a thin director — no business logic duplicated. Upgrades are `npm install -g @arispay/skill@latest && arispay-skill install` and that's it.

## Related

- [`payagent`](https://www.npmjs.com/package/payagent) — the SDK + CLI the skill directs to.
- [`@arispay/payagent-mcp`](https://www.npmjs.com/package/@arispay/payagent-mcp) — MCP server exposing the same primitives for Claude Desktop / Cursor / any MCP host. Pairs well with this skill.

## License

MIT
