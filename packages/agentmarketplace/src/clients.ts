/**
 * MCP client detection + config-file mutation.
 *
 * Each supported client stores its MCP server list at a known path with a
 * `mcpServers` top-level key. We detect existing configs, read + merge new
 * entries, and write back preserving other fields.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export type ClientId = "claude-desktop" | "claude-code" | "cursor" | "windsurf";

export interface ClientTarget {
  id: ClientId;
  name: string;
  configPath: string;
  exists: boolean;
  /** True when it's safe to create an empty config here if missing. */
  createIfMissing: boolean;
}

export interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

function claudeDesktopPath(): string {
  const home = homedir();
  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (platform() === "win32") {
    const appdata = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appdata, "Claude", "claude_desktop_config.json");
  }
  // Linux — no official Claude Desktop, but fall back to XDG.
  return join(home, ".config", "Claude", "claude_desktop_config.json");
}

function claudeCodePath(): string {
  return join(homedir(), ".claude", "mcp.json");
}

function cursorPath(): string {
  return join(homedir(), ".cursor", "mcp.json");
}

function windsurfPath(): string {
  return join(homedir(), ".codeium", "windsurf", "mcp_config.json");
}

export function detectClients(): ClientTarget[] {
  const defs: Array<Omit<ClientTarget, "exists">> = [
    {
      id: "claude-desktop",
      name: "Claude Desktop",
      configPath: claudeDesktopPath(),
      createIfMissing: false, // only create if user opted in; Claude Desktop may not be installed
    },
    {
      id: "claude-code",
      name: "Claude Code",
      configPath: claudeCodePath(),
      createIfMissing: true, // ~/.claude is ubiquitous for CC users
    },
    {
      id: "cursor",
      name: "Cursor",
      configPath: cursorPath(),
      createIfMissing: true,
    },
    {
      id: "windsurf",
      name: "Windsurf",
      configPath: windsurfPath(),
      createIfMissing: false,
    },
  ];
  return defs.map((d) => ({ ...d, exists: existsSync(d.configPath) }));
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8").trim();
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function writeJson(path: string, data: Record<string, unknown>): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

/** Insert or replace an `mcpServers` entry in the given client's config. */
export function writeServer(
  target: ClientTarget,
  serverName: string,
  entry: McpServerEntry,
): { created: boolean; replaced: boolean } {
  const existed = target.exists;
  const data = existed ? readJson(target.configPath) : {};
  const servers = (data.mcpServers as Record<string, unknown> | undefined) ?? {};
  const had = Object.prototype.hasOwnProperty.call(servers, serverName);
  servers[serverName] = entry;
  data.mcpServers = servers;
  writeJson(target.configPath, data);
  return { created: !existed, replaced: had };
}

/** Remove an entry from the client's config. Returns true if found and removed. */
export function removeServer(target: ClientTarget, serverName: string): boolean {
  if (!target.exists) return false;
  const data = readJson(target.configPath);
  const servers = (data.mcpServers as Record<string, unknown> | undefined) ?? {};
  if (!Object.prototype.hasOwnProperty.call(servers, serverName)) return false;
  delete servers[serverName];
  data.mcpServers = servers;
  writeJson(target.configPath, data);
  return true;
}

/**
 * Produce a safe, MCP-compatible name from a marketplace slug.
 * "modelcontextprotocol/filesystem" -> "modelcontextprotocol-filesystem"
 */
export function slugToServerName(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
}

/**
 * Validate a user-supplied `--client=X` flag against a set of known IDs.
 * Returns `null` on valid input, or an error message string on invalid input.
 * The special value `all` is always accepted. Pure — no IO, safe to unit-test.
 */
export function validateClientFlag(requested: string, knownIds: readonly string[]): string | null {
  if (requested === "all") return null;
  if (knownIds.includes(requested)) return null;
  return `Unknown client: ${requested}\nOptions: ${knownIds.join(", ")}, all`;
}
