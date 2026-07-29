#!/usr/bin/env node
import { cmdAgent } from "./commands/agent.js";
import { cmdConnect } from "./commands/connect.js";
import { cmdDiscover } from "./commands/discover.js";
import { cmdDoctor, cmdLogout, cmdWhoami } from "./commands/doctor.js";
import { cmdInit } from "./commands/init.js";
import { cmdInspect } from "./commands/inspect.js";
import { cmdPayMerchant } from "./commands/pay-merchant.js";
import { cmdPay } from "./commands/pay.js";
import { cmdQuickstart } from "./commands/quickstart.js";
import { cmdUser } from "./commands/user.js";
import { VERSION, handleFatal } from "./lib/cli-helpers.js";
/* eslint-disable no-console */
/**
 * payagent — command-line launcher.
 *
 * Thin wrapper around `DelegationClient`, `launchAgent`, and the device-code
 * helpers. Matches the same config store as the `payagent-mcp` server, so
 * credentials created on the command line flow through to MCP hosts.
 *
 *   payagent init                                    # browser OAuth → API key
 *   payagent agent create --name hermes \\
 *     --per-tx 0.50 --daily 10 --monthly 100         # amounts in dollars
 *   payagent agent fund hermes                       # print address + QR, poll
 *   payagent agent balance hermes                    # one-shot
 *   payagent agent list
 *   payagent pay https://api.example.com/premium     # one-off paid call
 *   payagent whoami
 *   payagent logout
 *
 * Every command respects `ARISPAY_API_KEY` and `ARISPAY_URL` env overrides.
 *
 * The dispatch is intentionally thin — each command lives in its own
 * file under `commands/`, and shared parsing / formatting / error
 * handling lives in `lib/cli-helpers.ts`.
 */
import { maybePrintStalenessNudge } from "./version-check.js";

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  // Fire-and-forget staleness check. Tightly timeboxed; never blocks
  // the actual command. Skip when the user is just asking for `--version`
  // (don't fetch the network to answer a local question).
  const skipNudge = cmd === "--version" || cmd === "-v" || cmd === "version" || cmd === "doctor";
  if (!skipNudge) {
    void maybePrintStalenessNudge("payagent", VERSION);
  }
  try {
    switch (cmd) {
      case "init":
        await cmdInit();
        break;
      case "quickstart":
      case "bootstrap":
        await cmdQuickstart(rest);
        break;
      case "doctor":
      case "status":
        await cmdDoctor();
        break;
      case "logout":
        cmdLogout();
        break;
      case "whoami":
        cmdWhoami();
        break;
      case "agent":
        await cmdAgent(rest);
        break;
      case "user":
        await cmdUser(rest);
        break;
      case "connect":
        await cmdConnect(rest);
        break;
      case "discover":
        await cmdDiscover(rest);
        break;
      case "inspect":
        await cmdInspect(rest);
        break;
      case "pay":
        await cmdPay(rest);
        break;
      case "pay-merchant":
        await cmdPayMerchant(rest);
        break;
      case "--help":
      case "-h":
      case "help":
      case undefined:
        printUsage();
        break;
      case "--version":
      case "-v":
      case "version":
        console.log(VERSION);
        break;
      default:
        console.error(`payagent: unknown command \`${cmd}\``);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    handleFatal(err);
  }
}

function printUsage(): void {
  console.log(`payagent ${VERSION}`);
  console.log("");
  console.log("Commands:");
  console.log("  quickstart --email X [--name N] [--agent-name A] [--fund USD]");
  console.log(
    "                                Headless one-shot: create an account + agent + wallet (no browser).",
  );
  console.log(
    "                                Equivalent: `bootstrapAgent({ email, name })` from the SDK.",
  );
  console.log(
    "  connect CODE                  Connect an existing BuyForMe wallet to this computer.",
  );
  console.log(
    '                                Get the code from your wallet\'s "Connect to your AI" section.',
  );
  console.log(
    "  init                          Pair an existing ArisPay account via browser (device-code flow).",
  );
  console.log(
    "  doctor                        Diagnose local config: binary, version, key validity, agents.",
  );
  console.log(
    "  status                        Same as doctor, with a readiness checklist and next command.",
  );
  console.log("  logout                        Clear the stored developer API key.");
  console.log("  whoami                        Print the current developer key + base URL.");
  console.log("");
  console.log(
    "  agent create [NAME] [--per-tx N --daily N --monthly N] [--domains CSV] [--network base|ethereum|polygon]",
  );
  console.log(
    "                                Create an agent with spend limits. NAME is positional.",
  );
  console.log(
    "                                When all three limits are omitted, sandbox-style defaults apply",
  );
  console.log(
    "                                ($0.50/tx, $10/day, $100/month). Override any individually.",
  );
  console.log("  agent fund NAME [--hosted [AMOUNT]]");
  console.log(
    "                                Print a funding address (default) or a hosted onramp URL",
  );
  console.log(
    "                                (--hosted, requires ARISPAY_ONRAMP_PROVIDER on the API).",
  );
  console.log("                                Either way, polls until USDC arrives.");
  console.log("  agent balance NAME            Show USDC balance + fundedAt.");
  console.log("  agent list                    List locally-stored agents.");
  console.log(
    "  agent remove NAME             Remove an agent from the local cache (not the server).",
  );
  console.log("");
  console.log("  user create --external-id X [--email X] [--find-or-create]");
  console.log(
    "                                Create an end-user (your customer) under your developer org.",
  );
  console.log(
    "  user attach-card USER_ID      Hosted card-entry URL, polls until the card is tokenized.",
  );
  console.log("  user attach-wallet USER_ID --address 0x... --chain base|ethereum|polygon|solana");
  console.log("  user set-limits USER_ID --agent NAME [--per-tx N] [--daily N] [--monthly N]");
  console.log("                                Per-user, per-agent spend override.");
  console.log("  user status USER_ID           Card + wallet + allowance readiness.");
  console.log("");
  console.log('  discover "QUERY" [--budget CENTS] [--category C] [--transport T] [--limit N] [--json]');
  console.log(
    "                                Search the ArisPay paid-API catalog. Read-only and free —",
  );
  console.log(
    "                                no key, no payment. --budget is integer cents (500 = $5.00).",
  );
  console.log("  inspect URL [--json]          Fetch an x402-gated URL WITHOUT paying and show its");
  console.log(
    "                                price, asset, network, and payTo. Never sends payment.",
  );
  console.log("");
  console.log("  pay URL [--agent NAME] [--method GET|POST|…] [--body STRING]");
  console.log(
    "          [--per-tx N] [--daily N] [--monthly N] [--network base|…] [--domains CSV]",
  );
  console.log("          [--amount N]");
  console.log(
    "                                Make a single paid x402 HTTP request. Self-bootstraps on first run:",
  );
  console.log(
    "                                signs you in (device-code), creates an agent named `default` with",
  );
  console.log(
    "                                conservative limits and the URL's hostname allowlisted, and prints",
  );
  console.log(
    "                                a Coinbase onramp link (or wallet address) if the agent has 0 USDC.",
  );
  console.log(
    "                                Progress goes to stderr; the response body is written to stdout.",
  );
  console.log('  pay-merchant URL --amount $N --memo "..." [--user USER_ID] [--agent NAME]');
  console.log(
    '                       [--rail card|crypto|balance|mpp] [--merchant-name "..."] [--mcc 5411]',
  );
  console.log(
    "                       [--merchant-id mer_...]   route through a PayGate merchant + fire mirror",
  );
  console.log(
    "                                Create a merchant payment via /v1/payments. Rail is server-picked",
  );
  console.log(
    "                                unless overridden. For x402 API calls, use `pay` above instead.",
  );
  console.log("");
  console.log(
    'Amounts are in dollars (or your base currency). 5, 5.00, and "$5.00" all mean 500 cents.',
  );
  console.log("");
  console.log("Env overrides: ARISPAY_API_KEY, ARISPAY_URL, PAYAGENT_CONFIG_DIR.");
  console.log("Set PAYAGENT_NO_UPDATE_CHECK=1 to silence the latest-version nudge.");
}

main();
