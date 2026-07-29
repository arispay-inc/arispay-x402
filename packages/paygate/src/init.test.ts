import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  type InitIO,
  type RawArgs,
  checkWritePlan,
  dryRunOutput,
  missingRequired,
  parseArgv,
  planFiles,
  runInit,
  validateArgs,
} from "./init.js";

const WALLET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const tmpRoots: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paygate-init-run-"));
  tmpRoots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

function fakeIO(overrides: Partial<InitIO> = {}): InitIO & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (s: string) => out.push(s),
    stderr: (s: string) => err.push(s),
    isTTY: false,
    ask: async () => {
      throw new Error("ask() must not be called in non-TTY tests");
    },
    ...overrides,
  };
}

function raw(overrides: Partial<RawArgs> = {}): RawArgs {
  return { yes: false, dryRun: false, help: false, ...overrides };
}

describe("parseArgv", () => {
  it("parses all flags", () => {
    const result = parseArgv([
      "--framework",
      "express",
      "--wallet",
      WALLET,
      "--route",
      "/api/data",
      "--method",
      "POST",
      "--price",
      "25",
      "--currency",
      "EUR",
      "--network",
      "base",
      "--directory",
      "./out",
      "--merchant-id",
      "m_1",
      "--yes",
      "--dry-run",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.args).toMatchObject({
      framework: "express",
      wallet: WALLET,
      route: "/api/data",
      method: "POST",
      price: "25",
      currency: "EUR",
      network: "base",
      directory: "./out",
      merchantId: "m_1",
      yes: true,
      dryRun: true,
    });
  });

  it("supports --flag=value form and -y/-h shorthands", () => {
    const result = parseArgv(["--framework=hono", `--wallet=${WALLET}`, "-y"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.args.framework).toBe("hono");
    expect(result.args.wallet).toBe(WALLET);
    expect(result.args.yes).toBe(true);
  });

  it("rejects unknown flags and missing values", () => {
    expect(parseArgv(["--nope"]).ok).toBe(false);
    expect(parseArgv(["--framework"]).ok).toBe(false);
    expect(parseArgv(["--framework", "--yes"]).ok).toBe(false);
  });
});

describe("validateArgs", () => {
  it("applies defaults: route, method, price, currency, network (testnet)", () => {
    const result = validateArgs(raw({ framework: "express", wallet: WALLET }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options).toMatchObject({
      route: "/api/paid",
      method: "GET",
      priceCents: 1,
      currency: "USD",
      network: "base-sepolia",
    });
    // Base mainnet must never be a silent default.
    expect(result.options.network).not.toBe("base");
  });

  it("mainnet only when explicitly chosen", () => {
    const result = validateArgs(raw({ framework: "express", wallet: WALLET, network: "base" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options.network).toBe("base");
  });

  it("rejects routes that would inject into generated source (quotes, spaces, template syntax)", () => {
    for (const route of [
      "/a', (q,r)=>{r.send('pwn')}); //",
      "/a b",
      '/a"b',
      "/a`b",
      "/a${x}",
    ]) {
      const result = validateArgs(raw({ framework: "express", wallet: WALLET, route }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.join()).toContain("--route");
    }
  });

  it("rejects routes with .. segments (directory traversal via generated paths)", () => {
    for (const route of ["/../../escape", "/api/../..", "/.."]) {
      const result = validateArgs(raw({ framework: "next", wallet: WALLET, route }));
      expect(result.ok).toBe(false);
    }
    // dots inside a segment stay legal
    const ok = validateArgs(raw({ framework: "express", wallet: WALLET, route: "/v1.2/data" }));
    expect(ok.ok).toBe(true);
  });

  it("rejects merchant ids with quotes/newlines (interpolated into source + env)", () => {
    const bad = validateArgs(
      raw({ framework: "express", merchantId: 'm_1"\ninjected' }),
    );
    expect(bad.ok).toBe(false);
    const good = validateArgs(raw({ framework: "express", merchantId: "m_live-1.a" }));
    expect(good.ok).toBe(true);
  });

  it("rejects a malformed wallet", () => {
    const bad = validateArgs(raw({ framework: "express", wallet: "0x123" }));
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.join("\n")).toContain("--wallet");
  });

  it("requires a wallet unless dry-run or merchant mode", () => {
    const missing = validateArgs(raw({ framework: "express" }));
    expect(missing.ok).toBe(false);

    const dry = validateArgs(raw({ framework: "express", dryRun: true }));
    expect(dry.ok).toBe(true);

    const merchant = validateArgs(raw({ framework: "express", merchantId: "m_1" }));
    expect(merchant.ok).toBe(true);
  });

  it("rejects float and dollar-string prices with an integer-cents explanation", () => {
    for (const price of ["0.5", "1.5", "$1", "-3", "1e2"]) {
      const result = validateArgs(raw({ framework: "express", wallet: WALLET, price }));
      expect(result.ok, price).toBe(false);
      if (result.ok) continue;
      expect(result.errors.join("\n")).toContain("INTEGER number of cents");
    }
    const zero = validateArgs(raw({ framework: "express", wallet: WALLET, price: "0" }));
    expect(zero.ok).toBe(false);
  });

  it("rejects a route that does not start with /", () => {
    const result = validateArgs(raw({ framework: "express", wallet: WALLET, route: "api/x" }));
    expect(result.ok).toBe(false);
  });

  it("rejects unknown method / framework / network / currency", () => {
    expect(validateArgs(raw({ framework: "express", wallet: WALLET, method: "PATCH" })).ok).toBe(
      false,
    );
    expect(validateArgs(raw({ framework: "rails", wallet: WALLET })).ok).toBe(false);
    expect(
      validateArgs(raw({ framework: "express", wallet: WALLET, network: "ethereum" })).ok,
    ).toBe(false);
    expect(validateArgs(raw({ framework: "express", wallet: WALLET, currency: "GBP" })).ok).toBe(
      false,
    );
  });

  it("rejects EUR on base-sepolia with an explanation", () => {
    const result = validateArgs(raw({ framework: "express", wallet: WALLET, currency: "EUR" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("\n")).toContain("EURC");
    expect(result.errors.join("\n")).toContain("--network base");

    const onBase = validateArgs(
      raw({ framework: "express", wallet: WALLET, currency: "EUR", network: "base" }),
    );
    expect(onBase.ok).toBe(true);
  });

  it("merchant mode is express/fastify only", () => {
    const result = validateArgs(raw({ framework: "hono", wallet: WALLET, merchantId: "m_1" }));
    expect(result.ok).toBe(false);
  });
});

describe("missingRequired", () => {
  it("lists framework and wallet when absent", () => {
    expect(missingRequired(raw())).toEqual(["--framework", "--wallet"]);
    expect(missingRequired(raw({ framework: "express" }))).toEqual(["--wallet"]);
    expect(missingRequired(raw({ framework: "express", wallet: WALLET }))).toEqual([]);
    // wallet not required for dry-run or merchant mode
    expect(missingRequired(raw({ framework: "express", dryRun: true }))).toEqual([]);
    expect(missingRequired(raw({ framework: "express", merchantId: "m_1" }))).toEqual([]);
  });
});

describe("runInit — dry-run", () => {
  it("prints a JSON-lines plan plus a human summary and writes nothing", async () => {
    const dir = tmpDir();
    const io = fakeIO();
    const code = await runInit(["--framework", "express", "--dry-run", "--directory", dir], io);
    expect(code).toBe(0);
    const output = io.out.join("");
    const jsonLines = output
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l));
    expect(jsonLines.length).toBeGreaterThanOrEqual(5);
    for (const line of jsonLines) {
      expect(typeof line.path).toBe("string");
      expect(typeof line.bytes).toBe("number");
      expect(line.bytes).toBeGreaterThan(0);
    }
    expect(output).toContain("Dry run — nothing written.");
    // Nothing hit the disk.
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe("runInit — writes, conflicts, idempotency", () => {
  it("scaffolds into an empty directory", async () => {
    const dir = tmpDir();
    const io = fakeIO();
    const code = await runInit(
      ["--framework", "express", "--wallet", WALLET, "--directory", dir, "--yes"],
      io,
    );
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(dir, "server.js"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".env.example"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, ".env.example"), "utf8")).toContain(WALLET);
  });

  it("re-running over an identical scaffold succeeds (idempotent)", async () => {
    const dir = tmpDir();
    const argv = ["--framework", "fastify", "--wallet", WALLET, "--directory", dir, "--yes"];
    expect(await runInit(argv, fakeIO())).toBe(0);
    const io = fakeIO();
    expect(await runInit(argv, io)).toBe(0);
    expect(io.out.join("")).toContain("already up to date");
  });

  it("refuses to overwrite differing files and lists the conflicts", async () => {
    const dir = tmpDir();
    const argv = ["--framework", "express", "--wallet", WALLET, "--directory", dir, "--yes"];
    expect(await runInit(argv, fakeIO())).toBe(0);
    fs.writeFileSync(path.join(dir, "server.js"), "// user edited this\n");
    const io = fakeIO();
    const code = await runInit(argv, io);
    expect(code).toBe(1);
    const err = io.err.join("");
    expect(err).toContain("server.js");
    expect(err).toContain("Refusing to overwrite");
    // The user's edit survived.
    expect(fs.readFileSync(path.join(dir, "server.js"), "utf8")).toBe("// user edited this\n");
  });

  it("unrelated pre-existing files do not block", async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "notes.txt"), "keep me");
    const io = fakeIO();
    const code = await runInit(
      ["--framework", "express", "--wallet", WALLET, "--directory", dir, "--yes"],
      io,
    );
    expect(code).toBe(0);
    expect(fs.readFileSync(path.join(dir, "notes.txt"), "utf8")).toBe("keep me");
  });
});

describe("runInit — non-interactive behaviour", () => {
  it("fails with the missing-flag list when stdin is not a TTY", async () => {
    const io = fakeIO();
    const code = await runInit(["--framework", "express"], io);
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("--wallet");
    expect(io.err.join("")).toContain("not a TTY");
  });

  it("never prompts when --yes is passed, even on a TTY", async () => {
    const io = fakeIO({ isTTY: true });
    const code = await runInit(["--yes"], io);
    expect(code).toBe(1); // --framework missing; --yes cannot invent it
    expect(io.err.join("")).toContain("--framework");
  });

  it("propagates validation failures as exit 1", async () => {
    const io = fakeIO();
    const code = await runInit(["--framework", "express", "--wallet", "nope", "--yes"], io);
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("--wallet");
  });

  it("--help prints usage and exits 0", async () => {
    const io = fakeIO();
    const code = await runInit(["--help"], io);
    expect(code).toBe(0);
    expect(io.out.join("")).toContain("paygate init");
  });
});

describe("checkWritePlan / planFiles / dryRunOutput", () => {
  it("classifies create vs identical vs conflict", () => {
    const dir = tmpDir();
    const files = [
      { path: "a.txt", content: "alpha" },
      { path: "b.txt", content: "beta" },
      { path: "sub/c.txt", content: "gamma" },
    ];
    fs.writeFileSync(path.join(dir, "a.txt"), "alpha"); // identical
    fs.writeFileSync(path.join(dir, "b.txt"), "CHANGED"); // conflict
    const plan = checkWritePlan(dir, files);
    expect(plan.identical).toEqual(["a.txt"]);
    expect(plan.conflicts).toEqual(["b.txt"]);
    expect(plan.create.map((f) => f.path)).toEqual(["sub/c.txt"]);
  });

  it("dryRunOutput reports the testnet caveat by default and mainnet when chosen", () => {
    const testnet = validateArgs(raw({ framework: "express", dryRun: true }));
    if (!testnet.ok) throw new Error("expected ok");
    expect(dryRunOutput(testnet.options, planFiles(testnet.options))).toContain(
      "settles Base mainnet only",
    );

    const mainnet = validateArgs(raw({ framework: "express", wallet: WALLET, network: "base" }));
    if (!mainnet.ok) throw new Error("expected ok");
    expect(dryRunOutput(mainnet.options, planFiles(mainnet.options))).toContain(
      "https://facilitator.arispay.app (Base mainnet)",
    );
  });
});
