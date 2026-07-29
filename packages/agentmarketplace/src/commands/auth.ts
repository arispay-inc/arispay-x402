/* eslint-disable no-console */
/** `agentmarketplace login | logout | whoami` — credential management. */
import {
  CONFIG_FILE,
  DEFAULT_BASE_URL,
  WEB_URL,
  loadConfig,
  parseFlags,
  saveConfig,
} from "../lib/cli-helpers.js";

export function cmdLogin(args: string[]): void {
  const [apiKey] = args;
  if (!apiKey) {
    console.error("Usage: agentmarketplace login <api-key>");
    console.error("Get one at https://payagent.arispay.app/dashboard/api-keys");
    process.exit(1);
  }
  const cfg = loadConfig();
  cfg.apiKey = apiKey;
  saveConfig(cfg);
  console.log("Logged in. Credentials stored at", CONFIG_FILE);
}

export function cmdLogout(): void {
  const cfg = loadConfig();
  delete cfg.apiKey;
  saveConfig(cfg);
  console.log("Logged out.");
}

export function cmdWhoami(args: string[]): void {
  const { flags } = parseFlags(args);
  const cfg = loadConfig();
  const key = process.env.ARISPAY_API_KEY ?? cfg.apiKey;
  if (!key) {
    console.log("Not logged in.");
    return;
  }

  if (flags["claim-token"] === "true") {
    // Surface the SHA-256 of the current credential so the publisher can
    // paste it into <homepage>/.well-known/arispay-claim.txt before
    // running `agentmarketplace claim <slug>`.
    const devKey = cfg.developerKey ?? key;
    // Use a require/import here so the import cost is not paid for every
    // non-claim whoami call.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    const token = createHash("sha256").update(devKey).digest("hex");
    console.log(token);
    return;
  }

  const masked = `${key.slice(0, 8)}…${key.slice(-4)}`;
  console.log(`Logged in with key: ${masked}`);
  if (cfg.merchantId)
    console.log(`Merchant:           ${cfg.merchantId} (${WEB_URL}/m/${cfg.merchantId})`);
  console.log(
    `Registry:           ${process.env.AGENTMARKETPLACE_URL ?? cfg.baseUrl ?? DEFAULT_BASE_URL}`,
  );
}
