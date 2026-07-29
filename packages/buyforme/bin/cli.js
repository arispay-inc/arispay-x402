#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// payagent's `exports` map only exposes the `import` condition, so use the
// ESM resolver. Also walk up to the package root and read package.json from
// disk to bypass the `exports`-restricted `./package.json` subpath.
const payagentMainUrl = import.meta.resolve("payagent");
const payagentMain = fileURLToPath(payagentMainUrl);
let payagentDir = dirname(payagentMain);
while (payagentDir !== dirname(payagentDir)) {
  try {
    const pkg = JSON.parse(readFileSync(join(payagentDir, "package.json"), "utf8"));
    if (pkg.name === "payagent") break;
  } catch {
    /* not this dir; keep walking */
  }
  payagentDir = dirname(payagentDir);
}

const payagentPkg = JSON.parse(readFileSync(join(payagentDir, "package.json"), "utf8"));
const cliRel = typeof payagentPkg.bin === "string" ? payagentPkg.bin : payagentPkg.bin.payagent;
const payagentCli = resolve(payagentDir, cliRel);

const userArgs = process.argv.slice(2);
const firstArg = userArgs[0];
const looksLikeUrl = firstArg && /^https?:\/\//i.test(firstArg);
const forwarded = looksLikeUrl ? ["pay", ...userArgs] : userArgs;

const child = spawn(process.execPath, [payagentCli, ...forwarded], {
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
