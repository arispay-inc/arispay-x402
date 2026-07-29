/* eslint-disable no-console */
/**
 * `agentmarketplace init` — first-run wizard.
 *
 * Detects MCP clients, optionally creates an empty Claude Code config,
 * installs the bundled skill if Claude is detected, then asks the user
 * which path they want (use, publish, browse) and prints the next
 * command for that path.
 */
import { detectClients, removeServer, writeServer } from "../clients.js";
import { type StoredConfig, loadConfig, prompt, promptYesNo } from "../lib/cli-helpers.js";
import { cmdSkillInstall } from "./skill.js";

type InitBranch = "agent" | "publisher" | "browse";

export async function cmdInit(): Promise<void> {
  console.log("agentmarketplace init — setup wizard\n");

  // 1. MCP client detection.
  const clients = detectClients();
  console.log("Detected MCP clients:");
  for (const c of clients) {
    console.log(
      `  ${c.name.padEnd(16)} ${c.exists ? "✓ configured" : c.createIfMissing ? "(can create)" : "(not installed?)"}`,
    );
    console.log(`  ${" ".repeat(16)}  ${c.configPath}`);
  }
  const anyExists = clients.some((c) => c.exists);
  if (!anyExists) {
    const ok = await promptYesNo(
      "\nNo MCP configs found. Create an empty ~/.claude/mcp.json for Claude Code?",
      true,
    );
    if (ok) {
      const target = clients.find((c) => c.id === "claude-code")!;
      writeServer(target, "__placeholder__", { command: "echo", args: ["ok"] });
      removeServer(target, "__placeholder__");
      console.log(`✓ created ${target.configPath}`);
    }
  }

  // 2. Install the Claude skill if Claude Code / Desktop is detected.
  const claudePresent =
    clients.some((c) => c.id === "claude-code" && c.exists) ||
    clients.some((c) => c.id === "claude-desktop" && c.exists);
  if (claudePresent) {
    try {
      cmdSkillInstall({ silent: true });
      console.log("✓ installed agentmarketplace skill into ~/.claude/skills/");
    } catch (err) {
      console.warn(`(skill install skipped: ${err instanceof Error ? err.message : err})`);
    }
  }

  // 3. Branch selection — who is this user?
  const cfg = loadConfig();
  const branch = await pickBranch(cfg);

  switch (branch) {
    case "agent":
      console.log("\nNext — create a spend-limited agent wallet:");
      console.log("  agentmarketplace agent create");
      console.log("");
      console.log("Once funded you can pay any listing with:");
      console.log("  agentmarketplace try <slug>        # one command; tops up fiat if needed");
      console.log("  agentmarketplace call <slug>       # pay and call a specific endpoint");
      break;
    case "publisher":
      console.log("\nNext — sign up as a publisher (no dashboard required):");
      console.log("  agentmarketplace merchant signup");
      console.log("");
      console.log("Then publish your listing:");
      console.log("  agentmarketplace publish           # scaffolds agent.json if missing");
      break;
    case "browse":
      console.log("\nYou're good to browse. Try:");
      console.log("  agentmarketplace search browser");
      console.log("  agentmarketplace install modelcontextprotocol/filesystem");
      break;
  }

  console.log("");
  console.log("Full docs: https://arispay.app/docs");
}

async function pickBranch(cfg: StoredConfig): Promise<InitBranch> {
  const loggedIn = Boolean(cfg.apiKey || process.env.ARISPAY_API_KEY);
  if (loggedIn) {
    console.log("\nYou are already logged in. Skipping account setup.");
    return "browse";
  }

  console.log("\nWhat brings you here?\n");
  console.log("  1. I want to use paid agents from the marketplace");
  console.log("  2. I want to publish my own paid endpoint");
  console.log("  3. Just browsing for free MCP servers");
  const ans = (await prompt("\nChoice [3]: ")).trim();
  const idx = ans ? Number.parseInt(ans, 10) : 3;
  if (idx === 1) return "agent";
  if (idx === 2) return "publisher";
  return "browse";
}
