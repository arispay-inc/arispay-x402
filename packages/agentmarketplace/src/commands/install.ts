/* eslint-disable no-console */
/**
 * `agentmarketplace install <slug>` and `uninstall <slug>` — auto-mutate
 * the user's MCP client configs (Claude Desktop, Claude Code, Cursor,
 * Windsurf) to add or remove a server entry.
 */
import {
  type ClientTarget,
  detectClients,
  removeServer,
  slugToServerName,
  validateClientFlag,
  writeServer,
} from "../clients.js";
import type { AgentListing } from "../index.js";
import { formatListing, getClient, parseFlags, prompt, promptYesNo } from "../lib/cli-helpers.js";
import {
  detectPlaceholders,
  hasUnresolvedPlaceholders,
  substitutePlaceholder,
} from "../placeholders.js";

async function pickClients(flags: Record<string, string>): Promise<ClientTarget[]> {
  const all = detectClients();
  const selector = flags.client;

  if (selector === "all") return all.filter((c) => c.exists || c.createIfMissing);
  if (selector) {
    const match = all.find((c) => c.id === selector);
    if (!match) {
      console.error(`Unknown client: ${selector}`);
      console.error(`Options: ${all.map((c) => c.id).join(", ")}, all`);
      process.exit(1);
    }
    return [match];
  }

  // Interactive: show detected clients, pick one or all.
  const candidates = all.filter((c) => c.exists || c.createIfMissing);
  if (candidates.length === 0) {
    console.error("No MCP clients detected. Run: agentmarketplace init");
    process.exit(1);
  }
  if (candidates.length === 1) return candidates;

  console.log("\nWhich MCP client do you want to install to?\n");
  candidates.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.name.padEnd(16)} ${c.exists ? "✓ detected" : "(will create)"}`);
  });
  console.log(`  ${candidates.length + 1}. all of the above`);
  const ans = await prompt("\nChoice [1]: ");
  const idx = ans ? Number.parseInt(ans, 10) - 1 : 0;
  if (Number.isNaN(idx) || idx < 0 || idx > candidates.length) {
    console.error("Invalid selection.");
    process.exit(1);
  }
  if (idx === candidates.length) return candidates;
  return [candidates[idx]!];
}

async function resolveInstallPlaceholders(
  listing: AgentListing,
  entry: { command?: string; args?: string[] },
  flags: Record<string, string>,
): Promise<void> {
  const heuristic = flags["no-placeholder-heuristic"] !== "true";
  const detected = detectPlaceholders(
    {
      command: entry.command,
      args: entry.args,
      argPrompts: listing.endpoint.argPrompts,
    },
    { heuristic },
  );
  if (detected.length === 0) return;

  const isTty = Boolean(process.stdin.isTTY);
  const undeclared = detected.filter((p) => !p.declared);
  if (undeclared.length > 0) {
    console.log("");
    console.log("This listing has placeholder values that should be filled in:");
    for (const p of undeclared) {
      console.log(`  • ${p.token}  (${p.location}) — publisher did not declare this placeholder`);
    }
    console.log("Pass --no-placeholder-heuristic to skip this detection.");
  }

  for (const p of detected) {
    const label =
      p.declared && p.prompt?.description ? p.prompt.description : `Value for ${p.token}`;
    const example = p.prompt?.example ? ` (e.g. ${p.prompt.example})` : "";
    const required = p.prompt?.required === true;

    if (!isTty) {
      if (required) {
        console.error(`Missing required placeholder ${p.token} and no TTY to prompt on.`);
        console.error("Re-run interactively or pre-substitute the value.");
        process.exit(1);
      }
      console.warn(`  (non-interactive — leaving ${p.token} unresolved)`);
      continue;
    }

    const value = (await prompt(`  ${label}${example}: `)).trim();
    if (!value) {
      if (required) {
        console.error(`${p.token} is required. Aborting.`);
        process.exit(1);
      }
      console.warn(`  (empty — leaving ${p.token} in config; MCP client may fail to start)`);
      continue;
    }
    substitutePlaceholder(entry, p.token, value);
  }

  if (!isTty && hasUnresolvedPlaceholders(entry)) {
    console.error("Unresolved placeholders remain and stdin is not a TTY. Re-run interactively.");
    process.exit(1);
  }
}

export async function cmdInstall(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const [slug] = positional;
  if (!slug) {
    console.error("Usage: agentmarketplace install <slug> [--client=...]");
    process.exit(1);
  }

  // Validate --client *before* any other gate so an unknown client is
  // flagged regardless of the listing's transport. Previously this was
  // masked by the transport gate for http / http-x402 listings.
  if (flags.client) {
    const err = validateClientFlag(
      flags.client,
      detectClients().map((c) => c.id),
    );
    if (err) {
      console.error(err);
      process.exit(1);
    }
  }

  const client = getClient();
  const a = await client.get(slug);
  if (!a) {
    console.error(`Not found: ${slug}`);
    process.exit(1);
  }
  console.log(formatListing(a));

  // Gate on transport — http-x402 / http listings don't go into MCP configs.
  if (a.endpoint.transport !== "mcp-stdio" && a.endpoint.transport !== "mcp-http") {
    console.log("\nThis listing is not an MCP server — nothing to install into a client config.");
    console.log(`Transport: ${a.endpoint.transport}`);
    if (a.endpoint.url) console.log(`Endpoint:   ${a.endpoint.url}`);
    console.log("\nUse `agentmarketplace call` to invoke it directly.");
    return;
  }

  // Build the MCP server entry.
  const serverName = slugToServerName(a.slug);
  const entry: Record<string, unknown> = {};
  if (a.endpoint.transport === "mcp-stdio") {
    entry.command = a.endpoint.command ?? "";
    entry.args = [...(a.endpoint.args ?? [])];
    await resolveInstallPlaceholders(a, entry as { command?: string; args?: string[] }, flags);
  } else {
    entry.url = a.endpoint.url;
  }

  // Prompt for env vars if any are required.
  if (a.endpoint.envKeys?.length) {
    console.log("\nThis server requires environment variables:");
    const env: Record<string, string> = {};
    for (const key of a.endpoint.envKeys) {
      const fromEnv = process.env[key];
      if (fromEnv) {
        console.log(`  ${key} = (from current env)`);
        env[key] = fromEnv;
        continue;
      }
      const val = await prompt(`  ${key}: `);
      if (!val) {
        console.warn(`  (empty — leaving placeholder "<${key}>" in config)`);
        env[key] = `<${key}>`;
      } else {
        env[key] = val;
      }
    }
    entry.env = env;
  }

  const targets = await pickClients(flags);

  if (!flags.yes) {
    console.log("\nWill install to:");
    for (const t of targets) console.log(`  • ${t.name} (${t.configPath})`);
    const ok = await promptYesNo("\nProceed?");
    if (!ok) {
      console.log("Cancelled.");
      return;
    }
  }

  for (const target of targets) {
    try {
      const res = writeServer(target, serverName, entry);
      const verb = res.replaced ? "updated" : res.created ? "created + added" : "added";
      console.log(`✓ ${verb} '${serverName}' in ${target.name}`);
    } catch (err) {
      console.error(`✗ ${target.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Bump install count (fire-and-forget).
  fetch(`${client["baseUrl"]}/agents/${encodeURIComponent(a.slug)}/install`, {
    method: "POST",
  }).catch(() => {});

  console.log("\nRestart your MCP client to activate.");
}

export async function cmdUninstall(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const [slug] = positional;
  if (!slug) {
    console.error("Usage: agentmarketplace uninstall <slug> [--client=...]");
    process.exit(1);
  }
  const serverName = slugToServerName(slug);
  const targets = flags.client ? await pickClients(flags) : detectClients().filter((c) => c.exists);
  let removed = 0;
  for (const target of targets) {
    if (removeServer(target, serverName)) {
      console.log(`✓ removed '${serverName}' from ${target.name}`);
      removed++;
    }
  }
  if (removed === 0) console.log("Not found in any known MCP config.");
}
