#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve @arispay/payagent-mcp's package root via the ESM resolver, then
// read package.json from disk (avoids any `exports`-field restrictions on
// the ./package.json subpath).
const upstreamMainUrl = import.meta.resolve("@arispay/payagent-mcp");
const upstreamMain = fileURLToPath(upstreamMainUrl);
let upstreamDir = dirname(upstreamMain);
while (upstreamDir !== dirname(upstreamDir)) {
  try {
    const pkg = JSON.parse(readFileSync(join(upstreamDir, "package.json"), "utf8"));
    if (pkg.name === "@arispay/payagent-mcp") break;
  } catch {
    /* not this dir; keep walking */
  }
  upstreamDir = dirname(upstreamDir);
}

const upstreamPkg = JSON.parse(readFileSync(join(upstreamDir, "package.json"), "utf8"));
const binRel =
  typeof upstreamPkg.bin === "string" ? upstreamPkg.bin : upstreamPkg.bin["payagent-mcp"];
const upstreamBin = resolve(upstreamDir, binRel);

// MCP servers communicate over stdio JSON-RPC; inherit all three streams so
// the host (Claude Desktop, Cursor, Windsurf) talks to the upstream server
// without this proxy ever parsing the protocol.
const child = spawn(process.execPath, [upstreamBin, ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
