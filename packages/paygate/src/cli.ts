#!/usr/bin/env node
/**
 * paygate CLI.
 *
 *   npx paygate init [flags]   scaffold a working x402 seller
 *
 * Zero runtime deps — see init.ts for the implementation.
 */

import { HELP_TEXT, runInit } from "./init.js";

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "init") {
    return runInit(rest);
  }

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(
      `paygate — make your API payable in one command.\n\nCommands:\n  init    scaffold a working x402 seller\n\n${HELP_TEXT}`,
    );
    return command === undefined ? 1 : 0;
  }

  process.stderr.write(`Unknown command: ${command}. Run \`paygate --help\` for usage.\n`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
