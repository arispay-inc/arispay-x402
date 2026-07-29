#!/usr/bin/env node
import { cmdAgent } from "./commands/agent.js";
import { cmdLogin, cmdLogout, cmdWhoami } from "./commands/auth.js";
import { cmdCall } from "./commands/call.js";
import { cmdClaim } from "./commands/claim.js";
import { cmdInfo } from "./commands/info.js";
import { cmdInit } from "./commands/init.js";
import { cmdInstall, cmdUninstall } from "./commands/install.js";
import { cmdMerchant } from "./commands/merchant.js";
import { cmdPublish } from "./commands/publish.js";
import { cmdSearch } from "./commands/search.js";
import { cmdSkillInstall } from "./commands/skill.js";
import { cmdTool } from "./commands/tool.js";
import { cmdTry } from "./commands/try.js";
import { cmdValidate } from "./commands/validate.js";
import { WEB_BASE_URL } from "./index.js";
/* eslint-disable no-console */
/**
 * agentmarketplace — discover, install, and publish AI agents.
 *
 *   agentmarketplace init                              # first-run wizard
 *   agentmarketplace search [query] [flags]            # find agents
 *   agentmarketplace info <slug>                       # full manifest
 *   agentmarketplace install <slug> [--client=...]     # auto-install into MCP config
 *   agentmarketplace uninstall <slug> [--client=...]   # remove from MCP config
 *   agentmarketplace call <slug> [--method=X --body=Y] # invoke an http / http-x402 endpoint (pays via ArisPay)
 *   agentmarketplace try <slug>                        # one-command paid call: creates an agent, funds, pays
 *   agentmarketplace agent create [--name=... ...]     # create an x402 agent (wallet + spend limits)
 *   agentmarketplace merchant signup [--email=... ...] # create a publisher account — no dashboard needed
 *   agentmarketplace claim <slug>                      # claim an unclaimed listing via /.well-known/arispay-claim.txt
 *   agentmarketplace publish [path=./agent.json]       # publish your own listing
 *   agentmarketplace validate <slug>                   # probe a listing's endpoint, verify 402 + price match
 *   agentmarketplace skill install                     # install Claude skill wrapper
 *   agentmarketplace login <api-key>                   # store ArisPay API key
 *   agentmarketplace logout
 *   agentmarketplace whoami
 *
 * Each command lives in its own file under `commands/`. Shared
 * helpers (config store, formatting, parsing, prompting) live in
 * `lib/cli-helpers.ts`.
 */
import { DEFAULT_BASE_URL, WEB_URL, isExperimental } from "./lib/cli-helpers.js";

function usage(): void {
  const experimentalBlock = isExperimental()
    ? `
Experimental:
  agentmarketplace tool search [query]               # tool-level search (indexing partial)
`
    : "";
  console.log(`agentmarketplace — discover, install, and publish AI agents

Usage:
  agentmarketplace init                              # first-run wizard
  agentmarketplace search [query] [flags]            # find agents
  agentmarketplace info <slug>                       # full manifest
  agentmarketplace install <slug> [--client=...]     # auto-install into MCP config
  agentmarketplace uninstall <slug> [--client=...]   # remove from MCP config
  agentmarketplace call <slug> [--method=X --body=Y] # invoke an http / http-x402 endpoint (pays via ArisPay)
  agentmarketplace try <slug>                        # one-command paid call: creates an agent, funds, pays
  agentmarketplace agent create [--name=... ...]     # create an x402 agent (wallet + spend limits)
  agentmarketplace agent balance <agentId>           # check on-chain USDC balance of an agent's wallet
  agentmarketplace merchant signup [--email=... ...] # create a publisher account — no dashboard needed
  agentmarketplace claim <slug>                      # claim an unclaimed listing via /.well-known/arispay-claim.txt
  agentmarketplace publish [path=./agent.json]       # publish your own listing
  agentmarketplace validate <slug>                   # probe a listing's endpoint, verify 402 + price match
  agentmarketplace skill install                     # install Claude skill wrapper
  agentmarketplace login <api-key>                   # store ArisPay API key
  agentmarketplace logout
  agentmarketplace whoami
${experimentalBlock}
Search flags:
  --tag=X           filter by tag
  --transport=X     filter by transport (mcp-stdio, mcp-http, http-x402, http)
  --capability=X    filter by capability
  --publisher=X     filter by publisher
  --limit=N         max results

Install flags:
  --client=claude-desktop|claude-code|cursor|windsurf|all   target client (default: prompt)
  --yes                       skip confirmation prompts
  --no-placeholder-heuristic  don't guess at legacy-style placeholders in args

Environment:
  ARISPAY_API_KEY               Override stored API key
  AGENTMARKETPLACE_URL          Override registry URL (default: ${DEFAULT_BASE_URL})
  AGENTMARKETPLACE_WEB_URL      Override human-facing web URL (default: ${WEB_BASE_URL})
  AGENTMARKETPLACE_EXPERIMENTAL Set to 1 to surface experimental commands in --help
`);
  // WEB_URL is referenced in help text indirectly via per-command output;
  // keep the import live in case the help layout grows.
  void WEB_URL;
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  try {
    switch (cmd) {
      case "init":
        await cmdInit();
        break;
      case "search":
        await cmdSearch(rest);
        break;
      case "info":
        await cmdInfo(rest);
        break;
      case "install":
        await cmdInstall(rest);
        break;
      case "uninstall":
      case "remove":
        await cmdUninstall(rest);
        break;
      case "tool":
        await cmdTool(rest);
        break;
      case "call":
        await cmdCall(rest);
        break;
      case "agent":
        await cmdAgent(rest);
        break;
      case "merchant":
        await cmdMerchant(rest);
        break;
      case "try":
        await cmdTry(rest);
        break;
      case "claim":
        await cmdClaim(rest);
        break;
      case "publish":
        await cmdPublish(rest);
        break;
      case "validate":
        await cmdValidate(rest);
        break;
      case "skill": {
        const [sub] = rest;
        if (sub === "install") cmdSkillInstall();
        else {
          console.error("Usage: agentmarketplace skill install");
          process.exit(1);
        }
        break;
      }
      case "login":
        cmdLogin(rest);
        break;
      case "logout":
        cmdLogout();
        break;
      case "whoami":
        cmdWhoami(rest);
        break;
      case "--help":
      case "-h":
      case "help":
      case undefined:
        usage();
        break;
      default:
        console.error(`Unknown command: ${cmd}`);
        usage();
        process.exit(1);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

void main();
