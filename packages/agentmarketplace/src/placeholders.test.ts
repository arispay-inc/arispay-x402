import { describe, expect, it } from "vitest";
import {
  detectPlaceholders,
  hasUnresolvedPlaceholders,
  substitutePlaceholder,
} from "./placeholders.js";

describe("detectPlaceholders", () => {
  it("finds declared {{TOKEN}} placeholders in args", () => {
    const r = detectPlaceholders(
      {
        command: "npx",
        args: ["-y", "srv", "{{ALLOWED_DIR}}"],
        argPrompts: {
          "{{ALLOWED_DIR}}": { description: "Directory to serve", required: true },
        },
      },
      { heuristic: true },
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      token: "{{ALLOWED_DIR}}",
      declared: true,
      location: "args[2]",
    });
    expect(r[0].prompt?.required).toBe(true);
  });

  it("flags {{TOKEN}} as undeclared when not in argPrompts", () => {
    const r = detectPlaceholders({ command: "npx", args: ["{{FOO}}"] }, { heuristic: true });
    expect(r).toHaveLength(1);
    expect(r[0].declared).toBe(false);
  });

  it("detects legacy /path/to/ via heuristic", () => {
    const r = detectPlaceholders(
      { command: "srv", args: ["/path/to/allowed/dir"] },
      { heuristic: true },
    );
    expect(r).toHaveLength(1);
    expect(r[0].token).toBe("/path/to/allowed/dir");
    expect(r[0].declared).toBe(false);
  });

  it("detects YOUR_API_KEY via heuristic", () => {
    const r = detectPlaceholders({ command: "srv", args: ["YOUR_API_KEY"] }, { heuristic: true });
    expect(r[0].token).toBe("YOUR_API_KEY");
  });

  it("detects <path> via heuristic", () => {
    const r = detectPlaceholders({ command: "srv", args: ["<path>"] }, { heuristic: true });
    expect(r[0].token).toBe("<path>");
  });

  it("skips heuristic detection when disabled", () => {
    const r = detectPlaceholders(
      { command: "srv", args: ["/path/to/dir", "YOUR_KEY"] },
      { heuristic: false },
    );
    expect(r).toHaveLength(0);
  });

  it("still finds declared tokens when heuristic is off", () => {
    const r = detectPlaceholders(
      {
        command: "npx",
        args: ["{{DIR}}"],
        argPrompts: { "{{DIR}}": { description: "dir" } },
      },
      { heuristic: false },
    );
    expect(r).toHaveLength(1);
  });

  it("returns empty array for a clean command", () => {
    const r = detectPlaceholders(
      { command: "npx", args: ["-y", "srv", "/Users/steve/docs"] },
      { heuristic: true },
    );
    expect(r).toHaveLength(0);
  });
});

describe("substitutePlaceholder", () => {
  it("replaces the token everywhere in args", () => {
    const entry = { command: "npx", args: ["-y", "{{DIR}}", "--also", "{{DIR}}"] };
    substitutePlaceholder(entry, "{{DIR}}", "/home/steve");
    expect(entry.args).toEqual(["-y", "/home/steve", "--also", "/home/steve"]);
  });

  it("replaces inside command", () => {
    const entry = { command: "{{BIN}}", args: ["-y"] };
    substitutePlaceholder(entry, "{{BIN}}", "/usr/local/bin/srv");
    expect(entry.command).toBe("/usr/local/bin/srv");
  });
});

describe("hasUnresolvedPlaceholders", () => {
  it("is true when {{TOKEN}} remains", () => {
    expect(hasUnresolvedPlaceholders({ args: ["-y", "{{X}}"] })).toBe(true);
  });
  it("is false after substitution", () => {
    expect(hasUnresolvedPlaceholders({ args: ["-y", "/dir"] })).toBe(false);
  });
  it("is false on empty input", () => {
    expect(hasUnresolvedPlaceholders({})).toBe(false);
  });
});
