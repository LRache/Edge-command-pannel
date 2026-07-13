import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targetBrowser = process.env.BROWSER === "firefox" ? "firefox" : "chromium";
const outputDirectory = resolve(projectRoot, targetBrowser === "firefox" ? "dist-firefox" : "dist");

const sourceFiles = JSON.parse(
  await readFile(resolve(projectRoot, "config/update-tracked-files.json"), "utf8")
);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: {
    "src/background": resolve(projectRoot, "src/background.ts"),
    "src/content": resolve(projectRoot, "src/content.ts"),
    "src/options": resolve(projectRoot, "src/options.ts")
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

if (targetBrowser === "firefox") {
  const manifestPath = resolve(outputDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const contentScriptMatches = (manifest.content_scripts ?? []).flatMap(
    (contentScript) => contentScript.matches ?? []
  );
  manifest.name = "Edge Command Panel";
  manifest.manifest_version = 2;
  manifest.permissions = unique([
    ...manifest.permissions.filter(
      (permission) => permission !== "favicon" && permission !== "scripting"
    ),
    ...manifest.host_permissions,
    ...contentScriptMatches
  ]);
  manifest.background = {
    scripts: ["src/background.js"],
    persistent: false
  };
  manifest.browser_action = manifest.action;
  manifest.browser_specific_settings = {
    gecko: {
      id: "edge-command-panel@example.local",
      strict_min_version: "109.0"
    }
  };
  delete manifest.action;
  delete manifest.host_permissions;
  delete manifest.optional_host_permissions;
  delete manifest.web_accessible_resources;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function unique(values) {
  return [...new Set(values)];
}
