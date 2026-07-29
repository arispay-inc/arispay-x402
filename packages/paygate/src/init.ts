/**
 * `paygate init` — orchestration: parse argv → validate → plan → write.
 *
 * Zero runtime deps by design (paygate ships with `dependencies: {}`):
 * hand-rolled argv parser, node:readline for the interactive prompts,
 * node:fs / node:path for writes. All pure logic (parsing, validation,
 * planning, conflict detection) is exported for unit tests; only
 * `runInit` touches process/stdin.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import {
  CAIP2,
  type GeneratedFile,
  INIT_FRAMEWORKS,
  type InitCurrency,
  type InitFramework,
  type InitMethod,
  type InitNetwork,
  MAINNET_FACILITATOR,
  TESTNET_FACILITATOR,
  type TemplateOptions,
  generateFiles,
} from "./init-templates.js";

export const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
const METHODS: readonly InitMethod[] = ["GET", "POST", "PUT", "DELETE"];
const NETWORKS: readonly InitNetwork[] = ["base", "base-sepolia"];
const CURRENCIES: readonly InitCurrency[] = ["USD", "EUR"];

// ── Argv parsing ───────────────────────────────────────────────────────

export interface RawArgs {
  framework?: string;
  wallet?: string;
  route?: string;
  method?: string;
  price?: string;
  currency?: string;
  network?: string;
  directory?: string;
  merchantId?: string;
  yes: boolean;
  dryRun: boolean;
  help: boolean;
}

export type ParseResult = { ok: true; args: RawArgs } | { ok: false; error: string };

const VALUE_FLAGS: Record<string, keyof RawArgs> = {
  "--framework": "framework",
  "--wallet": "wallet",
  "--route": "route",
  "--method": "method",
  "--price": "price",
  "--currency": "currency",
  "--network": "network",
  "--directory": "directory",
  "--merchant-id": "merchantId",
};

const BOOL_FLAGS: Record<string, keyof RawArgs> = {
  "--yes": "yes",
  "-y": "yes",
  "--dry-run": "dryRun",
  "--help": "help",
  "-h": "help",
};

export function parseArgv(argv: string[]): ParseResult {
  const args: RawArgs = { yes: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    const eq = token.indexOf("=");
    const flag = eq > 0 ? token.slice(0, eq) : token;
    if (BOOL_FLAGS[flag]) {
      if (eq > 0) return { ok: false, error: `${flag} does not take a value` };
      (args as unknown as Record<string, boolean>)[BOOL_FLAGS[flag]!] = true;
      continue;
    }
    const key = VALUE_FLAGS[flag];
    if (!key) {
      return { ok: false, error: `Unknown flag: ${flag}. Run \`paygate init --help\` for usage.` };
    }
    let value: string | undefined;
    if (eq > 0) {
      value = token.slice(eq + 1);
    } else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, error: `${flag} requires a value` };
      }
      i++;
    }
    (args as unknown as Record<string, string>)[key] = value;
  }
  return { ok: true, args };
}

// ── Validation ─────────────────────────────────────────────────────────

export interface ValidatedOptions extends TemplateOptions {
  directory: string;
  dryRun: boolean;
}

export type ValidateResult =
  | { ok: true; options: ValidatedOptions }
  | { ok: false; errors: string[] };

export function validateArgs(args: RawArgs): ValidateResult {
  const errors: string[] = [];

  // framework
  const framework = args.framework as InitFramework | undefined;
  if (!framework) {
    errors.push(`--framework is required. One of: ${INIT_FRAMEWORKS.join(", ")}.`);
  } else if (!INIT_FRAMEWORKS.includes(framework)) {
    errors.push(`Unknown framework "${framework}". One of: ${INIT_FRAMEWORKS.join(", ")}.`);
  }

  // merchant mode is express/fastify only
  const merchantMode = Boolean(args.merchantId);
  // merchantId is interpolated into generated source/.env.example — same
  // strict-charset rule as --route (no quotes, spaces, or newlines).
  if (args.merchantId && !/^[A-Za-z0-9._-]+$/.test(args.merchantId)) {
    errors.push(
      `--merchant-id may contain only letters, digits, and "._-" (got "${args.merchantId}").`,
    );
  }
  if (merchantMode && framework && framework !== "express" && framework !== "fastify") {
    errors.push(
      `--merchant-id (hosted PayGate mode) is only supported for express and fastify templates.`,
    );
  }

  // wallet — required for the account-free templates (it's where the money
  // goes). Not needed in merchantId mode (the manifest carries the payout
  // wallet) and waived for --dry-run.
  if (args.wallet !== undefined && !WALLET_RE.test(args.wallet)) {
    errors.push(`--wallet must be a 0x-prefixed 40-hex EVM address (got "${args.wallet}").`);
  } else if (args.wallet === undefined && !merchantMode && !args.dryRun) {
    errors.push(
      `--wallet is required (the EVM address that receives funds). Use --dry-run to preview without one.`,
    );
  }

  // route — strict charset: the value is interpolated into generated source
  // files and (for next/workers) into filesystem paths, so anything outside
  // URL-path characters is rejected outright (no quotes, no spaces, no
  // template syntax) and ".." segments are refused to keep every generated
  // file inside --directory.
  const route = args.route ?? "/api/paid";
  if (!/^\/[A-Za-z0-9._~/:-]*$/.test(route)) {
    errors.push(
      `--route must start with "/" and contain only letters, digits, and ` +
        `"._~/:-" (got "${route}").`,
    );
  } else if (route.split("/").some((seg) => seg === "..")) {
    errors.push(`--route must not contain ".." path segments (got "${route}").`);
  }

  // method
  const method = (args.method ?? "GET").toUpperCase() as InitMethod;
  if (!METHODS.includes(method)) {
    errors.push(`--method must be one of ${METHODS.join(", ")} (got "${args.method}").`);
  }

  // price — integer cents, >= 1
  const rawPrice = args.price ?? "1";
  let priceCents = Number.NaN;
  if (!/^\d+$/.test(rawPrice.trim())) {
    errors.push(
      `--price must be an INTEGER number of cents (got "${rawPrice}"). ` +
        `Prices are integer cents, never floats or dollar strings: for $0.10 pass --price 10, for $2.50 pass --price 250.`,
    );
  } else {
    priceCents = Number.parseInt(rawPrice.trim(), 10);
    if (!Number.isInteger(priceCents) || priceCents < 1) {
      errors.push(`--price must be an integer >= 1 (cents). Got "${rawPrice}".`);
    }
  }

  // currency
  const currency = (args.currency ?? "USD").toUpperCase() as InitCurrency;
  if (!CURRENCIES.includes(currency)) {
    errors.push(`--currency must be USD or EUR (got "${args.currency}").`);
  }

  // network — default is TESTNET; mainnet only when explicitly chosen.
  const network = (args.network ?? "base-sepolia") as InitNetwork;
  if (!NETWORKS.includes(network)) {
    errors.push(`--network must be "base" or "base-sepolia" (got "${args.network}").`);
  }

  // EUR requires base mainnet: EUR settles in Circle EURC, and the testnet
  // default facilitator (x402.org) does not settle EURC — there is no
  // EURC testnet path in these templates.
  if (currency === "EUR" && network !== "base" && NETWORKS.includes(network)) {
    errors.push(
      `--currency EUR requires --network base. EUR settles in Circle EURC and the ` +
        `testnet default facilitator does not settle EURC, so there is no EUR testnet template.`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };

  const projectName = deriveProjectName(framework!, merchantMode);
  const directory = args.directory ?? `./${projectName}`;

  return {
    ok: true,
    options: {
      framework: framework!,
      wallet: args.wallet,
      route,
      method,
      priceCents,
      currency,
      network,
      merchantId: args.merchantId,
      projectName,
      directory,
      dryRun: args.dryRun,
    },
  };
}

export function deriveProjectName(framework: InitFramework, merchantMode: boolean): string {
  return merchantMode ? `paygate-${framework}-seller` : `x402-${framework}-seller`;
}

// ── Planning + directory safety ────────────────────────────────────────

export function planFiles(options: ValidatedOptions): GeneratedFile[] {
  return generateFiles(options);
}

export interface WritePlan {
  /** Files that will be created. */
  create: GeneratedFile[];
  /** Files that already exist byte-identical (idempotent re-run — skipped). */
  identical: string[];
  /** Files that exist with DIFFERENT content — the plan must be refused. */
  conflicts: string[];
}

/**
 * Directory safety: writing is allowed iff every planned file either does
 * not exist yet or exists byte-identical (idempotent re-run). Unrelated
 * files in the directory are left alone and do not block.
 */
export function checkWritePlan(directory: string, files: GeneratedFile[]): WritePlan {
  const create: GeneratedFile[] = [];
  const identical: string[] = [];
  const conflicts: string[] = [];
  for (const file of files) {
    const target = path.join(directory, file.path);
    if (!fs.existsSync(target)) {
      create.push(file);
      continue;
    }
    const existing = fs.readFileSync(target);
    if (existing.equals(Buffer.from(file.content, "utf8"))) {
      identical.push(file.path);
    } else {
      conflicts.push(file.path);
    }
  }
  return { create, identical, conflicts };
}

export function writeFiles(directory: string, files: GeneratedFile[]): void {
  for (const file of files) {
    const target = path.join(directory, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, "utf8");
  }
}

// ── Output helpers ─────────────────────────────────────────────────────

export function dryRunOutput(options: ValidatedOptions, files: GeneratedFile[]): string {
  const lines = files.map((f) =>
    JSON.stringify({ path: f.path, bytes: Buffer.byteLength(f.content, "utf8") }),
  );
  const summary = [
    ``,
    `Dry run — nothing written.`,
    `Framework:   ${options.framework}${options.merchantId ? " (hosted PayGate mode)" : ""}`,
    `Route:       ${options.method} ${options.route} @ ${options.priceCents}¢ ${options.currency}`,
    `Network:     ${options.network} (${CAIP2[options.network]})`,
    `Facilitator: ${
      options.network === "base"
        ? `${MAINNET_FACILITATOR} (Base mainnet)`
        : `${TESTNET_FACILITATOR} (testnet default — the ArisPay facilitator settles Base mainnet only)`
    }`,
    `Directory:   ${options.directory}`,
    `${files.length} file(s) would be written.`,
  ];
  return `${lines.join("\n")}\n${summary.join("\n")}\n`;
}

export const HELP_TEXT = `paygate init — make your API payable in one command.

Scaffolds a working x402 seller with the ArisPay facilitator as the
production default. Fully non-interactive with flags (for agents/CI).

Usage:
  npx paygate init --framework express --wallet 0xYourAddress [options]

Options:
  --framework <fw>     express | fastify | next | hono | workers | fastapi
  --wallet <0x...>     EVM address that receives funds (public info, not a secret)
  --route <path>       Paid route path (default: /api/paid)
  --method <verb>      GET | POST | PUT | DELETE (default: GET)
  --price <cents>      Price in INTEGER cents (default: 1 = $0.01)
  --currency <cur>     USD | EUR (default: USD; EUR requires --network base)
  --network <net>      base | base-sepolia (default: base-sepolia — testnet.
                       Base mainnet is used ONLY when you pass --network base.)
  --directory <dir>    Target directory (default: ./<derived-name>)
  --merchant-id <id>   Hosted PayGate mode (express/fastify): use the paygate
                       SDK + your merchant account instead of the account-free
                       upstream template.
  --yes, -y            Accept defaults, never prompt.
  --dry-run            Print the file plan (JSON lines + summary), write nothing.
  --help, -h           Show this help.

Networks & facilitators:
  base-sepolia (default)  testnet — FACILITATOR_URL defaults to
                          ${TESTNET_FACILITATOR} (Coinbase's public
                          testnet facilitator). The ArisPay facilitator does
                          NOT settle testnets.
  base                    production — FACILITATOR_URL defaults to
                          ${MAINNET_FACILITATOR} (Base mainnet,
                          USDC + EURC, no facilitator fee).
`;

// ── Interactive prompts ────────────────────────────────────────────────

export interface InitIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Whether stdin is a TTY (prompting allowed). */
  isTTY: boolean;
  /** Ask one question; resolve with the raw answer. Only called when isTTY. */
  ask: (question: string) => Promise<string>;
}

export function defaultIO(): InitIO {
  return {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: (question) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      return new Promise((resolve) =>
        rl.question(question, (answer) => {
          rl.close();
          resolve(answer.trim());
        }),
      );
    },
  };
}

/** Which required inputs are missing for a non-interactive run? */
export function missingRequired(args: RawArgs): string[] {
  const missing: string[] = [];
  if (!args.framework) missing.push("--framework");
  if (!args.wallet && !args.merchantId && !args.dryRun) missing.push("--wallet");
  return missing;
}

async function promptMissing(args: RawArgs, io: InitIO): Promise<RawArgs> {
  const out = { ...args };
  if (!out.framework) {
    const answer = await io.ask(`Framework (${INIT_FRAMEWORKS.join(" | ")}) [express]: `);
    out.framework = answer || "express";
  }
  if (!out.wallet && !out.merchantId && !out.dryRun) {
    out.wallet = await io.ask(`Wallet address that receives funds (0x..., public info): `);
  }
  if (!out.network) {
    const answer = await io.ask(
      `Network — 1) base-sepolia (testnet, default)  2) base (production, Base mainnet via ${MAINNET_FACILITATOR}) [1]: `,
    );
    out.network =
      answer === "2" || answer === "base" || answer === "production" ? "base" : "base-sepolia";
  }
  return out;
}

// ── Entry point ────────────────────────────────────────────────────────

/** Run `paygate init`. Returns a process exit code. */
export async function runInit(argv: string[], io: InitIO = defaultIO()): Promise<number> {
  const parsed = parseArgv(argv);
  if (!parsed.ok) {
    io.stderr(`${parsed.error}\n`);
    return 1;
  }
  let args = parsed.args;
  if (args.help) {
    io.stdout(HELP_TEXT);
    return 0;
  }

  // Non-interactive detection: --yes, or everything required already given,
  // or stdin is not a TTY (never prompt in that case — fail with the list
  // of missing flags instead).
  const missing = missingRequired(args);
  if (missing.length > 0 && !args.yes) {
    if (io.isTTY) {
      args = await promptMissing(args, io);
    } else {
      io.stderr(
        `Missing required flags: ${missing.join(", ")} (stdin is not a TTY, so paygate init cannot prompt).\n` +
          `Pass them explicitly, e.g.:\n  npx paygate init --framework express --wallet 0xYourAddress --yes\n`,
      );
      return 1;
    }
  } else if (missing.length > 0 && args.yes) {
    // --yes accepts defaults but cannot invent required inputs.
    io.stderr(`Missing required flags: ${missing.join(", ")}. --yes cannot supply these.\n`);
    return 1;
  }

  const validated = validateArgs(args);
  if (!validated.ok) {
    io.stderr(`${validated.errors.map((e) => `error: ${e}`).join("\n")}\n`);
    return 1;
  }
  const options = validated.options;
  const files = planFiles(options);

  if (options.dryRun) {
    io.stdout(dryRunOutput(options, files));
    return 0;
  }

  const plan = checkWritePlan(options.directory, files);
  if (plan.conflicts.length > 0) {
    io.stderr(
      `Refusing to overwrite existing files in ${options.directory} that differ from the template:\n` +
        `${plan.conflicts.map((p) => `  - ${p}`).join("\n")}\n` +
        `Move them aside or pick another --directory. (Re-running over an identical scaffold is fine.)\n`,
    );
    return 1;
  }

  writeFiles(options.directory, plan.create);

  const skipped = plan.identical.length > 0 ? ` (${plan.identical.length} already up to date)` : "";
  io.stdout(
    `\nCreated ${plan.create.length} file(s) in ${options.directory}${skipped}:\n` +
      `${files.map((f) => `  ${f.path}`).join("\n")}\n\n` +
      `Next steps:\n` +
      `  cd ${options.directory}\n` +
      (options.framework === "fastapi"
        ? `  pip install -r requirements.txt && cp .env.example .env && uvicorn main:app --port 3000\n`
        : options.framework === "workers"
          ? `  npm install && npx wrangler dev\n`
          : `  npm install && cp .env.example .env && npm ${options.framework === "next" ? "run dev" : "start"}\n`) +
      `  curl -i localhost:${options.framework === "workers" ? 8787 : 3000}${options.route}   # expect HTTP 402\n\n` +
      (options.network === "base"
        ? `Production network: Base mainnet via ${MAINNET_FACILITATOR}.\n`
        : `Testnet network: base-sepolia via ${TESTNET_FACILITATOR} — the ArisPay facilitator settles Base mainnet only; re-run with --network base for production.\n`),
  );
  return 0;
}
