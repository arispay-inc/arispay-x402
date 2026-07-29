import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CAIP2,
  EURC_BASE_MAINNET,
  type GeneratedFile,
  INIT_FRAMEWORKS,
  type InitFramework,
  MAINNET_FACILITATOR,
  TESTNET_FACILITATOR,
  type TemplateOptions,
  centsToAtomic,
  centsToMoneyString,
  generateFiles,
} from "./init-templates.js";

const WALLET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function opts(overrides: Partial<TemplateOptions> = {}): TemplateOptions {
  return {
    framework: "express",
    wallet: WALLET,
    route: "/api/paid",
    method: "GET",
    priceCents: 1,
    currency: "USD",
    network: "base-sepolia",
    projectName: "x402-test-seller",
    ...overrides,
  };
}

function allContent(files: GeneratedFile[]): string {
  return files.map((f) => f.content).join("\n");
}

function mustFind(files: GeneratedFile[], filePath: string): GeneratedFile {
  const file = files.find((f) => f.path === filePath);
  if (!file) throw new Error(`expected generated file ${filePath}`);
  return file;
}

const EXPECTED_PATHS: Record<InitFramework, string[]> = {
  express: ["package.json", "server.js", ".env.example", ".gitignore", "README.md"],
  fastify: ["package.json", "server.js", ".env.example", ".gitignore", "README.md"],
  hono: ["package.json", "server.js", ".env.example", ".gitignore", "README.md"],
  workers: ["package.json", "src/index.js", "wrangler.toml", ".gitignore", "README.md"],
  next: [
    "package.json",
    "lib/x402.js",
    "app/api/paid/route.js",
    "app/api/health/route.js",
    ".env.example",
    ".gitignore",
    "README.md",
  ],
  fastapi: ["main.py", "requirements.txt", ".env.example", ".gitignore", "README.md"],
};

// Secret-shaped strings that must NEVER appear in generated output.
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["ArisPay developer key", /ap_(live|test)_/],
  ["merchant secret key", /sk_[A-Za-z0-9]/],
  ["64-hex private key", /0x[0-9a-fA-F]{64}/],
  ["PRIVATE KEY pem", /PRIVATE KEY/],
];

const tmpRoots: string[] = [];
afterAll(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

/** Write the file set to a temp dir and `node --check` every .js file. */
function assertJsSyntax(files: GeneratedFile[]): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paygate-init-test-"));
  tmpRoots.push(dir);
  for (const f of files) {
    const target = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content, "utf8");
  }
  // Ensure ESM parse goal even for templates without their own package.json.
  if (!files.some((f) => f.path === "package.json")) {
    fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  }
  for (const f of files) {
    if (!f.path.endsWith(".js")) continue;
    execFileSync(process.execPath, ["--check", path.join(dir, f.path)], { stdio: "pipe" });
  }
}

describe("generateFiles — every framework", () => {
  for (const framework of INIT_FRAMEWORKS) {
    describe(framework, () => {
      const testnetFiles = generateFiles(opts({ framework }));
      const mainnetFiles = generateFiles(opts({ framework, network: "base" }));

      it("generates the expected file set", () => {
        expect(testnetFiles.map((f) => f.path).sort()).toEqual(
          [...EXPECTED_PATHS[framework]].sort(),
        );
      });

      it("testnet default points at the testnet facilitator, not ArisPay", () => {
        const content = allContent(testnetFiles);
        expect(content).toContain(TESTNET_FACILITATOR);
        // The ArisPay facilitator may be MENTIONED (as the production
        // switch-over) but must never be the testnet default.
        const codeFiles = testnetFiles.filter((f) => /\.(js|py)$/.test(f.path));
        for (const f of codeFiles) {
          expect(f.content).not.toMatch(
            /FACILITATOR_URL['")\]]*\s*(\|\||,|=)\s*['"]https:\/\/facilitator\.arispay\.app/,
          );
        }
        // Truthfulness: testnet templates must say the ArisPay facilitator is
        // mainnet-only.
        expect(content.toLowerCase()).toContain("mainnet only");
      });

      it("mainnet default is the ArisPay facilitator", () => {
        expect(allContent(mainnetFiles)).toContain(MAINNET_FACILITATOR);
        const code = allContent(mainnetFiles.filter((f) => /\.(js|py|toml)$/.test(f.path)));
        expect(code).toContain(MAINNET_FACILITATOR);
      });

      it("references PAY_TO_ADDRESS from env and includes the provided wallet only in config files", () => {
        const content = allContent(testnetFiles);
        expect(content).toContain("PAY_TO_ADDRESS");
        // The wallet address must not be hardcoded into source files.
        for (const f of testnetFiles.filter((x) => /\.(js|py)$/.test(x.path))) {
          expect(f.content).not.toContain(WALLET);
        }
        // ...but it lands in the env/vars file when provided (address is public).
        const configFile = testnetFiles.find(
          (f) => f.path === ".env.example" || f.path === "wrangler.toml",
        );
        expect(configFile).toBeDefined();
        expect(configFile?.content).toContain(WALLET);
      });

      it("omits the wallet value when none was provided", () => {
        const files = generateFiles(opts({ framework, wallet: undefined }));
        expect(allContent(files)).not.toContain(WALLET);
      });

      it("contains no secret-shaped strings", () => {
        for (const [label, re] of SECRET_PATTERNS) {
          expect(allContent(testnetFiles), label).not.toMatch(re);
          expect(allContent(mainnetFiles), label).not.toMatch(re);
        }
      });

      it("renders the price in correct units", () => {
        const files = generateFiles(opts({ framework, priceCents: 25 }));
        // USD price is a money string derived from integer cents.
        expect(allContent(files)).toContain("$0.25");
      });

      it("declares the Bazaar discovery extension on the paid route", () => {
        const content = allContent(testnetFiles);
        expect(content).toMatch(/declare_?[dD]iscovery_?[eE]xtension/);
      });

      it("includes an unpaid /health route and the paid route", () => {
        const content = allContent(testnetFiles);
        expect(content).toContain("/health");
        expect(content).toContain("/api/paid");
      });

      it("README covers run command, curl 402 test, and llms.txt link", () => {
        const readme = mustFind(testnetFiles, "README.md");
        expect(readme.content).toContain("curl -i");
        expect(readme.content).toContain("402");
        expect(readme.content).toContain("https://facilitator.arispay.app/llms.txt");
      });

      it("generated JS parses (node --check)", () => {
        assertJsSyntax(testnetFiles);
        assertJsSyntax(mainnetFiles);
      });
    });
  }
});

describe("generateFiles — EUR", () => {
  it("EUR templates pin Circle EURC on Base mainnet with atomic units", () => {
    for (const framework of INIT_FRAMEWORKS) {
      const files = generateFiles(
        opts({ framework, currency: "EUR", network: "base", priceCents: 50 }),
      );
      const content = allContent(files);
      expect(content, framework).toContain(EURC_BASE_MAINNET);
      // 50 cents → 500000 atomic units (6 decimals, cents * 10^4).
      expect(content, framework).toContain("500000");
      assertJsSyntax(files);
    }
  });
});

describe("generateFiles — merchant (hosted PayGate) mode", () => {
  for (const framework of ["express", "fastify"] as const) {
    it(`${framework}: uses the paygate SDK with merchantId + priceCents`, () => {
      const files = generateFiles(
        opts({ framework, merchantId: "m_test123", priceCents: 10, wallet: undefined }),
      );
      const server = mustFind(files, "server.js");
      expect(server.content).toContain("merchantId");
      expect(server.content).toContain("priceCents: 10");
      expect(server.content).not.toContain("@x402/");
      // Clearly labeled as the hosted product path.
      const readme = mustFind(files, "README.md");
      expect(readme.content).toContain("hosted PayGate");
      expect(readme.content).toContain("paygate.arispay.app");
      const env = mustFind(files, ".env.example");
      expect(env.content).toContain("PAYGATE_MERCHANT_ID=m_test123");
      // package.json depends on paygate, not the upstream stack.
      const pkg = JSON.parse(mustFind(files, "package.json").content);
      expect(pkg.dependencies.paygate).toBeDefined();
      assertJsSyntax(files);
    });
  }
});

describe("generateFiles — details", () => {
  it("workers wrangler.toml has name, main, and the pinned compatibility_date", () => {
    const files = generateFiles(opts({ framework: "workers", projectName: "my-worker" }));
    const toml = mustFind(files, "wrangler.toml");
    expect(toml.content).toContain('name = "my-worker"');
    expect(toml.content).toContain('main = "src/index.js"');
    expect(toml.content).toContain('compatibility_date = "2026-07-01"');
    const readme = mustFind(files, "README.md");
    expect(readme.content).toContain("npx wrangler dev");
  });

  it("next: custom route maps to the App Router path with a valid relative import", () => {
    const files = generateFiles(opts({ framework: "next", route: "/premium" }));
    const route = mustFind(files, "app/premium/route.js");
    expect(route.content).toContain("from '../../lib/x402.js'");
    expect(route.content).toContain("export const GET = withX402(");
  });

  it("non-GET methods propagate to route registration and README curl", () => {
    const files = generateFiles(opts({ framework: "express", method: "POST" }));
    const server = mustFind(files, "server.js");
    expect(server.content).toContain("'POST /api/paid'");
    expect(server.content).toContain("app.post('/api/paid'");
    const readme = mustFind(files, "README.md");
    expect(readme.content).toContain("curl -i -X POST");
  });

  it("fastapi is marked as a generated standalone template", () => {
    const files = generateFiles(opts({ framework: "fastapi" }));
    const readme = mustFind(files, "README.md");
    expect(readme.content.toLowerCase()).toContain("standalone");
  });
});

describe("helpers", () => {
  it("centsToMoneyString formats integer cents", () => {
    expect(centsToMoneyString(1)).toBe("$0.01");
    expect(centsToMoneyString(10)).toBe("$0.10");
    expect(centsToMoneyString(250)).toBe("$2.50");
    expect(centsToMoneyString(10000)).toBe("$100.00");
  });

  it("centsToAtomic converts cents to 6-decimal units (x10^4)", () => {
    expect(centsToAtomic(1)).toBe("10000");
    expect(centsToAtomic(250)).toBe("2500000");
  });

  it("CAIP2 map matches the x402 chain ids", () => {
    expect(CAIP2.base).toBe("eip155:8453");
    expect(CAIP2["base-sepolia"]).toBe("eip155:84532");
  });
});
