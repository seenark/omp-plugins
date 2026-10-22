import { readdirSync, readFileSync } from "node:fs";

const ref = process.env.BASE_REF || "origin/main";
const TEST_FILE = /\.test\.ts$/;

function git(...args: string[]): { ok: boolean; out: string } {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, out: result.stdout.toString().trim() };
}

if (!git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`).ok) {
  console.log(`skip: base ref ${ref} not found`);
  process.exit(0);
}

const mergeBase = git("merge-base", "HEAD", ref);
if (!mergeBase.ok) {
  console.log(`skip: no merge base between HEAD and ${ref}`);
  process.exit(0);
}

const changed = [
  ...git("diff", "--name-only", mergeBase.out, "--", "packages").out.split("\n"),
  ...git("ls-files", "--others", "--exclude-standard", "packages").out.split("\n"),
].filter(Boolean);

let failed = false;
for (const entry of readdirSync("packages", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const prefix = `packages/${entry.name}/`;
  const files = changed.filter((file) => file.startsWith(prefix));
  if (files.every((file) => TEST_FILE.test(file))) continue;

  let current: string;
  try {
    current = JSON.parse(readFileSync(`${prefix}package.json`, "utf8")).version;
  } catch {
    continue;
  }
  const base = git("show", `${mergeBase.out}:${prefix}package.json`);
  if (!base.ok) {
    console.log(`ok ${entry.name}: new package at ${current}`);
    continue;
  }
  const baseVersion: string = JSON.parse(base.out).version;
  if (Bun.semver.order(current, baseVersion) > 0) {
    console.log(`ok ${entry.name}: ${baseVersion} -> ${current}`);
  } else {
    console.error(`error ${entry.name}: version ${current} must be greater than ${baseVersion} on ${ref}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
