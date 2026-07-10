import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "dist");

const sourceFiles = JSON.parse(
  await readFile(resolve(projectRoot, "config/update-tracked-files.json"), "utf8")
);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: {
    "src/background": resolve(projectRoot, "src/background.ts"),
    "src/content": resolve(projectRoot, "src/content.ts")
  },
  bundle: true,
  format: "iife",
  outdir: outputDirectory,
  platform: "browser",
  target: "chrome120",
  sourcemap: true,
  logLevel: "info"
});

await Promise.all(
  sourceFiles.map(async (relativePath) => {
    const destination = resolve(outputDirectory, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await cp(resolve(projectRoot, relativePath), destination);
  })
);
