import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Inject the current package.json version at build time so the CLI's
// `--version` output never drifts from the published package.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/index.ts", "src/vercel.ts", "src/langchain.ts", "src/cli.ts"],
  format: ["esm"],
  dts: {
    compilerOptions: {
      skipLibCheck: true,
    },
  },
  sourcemap: true,
  clean: true,
  target: "node18",
  define: {
    __PAYAGENT_VERSION__: JSON.stringify(pkg.version),
  },
  // The CLI is invoked via the `payagent` bin. Its `#!/usr/bin/env node`
  // shebang at the top of src/cli.ts is preserved through bundling by esbuild.
  // `chmod +x dist/cli.js` runs in the build script.
  external: ["ai", "zod", "zod/v4", "zod/v3", "@langchain/core", "qrcode-terminal"],
});
