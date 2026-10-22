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

function heading(title) {
  return (text) => {
    const lines = text.split("\n");
    const start = lines.indexOf(title);
    if (start === -1) throw new Error(`heading not found: ${title}`);
    const level = title.match(/^#+/)[0].length;
    let end = lines.findIndex((line, index) => index > start && /^#+\s/.test(line) && line.match(/^#+/)[0].length <= level);
    if (end === -1) end = lines.length;
    return lines.slice(start + 1, end).join("\n");
  };
}

function capture(pattern) {
  return (text) => {
    const match = pattern.exec(text);
    if (!match) throw new Error(`pattern not found: ${pattern}`);
    return match[1];
  };
}

const FEATURE_NAME = "[a-z][a-z-]*";

// pattern group 1 is one name or a comma-separated list. extra names are allowed but not required.
const FEATURE_LOCATIONS = [
  {
    label: "packages/codesook-omp-plugin/index.ts PROJECT_FEATURES",
    file: "packages/codesook-omp-plugin/index.ts",
    scope: capture(new RegExp(`const PROJECT_FEATURES\\b[^=]*=\\s*\\[([^\\]]*)\\]`)),
    pattern: new RegExp(`"(${FEATURE_NAME})"`, "g"),
    extra: ["pstack"],
  },
  {
    label: "packages/codesook-omp-plugin/index.ts DEFAULT_PROJECT_FEATURES",
    file: "packages/codesook-omp-plugin/index.ts",
    scope: capture(new RegExp(`const DEFAULT_PROJECT_FEATURES\\b[^=]*=\\s*\\{([^}]*)\\}`)),
    pattern: new RegExp(`^\\s*"?(${FEATURE_NAME})"?\\s*:`, "gm"),
    extra: ["pstack"],
  },
  {
    label: "README.md feature table",
    file: "README.md",
    scope: heading("## Features"),
    pattern: new RegExp(`^\\| \`(${FEATURE_NAME})\` \\|`, "gm"),
  },
  {
    label: "README.md install selector",
    file: "README.md",
    scope: heading("## Quick start"),
    pattern: /omp plugin install 'github:seenark\/omp-plugins\[([a-z,-]+)\]'/g,
  },
  {
    label: "README.md plugin features --enable list",
    file: "README.md",
    scope: heading("### From a local checkout"),
    pattern: /omp plugin features omp-plugins --enable=([a-z,-]+)/g,
  },
  {
    label: "docs/agents/setup.md Phase 1 feature table",
    file: "docs/agents/setup.md",
    scope: heading("## Phase 1: ask which features to install"),
    pattern: new RegExp(`^\\| \`(${FEATURE_NAME})\` \\|`, "gm"),
    extra: ["pstack"],
  },
  {
    label: "docs/agents/setup.md Feature names sentence",
    file: "docs/agents/setup.md",
    scope: capture(/Feature names: ([^.]*)\./),
    pattern: new RegExp(`\`(${FEATURE_NAME})\``, "g"),
  },
];

// Status Segment sources: not every feature has one, so these two only have to agree with each other.
const SOURCE_LISTS = [
  {
    label: "packages/shared-display/src/client.ts SOURCES",
    file: "packages/shared-display/src/client.ts",
    scope: capture(new RegExp(`const SOURCES\\b[^=]*=\\s*\\[([^\\]]*)\\]`)),
    pattern: new RegExp(`"(${FEATURE_NAME})"`, "g"),
  },
  {
    label: "packages/shared-display/src/index.ts SOURCE_ORDER",
    file: "packages/shared-display/src/index.ts",
    scope: capture(new RegExp(`const SOURCE_ORDER\\b[^=]*=\\s*\\[([^\\]]*)\\]`)),
    pattern: new RegExp(`"(${FEATURE_NAME})"`, "g"),
  },
];

async function extractNames(location) {
  const text = await readFile(path.join(workspaceRoot, location.file), "utf8");
  const scoped = location.scope(text);
  return [...scoped.matchAll(location.pattern)].flatMap((match) => match[1].split(","));
}

async function checkFeatureLists() {
  const rootManifest = JSON.parse(await readFile(path.join(workspaceRoot, "package.json"), "utf8"));
  const features = Object.keys(rootManifest.omp?.features ?? {});
  const problems = [];

  for (const location of FEATURE_LOCATIONS) {
    let names;
    try {
      names = await extractNames(location);
    } catch (error) {
      problems.push(`${location.label}: ${error.message}`);
      continue;
    }
    const allowed = new Set([...features, ...(location.extra ?? [])]);
    for (const name of names) {
      if (!allowed.has(name)) problems.push(`${location.label}: unknown feature ${name}`);
    }
    for (const feature of [...features, ...(location.extra ?? [])]) {
      const count = names.filter((name) => name === feature).length;
      if (count === 0 && features.includes(feature)) problems.push(`${location.label}: missing feature ${feature}`);
      if (count > 1) problems.push(`${location.label}: feature ${feature} listed ${count} times`);
    }
  }

  try {
    const [sources, order] = await Promise.all(SOURCE_LISTS.map(extractNames));
    if (sources.join(",") !== order.join(",")) {
      problems.push(`${SOURCE_LISTS[0].label} and ${SOURCE_LISTS[1].label} differ: [${sources.join(", ")}] vs [${order.join(", ")}]`);
    }
  } catch (error) {
    problems.push(`shared-display source lists: ${error.message}`);
  }

  return problems;
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

const featureProblems = await checkFeatureLists();
if (featureProblems.length === 0) {
  console.log("ok feature lists");
} else {
  failed = true;
  for (const problem of featureProblems) console.error(`error feature lists: ${problem}`);
}

if (failed) process.exitCode = 1;
