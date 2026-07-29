/**
 * Tiny readline-based prompt helpers for the CLI.
 *
 * Used by `payagent quickstart` and the polished `payagent agent create`
 * to walk humans through missing required inputs in TTY mode. In
 * non-TTY mode (CI, pipes), callers should fall back to flag parsing
 * and error explicitly rather than blocking on stdin.
 *
 * Lives in this package (not `@arispay/shared`) per `packages/payagent/CLAUDE.md`:
 * the published SDK must remain standalone.
 */
import { createInterface } from "node:readline";

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Prompt the user for a string. Re-prompts up to `maxAttempts` if the
 * input fails the optional `validate` predicate; returns the first valid
 * value. Throws on EOF (Ctrl-D).
 */
export async function prompt(
  question: string,
  options: {
    default?: string;
    validate?: (raw: string) => string | undefined;
    maxAttempts?: number;
  } = {},
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? 3;
  const promptText = options.default ? `${question} [${options.default}] ` : `${question} `;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const raw = await readOnce(promptText);
    const value = (raw ?? "").trim() || options.default || "";
    if (!value) {
      // Empty + no default: re-ask.
      process.stderr.write("  (required)\n");
      continue;
    }
    if (options.validate) {
      const error = options.validate(value);
      if (error) {
        process.stderr.write(`  ${error}\n`);
        continue;
      }
    }
    return value;
  }
  throw new Error(`prompt: gave up after ${maxAttempts} attempts on "${question}"`);
}

/** Read a single line from stdin and resolve with it (without trailing newline). */
function readOnce(promptText: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.on("close", () => resolve(null));
  });
}

/** Email validator suitable for `prompt({ validate })`. */
export function validateEmail(raw: string): string | undefined {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? undefined : "Please enter a valid email address.";
}

/** Positive decimal validator (dollars). */
export function validateAmount(raw: string): string | undefined {
  const cleaned = raw.replace(/[$£€,]/g, "").trim();
  return /^\d+(\.\d{1,2})?$/.test(cleaned)
    ? undefined
    : "Enter a positive number (e.g. 0.50, 5, 100).";
}
