/* eslint-disable no-console */
/**
 * `agentmarketplace skill install` — copy the bundled SKILL.md into
 * `~/.claude/skills/agentmarketplace/SKILL.md` so Claude Code / Desktop
 * can discover it.
 *
 * Exported (and called) from `cmdInit` too — running `init` on a system
 * with Claude detected installs the skill silently.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILL_DEST_DIR } from "../lib/cli-helpers.js";

export function cmdSkillInstall(opts: { silent?: boolean } = {}): void {
  const here = dirname(fileURLToPath(import.meta.url));
  // When bundled into dist/, SKILL.md is copied to dist/skill/SKILL.md.
  // The new location after the cli split: dist/commands/skill.js → step
  // back two levels (commands/ → dist/) before joining `skill/SKILL.md`.
  const source = existsSync(join(here, "skill", "SKILL.md"))
    ? join(here, "skill", "SKILL.md")
    : join(here, "..", "skill", "SKILL.md");
  if (!existsSync(source)) {
    if (opts.silent) throw new Error(`skill file missing at ${source}`);
    console.error(`Bundled skill file missing at ${source}`);
    console.error("This is a packaging bug — please file an issue.");
    process.exit(1);
  }
  if (!existsSync(SKILL_DEST_DIR)) mkdirSync(SKILL_DEST_DIR, { recursive: true });
  const dest = join(SKILL_DEST_DIR, "SKILL.md");
  copyFileSync(source, dest);
  if (!opts.silent) {
    console.log(`✓ Installed skill to ${dest}`);
    console.log("\nRestart Claude Code (or reload your editor) for the skill to activate.");
    console.log("After that, ask your agent: 'find an agent that can [do X]'.");
  }
}
