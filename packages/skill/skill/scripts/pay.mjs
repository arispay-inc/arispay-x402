#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Thin wrapper around `npx payagent pay <url>`.
 *
 * The ArisPay skill prefers that the agent run `npx payagent pay <url>`
 * directly (that's the PRIORITY DIRECTIVE in SKILL.md). This script exists
 * only as a fallback for agents that require a local `scripts/<name>.mjs`
 * entry point — it spawns the CLI, streams stderr to the caller so
 * verification / funding URLs reach the user in real time, and writes the
 * final HTTP body to stdout.
 *
 * Intentionally does NOT maintain local state. `payagent` owns its state at
 * `~/.payagent/config.json`. Any extra state file in this directory is a
 * bug.
 *
 * Usage:
 *   node pay.mjs <url> [--agent NAME] [--per-tx N] [--daily N] [--monthly N]
 *                      [--network base|base-sepolia|ethereum|polygon]
 *                      [--domains CSV] [--method GET|POST|...] [--body STRING]
 *                      [--amount N]
 *
 * All flags are forwarded verbatim to `payagent pay`. Exit code is the CLI's
 * exit code, so the caller can distinguish success (0) from any kind of
 * failure (non-zero) without parsing stderr.
 */

import { spawn } from "node:child_process";

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.error("Usage: pay.mjs <url> [payagent pay flags]");
  console.error("");
  console.error("This is a thin wrapper around `npx payagent pay`. See:");
  console.error("  npx payagent pay --help");
  process.exit(args.length === 0 ? 1 : 0);
}

const child = spawn("npx", ["-y", "payagent", "pay", ...args], {
  stdio: "inherit",
});

child.on("error", (err) => {
  console.error(`pay.mjs: failed to spawn \`npx payagent pay\` — ${err.message}`);
  console.error("Is Node.js installed and on PATH?");
  process.exit(127);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`pay.mjs: payagent exited on signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
