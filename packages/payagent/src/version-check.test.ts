/**
 * Version-staleness classifier — pure, no network.
 *
 * The session that motivated this code had a 4-major-version-old binary
 * silently running on the user's machine and producing nonsense errors.
 * The classifier is what fires the warning. If this regresses, that
 * session repeats.
 */
import { describe, expect, it } from "vitest";
import { classifyStaleness } from "./version-check.js";

describe("classifyStaleness", () => {
  it("flags major-version drift as `major`", () => {
    expect(classifyStaleness("0.1.7", "2.7.0")).toBe("major");
    expect(classifyStaleness("1.0.0", "2.0.0")).toBe("major");
  });

  it("flags 2+ minor drift on the same major as `minor`", () => {
    expect(classifyStaleness("2.5.0", "2.7.0")).toBe("minor");
    expect(classifyStaleness("2.0.0", "2.2.0")).toBe("minor");
  });

  it("does not flag a single minor drift", () => {
    expect(classifyStaleness("2.6.0", "2.7.0")).toBe("fresh");
  });

  it("does not flag patch-only drift", () => {
    expect(classifyStaleness("2.7.0", "2.7.5")).toBe("fresh");
  });

  it("treats matching versions as fresh", () => {
    expect(classifyStaleness("2.7.0", "2.7.0")).toBe("fresh");
  });

  it("returns `unknown` when the registry is unreachable", () => {
    expect(classifyStaleness("2.7.0", undefined)).toBe("unknown");
  });

  it("returns `unknown` when the version string is malformed", () => {
    expect(classifyStaleness("not-a-version", "2.7.0")).toBe("unknown");
    expect(classifyStaleness("2.7.0", "oops")).toBe("unknown");
  });

  it("does not regress to fresh on a future-by-one-major", () => {
    // We're on 3.x, registry reports 2.7.0 (e.g. a beta channel) — should
    // not warn. Older versions warn; newer-than-published does not.
    expect(classifyStaleness("3.0.0", "2.7.0")).toBe("fresh");
  });
});
