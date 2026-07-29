import { describe, expect, it } from "vitest";
import { slugToServerName, validateClientFlag } from "./clients.js";

const KNOWN: readonly string[] = ["claude-desktop", "claude-code", "cursor", "windsurf"];

describe("validateClientFlag", () => {
  it("returns null for a known client id", () => {
    expect(validateClientFlag("cursor", KNOWN)).toBeNull();
  });

  it('returns null for the special "all" value', () => {
    expect(validateClientFlag("all", KNOWN)).toBeNull();
  });

  it("returns an error message for an unknown client", () => {
    const err = validateClientFlag("typo", KNOWN);
    expect(err).toMatch(/Unknown client: typo/);
    expect(err).toMatch(/cursor/);
    expect(err).toMatch(/all/);
  });

  it("is case-sensitive (Cursor != cursor)", () => {
    expect(validateClientFlag("Cursor", KNOWN)).toMatch(/Unknown client/);
  });
});

describe("slugToServerName", () => {
  it("replaces slashes with dashes", () => {
    expect(slugToServerName("modelcontextprotocol/filesystem")).toBe(
      "modelcontextprotocol-filesystem",
    );
  });
  it("collapses consecutive dashes", () => {
    expect(slugToServerName("a//b")).toBe("a-b");
  });
  it("keeps valid chars unchanged", () => {
    expect(slugToServerName("arispay/x402-demo")).toBe("arispay-x402-demo");
  });
});
