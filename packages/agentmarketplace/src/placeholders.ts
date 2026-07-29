import {
  type AgentArgPrompt,
  type AgentEndpoint,
  HEURISTIC_PLACEHOLDER_PATTERNS,
  PLACEHOLDER_TOKEN_PATTERN,
} from "./index.js";

const tokenRe = (flags: string): RegExp => new RegExp(PLACEHOLDER_TOKEN_PATTERN, flags);

export interface DetectedPlaceholder {
  /** The token or suspicious substring found in the source value. */
  token: string;
  /** Where the token was found ("command" or "args[N]"). */
  location: string;
  /** Whether the publisher explicitly declared this token in argPrompts. */
  declared: boolean;
  /** The declared prompt, if any. */
  prompt?: AgentArgPrompt;
}

/**
 * Scan a command + args vector for placeholders that need user input.
 *
 * Declared tokens (`{{FOO}}` that match a key in `argPrompts`) are always
 * returned. Legacy-style tokens (`/path/to/...`, `YOUR_KEY`, `<path>`) are
 * returned only when `heuristic` is true, and always flagged as `declared:
 * false` so the caller can warn.
 */
export function detectPlaceholders(
  endpoint: Pick<AgentEndpoint, "command" | "args" | "argPrompts">,
  opts: { heuristic: boolean },
): DetectedPlaceholder[] {
  const out: DetectedPlaceholder[] = [];
  const seen = new Set<string>();
  const prompts = endpoint.argPrompts ?? {};

  const inspect = (value: string, location: string): void => {
    for (const match of value.matchAll(tokenRe("g"))) {
      const token = match[0];
      const key = `${location}::${token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        token,
        location,
        declared: token in prompts,
        prompt: prompts[token],
      });
    }
    if (!opts.heuristic) return;
    const trimmed = value.trim();
    if (tokenRe("g").test(trimmed)) return;
    for (const pattern of HEURISTIC_PLACEHOLDER_PATTERNS) {
      if (pattern.test(trimmed)) {
        const key = `${location}::${trimmed}`;
        if (seen.has(key)) break;
        seen.add(key);
        out.push({ token: trimmed, location, declared: false });
        break;
      }
    }
  };

  if (endpoint.command) inspect(endpoint.command, "command");
  (endpoint.args ?? []).forEach((arg, i) => inspect(arg, `args[${i}]`));
  return out;
}

/**
 * Substitute a single token everywhere it appears in a command/args vector.
 * Used to rewrite values after the user supplies a replacement.
 */
export function substitutePlaceholder(
  entry: { command?: string; args?: string[] },
  token: string,
  value: string,
): void {
  if (entry.command != null) {
    entry.command = entry.command.split(token).join(value);
  }
  if (entry.args) {
    entry.args = entry.args.map((a) => a.split(token).join(value));
  }
}

/**
 * Whether any placeholder tokens remain in a command/args vector after
 * substitution. Used to decide whether a non-TTY run can proceed.
 */
export function hasUnresolvedPlaceholders(entry: { command?: string; args?: string[] }): boolean {
  if (entry.command && tokenRe("g").test(entry.command)) return true;
  return (entry.args ?? []).some((a) => tokenRe("g").test(a));
}
