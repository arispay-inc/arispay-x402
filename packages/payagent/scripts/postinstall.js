#!/usr/bin/env node
/**
 * Postinstall CTA banner.
 *
 * Industry-standard pattern: print a short message, don't open a browser.
 * Skip in CI, non-TTY, and when npm is silenced — and never fail the install.
 */

// Hard fence: never throw, never exit non-zero. A flaky banner must not
// break `npm install`.
try {
  const shouldSkip =
    process.env.CI ||
    process.env.CONTINUOUS_INTEGRATION ||
    process.env.PAYAGENT_SILENT ||
    process.env.NODE_ENV === "production" ||
    // npm sets npm_config_loglevel to 'silent' under --silent
    process.env.npm_config_loglevel === "silent" ||
    // not attached to a terminal (e.g. docker build, pipelines, IDE install)
    !process.stdout.isTTY;

  if (shouldSkip) {
    process.exit(0);
  }

  const reset = "\x1b[0m";
  const bold = "\x1b[1m";
  const cyan = "\x1b[36m";
  const dim = "\x1b[2m";

  const lines = [
    "",
    `${bold}${cyan}payagent${reset} — let AI agents pay for APIs.`,
    "",
    `  Get started:  ${cyan}npx payagent init${reset}`,
    `  Docs:         ${cyan}https://arispay.app/docs${reset}`,
    "",
    `${dim}  \`payagent init\` walks you through an OAuth sign-in and saves${reset}`,
    `${dim}  a developer key to ~/.payagent/config.json. Then:${reset}`,
    "",
    `    ${cyan}npx payagent agent create --name hermes \\\\${reset}`,
    `    ${cyan}  --per-tx 0.50 --daily 10 --monthly 100${reset}`,
    `    ${cyan}npx payagent agent fund hermes${reset}`,
    "",
  ];

  for (const line of lines) {
    // eslint-disable-next-line no-console
    console.log(line);
  }
} catch {
  // swallow — postinstall must never fail the install
}
