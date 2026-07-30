#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLIC_PACKAGE_DIRS = [
  "payagent",
  "payagent-mcp",
  "paygate",
  "skill",
  "buyforme",
  "buyforme-mcp",
  "agentmarketplace",
  "agentmarketplace-mcp",
];

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "https://registry.npmjs.org";

export function readPublicPackages(root = DEFAULT_ROOT) {
  return PUBLIC_PACKAGE_DIRS.map((directory) => {
    const packageDir = join(root, "packages", directory);
    const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
    if (!manifest.name || !manifest.version || manifest.private === true) {
      throw new Error(`Refusing invalid publish target packages/${directory}`);
    }
    return { directory, packageDir, name: manifest.name, version: manifest.version };
  });
}

export async function isPublished(pkg, fetchImpl = fetch) {
  const url = `${REGISTRY}/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;
  const response = await fetchImpl(url);

  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw new Error(
    `npm registry preflight failed for ${pkg.name}@${pkg.version}: HTTP ${response.status}`,
  );
}

export function publishTarball(pkg, root = DEFAULT_ROOT) {
  const packDir = mkdtempSync(join(tmpdir(), "arispay-npm-pack-"));
  try {
    execFileSync("pnpm", ["--dir", pkg.packageDir, "pack", "--pack-destination", packDir], {
      cwd: root,
      stdio: "inherit",
    });
    const tarballs = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
    if (tarballs.length !== 1) {
      throw new Error(
        `Expected one tarball for ${pkg.name}@${pkg.version}, found ${tarballs.length}`,
      );
    }
    execFileSync(
      "npm",
      ["publish", join(packDir, tarballs[0]), "--access", "public", "--provenance"],
      {
        cwd: root,
        env: { ...process.env, NPM_CONFIG_PROVENANCE: "true" },
        stdio: "inherit",
      },
    );
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
}

export async function publishUnreleased({
  root = DEFAULT_ROOT,
  fetchImpl = fetch,
  publish = publishTarball,
  dryRun = false,
  log = console.info,
} = {}) {
  const published = [];
  const skipped = [];

  for (const pkg of readPublicPackages(root)) {
    if (await isPublished(pkg, fetchImpl)) {
      skipped.push(`${pkg.name}@${pkg.version}`);
      log(`skip ${pkg.name}@${pkg.version} (already published)`);
      continue;
    }

    if (dryRun) {
      log(`would publish ${pkg.name}@${pkg.version}`);
    } else {
      publish(pkg, root);
      log(`published ${pkg.name}@${pkg.version}`);
    }
    published.push(`${pkg.name}@${pkg.version}`);
  }

  return { published, skipped, dryRun };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = await publishUnreleased({ dryRun });
  console.info(
    `${dryRun ? "preflight" : "release"} complete: ${result.published.length} pending, ${result.skipped.length} already published`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
