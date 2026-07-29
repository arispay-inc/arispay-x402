#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * arispay-skill — install the ArisPay skill into a host's skill directory.
 *
 * Default lookup order for the install destination:
 *   1. --dest PATH                 (explicit override; wins)
 *   2. --project                   forces <cwd>/.claude/skills/arispay/
 *   3. --user                      forces ~/.claude/skills/arispay/
 *   4. --hermes                    forces ~/.hermes/skills/arispay/
 *   5. (default) auto-detect:
 *        - If cwd looks like a project root (package.json or .git), install to
 *          <cwd>/.claude/skills/arispay/  (Claude Code project-local pattern)
 *        - Else install to ~/.claude/skills/arispay/  (Claude Desktop / global)
 *
 * The legacy ~/.hermes/skills/arispay/ remains supported via --hermes for
 * existing Hermes-style hosts.
 *
 * Usage:
 *   arispay-skill install                # auto-detect; default to project-local
 *   arispay-skill install --user         # ~/.claude/skills/arispay/
 *   arispay-skill install --hermes       # ~/.hermes/skills/arispay/
 *   arispay-skill install --dest PATH    # explicit
 *   arispay-skill install --replace-legacy
 *                                        # also removes ~/.hermes/skills/x402-payagent-usdc/
 *   arispay-skill paths                  # print all candidate destinations
 *   arispay-skill --help
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ME = fileURLToPath(import.meta.url);
const PKG_ROOT = resolve(dirname(ME), "..");
const SKILL_SRC = join(PKG_ROOT, "skill");

const HERMES_SKILLS_DIR = join(homedir(), ".hermes", "skills", "arispay");
const USER_CLAUDE_SKILLS_DIR = join(homedir(), ".claude", "skills", "arispay");
const LEGACY_SKILL = join(homedir(), ".hermes", "skills", "x402-payagent-usdc");

function projectClaudeSkillsDir(cwd = process.cwd()) {
  return join(cwd, ".claude", "skills", "arispay");
}

/** True if cwd looks like a project root (has package.json or a .git directory). */
function looksLikeProjectRoot(cwd = process.cwd()) {
  return existsSync(join(cwd, "package.json")) || existsSync(join(cwd, ".git"));
}

function defaultDest() {
  if (looksLikeProjectRoot()) return projectClaudeSkillsDir();
  return USER_CLAUDE_SKILLS_DIR;
}

function parseArgs(argv) {
  const [, , cmd, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === "--replace-legacy") flags.replaceLegacy = true;
    else if (a === "--dest") {
      flags.dest = rest[i + 1];
      i += 1;
    } else if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--force") flags.force = true;
    else if (a === "--project") flags.project = true;
    else if (a === "--user" || a === "--global") flags.user = true;
    else if (a === "--hermes") flags.hermes = true;
  }
  return { cmd, flags };
}

function resolveDest(flags) {
  if (flags.dest) return resolve(flags.dest);
  if (flags.project) return projectClaudeSkillsDir();
  if (flags.user) return USER_CLAUDE_SKILLS_DIR;
  if (flags.hermes) return HERMES_SKILLS_DIR;
  return defaultDest();
}

function printUsage() {
  console.log("arispay-skill — install the ArisPay skill into a host's skill directory.");
  console.log("");
  console.log("Commands:");
  console.log("  install [--project|--user|--hermes] [--dest PATH] [--replace-legacy] [--force]");
  console.log(
    "                             Default: auto-detect — project-local if cwd is a project,",
  );
  console.log("                             else ~/.claude/skills/arispay/.");
  console.log(
    "  paths                      Print all candidate destinations and which is the default here.",
  );
  console.log("  --help                     Show this message.");
  console.log("");
  console.log("Destinations:");
  console.log(
    "  --project   <cwd>/.claude/skills/arispay/   (Claude Code project-local; default in a project root)",
  );
  console.log(`  --user      ${USER_CLAUDE_SKILLS_DIR}   (Claude Desktop / global)`);
  console.log(`  --hermes    ${HERMES_SKILLS_DIR}   (Hermes-style hosts)`);
  console.log("  --dest      explicit path");
}

function copyTree(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);
    const s = statSync(srcPath);
    if (s.isDirectory()) {
      copyTree(srcPath, destPath);
    } else if (s.isFile()) {
      const data = readFileSync(srcPath);
      writeFileSync(destPath, data);
    }
  }
}

function cmdPaths() {
  const dflt = defaultDest();
  console.log("Candidate destinations:");
  console.log(
    `  project    ${projectClaudeSkillsDir()}${dflt === projectClaudeSkillsDir() ? "   ← default here" : ""}`,
  );
  console.log(
    `  user       ${USER_CLAUDE_SKILLS_DIR}${dflt === USER_CLAUDE_SKILLS_DIR ? "   ← default here" : ""}`,
  );
  console.log(`  hermes     ${HERMES_SKILLS_DIR}`);
}

function cmdInstall(flags) {
  const dest = resolveDest(flags);

  if (!existsSync(SKILL_SRC)) {
    console.error(`arispay-skill: bundled skill/ not found at ${SKILL_SRC}.`);
    console.error("This usually means the package was installed incorrectly. Try reinstalling:");
    console.error("  npm install -g @arispay/skill");
    process.exit(1);
  }

  if (existsSync(dest) && !flags.force) {
    // Overwrite is safe — the skill files are small and self-contained — but warn first.
    console.log(
      `arispay-skill: ${dest} already exists. Overwriting (pass --force to silence this warning).`,
    );
  }

  copyTree(SKILL_SRC, dest);
  console.log(`✓ ArisPay skill installed to ${dest}`);

  if (flags.replaceLegacy && existsSync(LEGACY_SKILL)) {
    rmSync(LEGACY_SKILL, { recursive: true, force: true });
    console.log(`✓ Removed legacy skill at ${LEGACY_SKILL}`);
  } else if (existsSync(LEGACY_SKILL)) {
    console.log("");
    console.log(`⚠️  Legacy skill detected at ${LEGACY_SKILL}.`);
    console.log("   It predates payagent 2.5.0 and will conflict with this one.");
    console.log("   Re-run with --replace-legacy to remove it.");
  }

  console.log("");
  console.log("Next step:");
  console.log(
    "  Your agent host (Claude Code, Claude Desktop, Cursor, Hermes …) discovers the skill",
  );
  console.log(
    '  at its next load. Ask the agent to "pay https://any-x402-merchant.com/..." to test.',
  );
}

function main() {
  const { cmd, flags } = parseArgs(process.argv);
  if (flags.help || cmd === "--help" || cmd === "-h" || cmd === "help") {
    printUsage();
    return;
  }
  switch (cmd) {
    case "install":
      cmdInstall(flags);
      break;
    case "paths":
    case "path":
      cmdPaths();
      break;
    case undefined:
      printUsage();
      break;
    default:
      console.error(`arispay-skill: unknown command \`${cmd}\``);
      printUsage();
      process.exit(1);
  }
}

main();
