# @arispay/skill

## 2.1.2

### Patch Changes

- 52b38ba: Document the `payagent discover` / `payagent inspect` read-only discovery workflow ahead of `payagent pay`, and fix the stale `bootstrap_agent` MCP tool reference (the cold-start tool is `create_user`).

## 2.1.1

### Patch Changes

- 9a11597: docs: sync fee framing to the never-charge policy and make the facilitator discoverable from the agent skill. payagent's README no longer says the facilitator "sponsors gas" (it doesn't — agents sign off-chain, the seller submits and pays chain gas). `@arispay/skill`'s SKILL.md now references `facilitator.arispay.app` as read-only discovery context (USDC + EURC on Base; `payagent` still handles all settlement).

## 2.1.0

### Minor Changes

- 15b59e4: SKILL.md gains a "Deeper reference (read-only)" escape hatch: when a question isn't answered by the skill or the tools, fetch `https://arispay.app/llms-full.txt`. Reference material only — the MUST NEVER rules still apply and payments still go through `payagent`. Skill frontmatter version bumped to 1.1.0.

## 2.0.1

### Patch Changes

- f2bbfd9: Improve PayAgent first-run guidance with status/readiness output, clearer funding handoff, and updated Hermes skill instructions.

## 2.0.0

### Major Changes

- cc418ba: Cut SKILL.md from 121 → 46 lines. Parallel-class minimal.

  **Why major.** Removed three sections that agents may have been keying on:

  - **Operating Modes** (platform vs autonomous) — dev concept, agents calling `payagent pay` don't pick a mode at runtime.
  - **Payment Rails** (card / crypto / x402 / balance) — invisible to the agent calling `pay`; the rail is server-picked.
  - **Setup (Developers)** — wrong audience for a runtime skill.

  Plus consolidation:

  - Behavior Rules folded into the **MUST NEVER** list — duplicates removed, the load-bearing rules (never expose secrets, never retry on payment failure, confirm before paying real money) preserved as discrete points.
  - MCP host setup section reduced to a one-row table entry pointing at `@arispay/payagent-mcp`'s tools by name. The full `claude_desktop_config.json` config block moved out — that's one-time install context, not runtime agent guidance, and lives at <https://arispay.app/docs>.

  **What's preserved** (all the critical runtime directives):

  - PRIORITY DIRECTIVE: `npx payagent pay <url>`.
  - All six MUST NEVER rules: bypass 402, substitute (curl/fetch/legacy), ask for `ARISPAY_API_KEY`, maintain own state, invoke legacy x402 skill, expose secrets.
  - Cold-start variants table: human-at-keyboard / no-human / inside-MCP-host.
  - Failure handling: surface error code verbatim, no retry, no rail-switch, no scrape.
  - Confirm-before-paying.

  The skill now loads in under 50 lines of context per turn — competitive with Parallel's MPP skill (~75 lines) and the lowest-friction agent guidance we can ship without losing directive coverage.

## 1.0.0

### Major Changes

- 6a84813: Tighten the skill: ~1170 lines → ~120 lines, stronger directive language, smarter install defaults.

  **Why major.** Two consumer-visible behavior changes that may break existing flows:

  1. **Default install destination changed.** `arispay-skill install` now auto-detects: project-local (`<cwd>/.claude/skills/arispay/`) when the cwd is a project root, else `~/.claude/skills/arispay/` (Claude Desktop). The legacy default (`~/.hermes/skills/arispay/`) is preserved behind `--hermes`. Hermes hosts that hard-coded the legacy path need to either re-run `arispay-skill install --hermes` or update their skill loader.

  2. **Bulk REST reference removed from `SKILL.md`.** Agents that were keying on the embedded REST examples (curl invocations for `/v1/agents`, `/v1/users`, `/v1/payments`, etc.) will not find them anymore. Those endpoints still exist; the canonical reference is now `https://arispay.app/docs` and the published `payagent` / `@arispay/payagent-mcp` SDKs. The skill stays focused on the agent's runtime decision tree (when to pay, what command to run, when to escalate).

  **What's in the new skill** (~120 lines):

  - PRIORITY DIRECTIVE: stronger imperative — `npx payagent pay <url>` for any paid URL, with explicit MUST-NEVER list (never bypass 402, never scrape, never ask for `ARISPAY_API_KEY`, never hand-roll REST, never maintain own state files).
  - Cold-start variants table: `payagent pay` for human-at-keyboard, `payagent quickstart` for headless / CI, `bootstrap_agent` MCP tool for inside Claude Desktop / Cursor.
  - MCP host setup snippet (`claude_desktop_config.json` config block).
  - Behavior rules — five priority-ordered, runtime-relevant only.
  - Reference pointer — links to `arispay.app/docs`, both npm packages.

  **Smarter install** (`arispay-skill install`):

  - Auto-detect: project root → `<cwd>/.claude/skills/arispay/`; else → `~/.claude/skills/arispay/`.
  - New flags: `--project` (force project-local), `--user` / `--global` (force `~/.claude/skills/`), `--hermes` (legacy `~/.hermes/skills/`).
  - Existing `--dest`, `--replace-legacy`, `--force` unchanged.
  - New `arispay-skill paths` command — lists all candidate destinations and shows which is the default in the current directory.

  This pairs with `payagent@2.8.0` and `@arispay/payagent-mcp@2.6.0` (already shipped), which have the `quickstart` CLI and `bootstrap_agent` MCP tool the new skill points at.

## 0.12.0

### Minor Changes

- eaf4d35: Direct agents at the new headless cold-start path. Two new sections in `SKILL.md`:

  - **Headless Quickstart (No Browser, No Human Required)** — points agents at `npx payagent quickstart --email ... --name ...` for the case where no human is available to click a device-code verification URL. Documents when to pick `quickstart` vs the existing `payagent pay` (which still works).
  - **Inside an MCP Host** — points agents at `@arispay/payagent-mcp`'s `bootstrap_agent` and `pay_api` MCP tools when invoked from Claude Desktop / Cursor / Hermes-via-MCP. Includes the install config for `claude_desktop_config.json`.

  Plus stale-content fixes:

  - Fix dashboard URL: `web-production-43119.up.railway.app/dashboard/api-keys` → `arispay.app/dashboard/payagent`.
  - Fix sandbox-default limit numbers in the "Headless Pay" example: `$5/tx, $20/day, $100/month` → `$0.50/tx, $10/day, $100/month` (the actual current `payagent pay` self-bootstrap defaults).
  - Note `ap_live_` is the production prefix (was previously also referencing `ap_test_` which is no longer minted by any signup path).

  The existing `npx payagent pay <url>` priority directive stands — this is purely additive guidance for cold-start scenarios and MCP environments.

## 0.10.0

### Minor Changes

- 510d4da: First public release: `@arispay/skill` ships a Hermes-installable skill whose prompt hands all "pay this URL" requests to `npx payagent pay <url>` and explicitly forbids hand-rolled auth / state / REST workarounds.

  **Why this exists.** The legacy `x402-payagent-usdc` skill that users have on their VPSs predates `payagent` 2.5.0's self-bootstrap. Its own `create.mjs` / `pay.mjs` / `_state.mjs` re-implement what the CLI now does, and they drift (stale keys, `localhost:3001` URLs, `base-sepolia` defaults). Testing showed agents running that skill intercept the user's literal `npx payagent pay` command, bypass its device-code gate, and fall back to their own broken flow. The fix has to live in the skill layer, not the SDK.

  **What ships:**

  - `skill/SKILL.md` — opens with a **PRIORITY DIRECTIVE** block. Rule 1: for any paid-URL request, run `npx payagent pay <url>` and nothing else. Rule 2: relay stderr URLs to the user verbatim and wait for the command to complete. Rule 3: do not maintain local state files or invoke legacy x402 skills. Full REST reference is retained below the directive for developer-persona callers (webhooks, compliance, autonomous topups).
  - `skill/scripts/pay.mjs` — thin fallback for agents that require a `scripts/<name>.mjs` entry point. Spawns `npx -y payagent pay <args>` with inherited stdio and propagates the exit code. Zero state.
  - `src/install.mjs` — new `arispay-skill` bin. `arispay-skill install` copies `skill/` to `~/.hermes/skills/arispay/`. `--dest` targets a custom path (Claude Desktop skills dir, dev sandboxes). `--replace-legacy` removes `~/.hermes/skills/x402-payagent-usdc/` so there's no ambiguity. `--force` silences the overwrite warning.
  - `README.md` — developer-facing install instructions (`npm install -g @arispay/skill && arispay-skill install`).
  - `test/install.test.ts` — 7 tests: copies bundled files, byte-for-byte equality, directive preserved, idempotent, overwrites stale content so upgrades propagate, `path` subcommand, unknown-command rejection.

  **Package reshape:** removed `private: true`, version bumped 0.1.0 → 0.9.0 (matches the skill manifest's own version field), added `bin`, `files`, `description`, `keywords`, repo metadata. Removed from the Changesets ignore list so future bumps publish.

  **Expected user flow going forward:**

  ```bash
  npm install -g @arispay/skill
  arispay-skill install --replace-legacy
  ```

  Then the Hermes-on-Telegram cold test that failed today ("npx payagent pay stabletravel.dev/…" → agent ignored it and ran its own broken scripts) becomes: agent reads `~/.hermes/skills/arispay/SKILL.md`, sees the directive, runs the literal command, relays the device-code URL to the user, waits for funding, returns the flight JSON.
