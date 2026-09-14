import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type JsonObject = Record<string, unknown>;

const ANSI_ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const PACKED_LINE = /^\s*packed\s+\S+\s+(.+?)\s*$/i;
const TEST_FILE = /(?:^|[._-])(?:test|spec)(?:[._-]|$)/i;
const TEST_DIRECTORY: Record<string, true> = {
  test: true,
  tests: true,
  __tests__: true,
  spec: true,
  specs: true,
};
const IGNORED_DIRECTORY: Record<string, true> = {
  ".git": true,
  node_modules: true,
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMember(value: string): string | undefined {
  let member = value.trim().replaceAll("\\", "/");
  while (member.startsWith("./")) member = member.slice(2);
  while (member.startsWith("package/")) member = member.slice("package/".length);
  if (!member || member.startsWith("/") || member === ".") return undefined;

  member = path.posix.normalize(member);
  if (member === "." || member === ".." || member.startsWith("../")) return undefined;
  return member;
}

function addMember(required: Set<string>, value: unknown): void {
  if (typeof value !== "string") return;
  const member = normalizeMember(value);
  if (member) required.add(member);
}

function addNestedMembers(required: Set<string>, value: unknown): void {
  if (typeof value === "string") {
    addMember(required, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) addNestedMembers(required, item);
    return;
  }
  if (isObject(value)) {
    for (const item of Object.values(value)) addNestedMembers(required, item);
  }
}

function manifestMembers(manifest: JsonObject): Set<string> {
  const required = new Set<string>();
  addNestedMembers(required, manifest.exports);

  if (typeof manifest.bin === "string") {
    addMember(required, manifest.bin);
  } else if (isObject(manifest.bin)) {
    for (const target of Object.values(manifest.bin)) addMember(required, target);
  }

  if (isObject(manifest.omp)) {
    addNestedMembers(required, manifest.omp.extensions);
    addNestedMembers(required, manifest.omp.themes);
  }

  return required;
}

function isTestSource(relativePath: string): boolean {
  const parts = relativePath.split("/");
  if (parts.some((part) => TEST_DIRECTORY[part.toLowerCase()] === true)) return true;
  return TEST_FILE.test(path.posix.basename(relativePath));
}

async function packageFiles(packageRoot: string, relativeDirectory = ""): Promise<string[]> {
  const directory = path.join(packageRoot, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "." || entry.name === "..") continue;
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORY[entry.name] === true) {
        continue;
      }
      files.push(...(await packageFiles(packageRoot, relativePath)));
      continue;
    }

    if (entry.isFile()) files.push(relativePath.replaceAll(path.sep, "/"));
  }

  return files;
}

async function requiredMembers(packageRoot: string, manifest: JsonObject): Promise<Set<string>> {
  const required = manifestMembers(manifest);
  const files = await packageFiles(packageRoot);

  for (const relativePath of files) {
    const lowerPath = relativePath.toLowerCase();
    if (
      (lowerPath.endsWith(".ts") || lowerPath.endsWith(".js")) &&
      !lowerPath.endsWith(".d.ts") &&
      !isTestSource(relativePath)
    ) {
      required.add(relativePath);
    }

    if (relativePath === "README.md" || relativePath === "THIRD-PARTY-NOTICES.txt") {
      required.add(relativePath);
    }
    if (relativePath.startsWith("skills/") || relativePath.startsWith("assets/")) {
      required.add(relativePath);
    }
  }

  return required;
}

function parsePackedMembers(output: string): Set<string> {
  const packed = new Set<string>();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.replace(ANSI_ESCAPE, "");
    const match = PACKED_LINE.exec(line);
    if (!match) continue;
    const member = normalizeMember(match[1]);
    if (member) packed.add(member);
  }
  return packed;
}

async function runPack(packageRoot: string): Promise<Set<string>> {
  const process = Bun.spawn(["bun", "pm", "pack", "--dry-run"], {
    cwd: packageRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  const output = `${stdout}\n${stderr}`;
  if (exitCode !== 0) {
    const details = output.trim().replace(/\s+/g, " ").slice(0, 500);
    throw new Error(
      `bun pm pack --dry-run failed with exit code ${exitCode}${details ? `: ${details}` : ""}`,
    );
  }

  const packed = parsePackedMembers(output);
  if (packed.size === 0) {
    throw new Error("bun pm pack --dry-run produced no packed members");
  }
  return packed;
}

async function main(): Promise<void> {
  const packageRoot = process.cwd();
  const manifestPath = path.join(packageRoot, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as JsonObject;
  const packageName = typeof manifest.name === "string" ? manifest.name : packageRoot;
  const packed = await runPack(packageRoot);
  const required = await requiredMembers(packageRoot, manifest);
  const missing = [...required].filter((member) => !packed.has(member)).sort();

  if (missing.length > 0) {
    const shown = missing.slice(0, 20).join(", ");
    const suffix = missing.length > 20 ? `, ... (+${missing.length - 20} more)` : "";
    throw new Error(
      `${missing.length} required member${missing.length === 1 ? "" : "s"} missing from pack (${shown}${suffix})`,
    );
  }

  console.log(`ok ${packageName}: ${packed.size} packed member${packed.size === 1 ? "" : "s"}; ${required.size} required`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exitCode = 1;
}
