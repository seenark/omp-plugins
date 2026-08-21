import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "..");
const packagesRoot = path.join(workspaceRoot, "packages");

function packageFile(packageDirectory, relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  const resolved = path.resolve(packageDirectory, relativePath);
  const relative = path.relative(packageDirectory, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay within the package`);
  }

  return resolved;
}

async function requireFile(packageDirectory, relativePath, label) {
  const filePath = packageFile(packageDirectory, relativePath, label);
  let details;
  try {
    details = await stat(filePath);
  } catch {
    throw new Error(`${label} does not exist: ${relativePath}`);
  }
  if (!details.isFile()) {
    throw new Error(`${label} is not a file: ${relativePath}`);
  }
}

async function validateManifest(manifestPath) {
  const packageDirectory = path.dirname(manifestPath);
  const source = await readFile(manifestPath, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    throw new Error(`invalid JSON (${error.message})`);
  }

  if (!manifest.name) throw new Error("missing name");
  if (!manifest.version) throw new Error("missing version");
  if (manifest.private === true) throw new Error("package must not be private");

  const omp = manifest.omp;
  if (!omp || typeof omp !== "object") throw new Error("missing omp metadata");

  if (Array.isArray(omp.extensions) && omp.extensions.length > 0) {
    for (const [index, entry] of omp.extensions.entries()) {
      if (typeof entry !== "string" || !entry.startsWith("./")) {
        throw new Error(`omp.extensions[${index}] must start with ./`);
      }
      await requireFile(packageDirectory, entry, `omp.extensions[${index}]`);
    }
    return;
  }

  if (Array.isArray(omp.themes) && omp.themes.length > 0) {
    for (const [index, entry] of omp.themes.entries()) {
      await requireFile(packageDirectory, entry, `omp.themes[${index}]`);
    }

    const binTarget = manifest.bin?.["omp-theme-catppuccin"];
    if (binTarget !== "./bin/install.js") {
      throw new Error("bin.omp-theme-catppuccin must be ./bin/install.js");
    }
    await requireFile(packageDirectory, binTarget, "bin.omp-theme-catppuccin");
    return;
  }

  throw new Error("unsupported omp manifest (expected extensions or themes)");
}

const entries = (await readdir(packagesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let failed = false;
for (const packageName of entries) {
  const manifestPath = path.join(packagesRoot, packageName, "package.json");
  try {
    await stat(manifestPath);
    await validateManifest(manifestPath);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    console.log(`ok ${manifest.name}`);
  } catch (error) {
    failed = true;
    console.error(`error ${packageName}: ${error.message}`);
  }
}

if (failed) process.exitCode = 1;
