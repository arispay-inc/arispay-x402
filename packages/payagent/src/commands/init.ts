import {
  getArispayUrl,
  getConfigPath,
  loadConfig,
  saveConfig,
  setApiKey,
} from "../config-store.js";
/* eslint-disable no-console */
/**
 * `payagent init` — pair an existing ArisPay account via the browser
 * device-code flow.
 */
import { runDeviceAuth } from "../device-code.js";

export async function cmdInit(): Promise<void> {
  const arispayUrl = getArispayUrl();
  console.log(`Authenticating against ${arispayUrl}…`);
  const token = await runDeviceAuth({
    arispayUrl,
    onCode: (info) => {
      console.log("");
      console.log(`  1. Open: ${info.verificationUrl}`);
      console.log(`  2. Enter code: ${info.userCode}`);
      console.log("");
      console.log(`  Code expires in ${Math.round(info.expiresIn / 60)} min.`);
      console.log("");
      process.stdout.write("  Waiting for approval");
    },
    onTick: () => {
      process.stdout.write(".");
    },
  });
  console.log("");
  setApiKey(token.accessToken);
  // Persist the non-default URL alongside the key so future runs don't
  // need ARISPAY_URL re-exported in the shell.
  if (process.env.ARISPAY_URL) {
    const cfg = loadConfig();
    saveConfig({ ...cfg, arispayUrl: process.env.ARISPAY_URL });
  }
  const who = token.email ? ` as ${token.email}` : "";
  const env = token.environment ? ` (${token.environment})` : "";
  console.log(`✓ Signed in${who}${env}.`);
  console.log(`  Config saved to ${getConfigPath()}`);
}
