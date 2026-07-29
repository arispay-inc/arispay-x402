/**
 * Tests for the `arispay-skill install` bin.
 *
 * The install bin is the primary distribution mechanism — it copies the
 * bundled `skill/` directory into `~/.hermes/skills/arispay/`. If this
 * breaks silently, every user who installs `@arispay/skill` ends up with
 * no skill on disk and their agent falls back to whatever legacy skill is
 * around. So exercise it end-to-end against a tmpdir.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BIN = join(__dirname, "..", "src", "install.mjs");

describe("arispay-skill install", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "arispay-skill-install-"));
  });
  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function run(args: string[]): { stdout: string; stderr: string; status: number } {
    try {
      const stdout = execFileSync("node", [BIN, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
      });
      return { stdout, stderr: "", status: 0 };
    } catch (err) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
      return {
        stdout: typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString() ?? ""),
        stderr: typeof e.stderr === "string" ? e.stderr : (e.stderr?.toString() ?? ""),
        status: e.status ?? 1,
      };
    }
  }

  it("copies the bundled skill into the destination", () => {
    const dest = join(sandbox, "skills", "arispay");
    const result = run(["install", "--dest", dest]);
    expect(result.status).toBe(0);
    expect(existsSync(join(dest, "SKILL.md"))).toBe(true);
    expect(existsSync(join(dest, "scripts", "pay.mjs"))).toBe(true);
  });

  it("copies SKILL.md byte-for-byte from the source", () => {
    const dest = join(sandbox, "skills", "arispay");
    run(["install", "--dest", dest]);
    const src = readFileSync(join(__dirname, "..", "skill", "SKILL.md"), "utf-8");
    const copied = readFileSync(join(dest, "SKILL.md"), "utf-8");
    expect(copied).toBe(src);
  });

  it("leaves the PRIORITY DIRECTIVE block intact", () => {
    const dest = join(sandbox, "skills", "arispay");
    run(["install", "--dest", dest]);
    const copied = readFileSync(join(dest, "SKILL.md"), "utf-8");
    expect(copied).toContain("PRIORITY DIRECTIVE");
    expect(copied).toContain("npx payagent pay <url>");
  });

  it("is idempotent — running twice does not fail", () => {
    const dest = join(sandbox, "skills", "arispay");
    const first = run(["install", "--dest", dest]);
    const second = run(["install", "--dest", dest, "--force"]);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(existsSync(join(dest, "SKILL.md"))).toBe(true);
  });

  it("overwrites existing SKILL.md so upgrades actually propagate", () => {
    const dest = join(sandbox, "skills", "arispay");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "SKILL.md"), "STALE CONTENT FROM A PRIOR VERSION");
    run(["install", "--dest", dest, "--force"]);
    const copied = readFileSync(join(dest, "SKILL.md"), "utf-8");
    expect(copied).not.toContain("STALE CONTENT");
    expect(copied).toContain("PRIORITY DIRECTIVE");
  });

  it("`path` subcommand prints the default destination", () => {
    const result = run(["path"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/[/\\]\.hermes[/\\]skills[/\\]arispay$/);
  });

  it("rejects unknown subcommands with non-zero exit", () => {
    const result = run(["bogus"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unknown command");
  });
});
