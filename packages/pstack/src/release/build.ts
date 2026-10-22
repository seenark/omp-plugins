#!/usr/bin/env bun
/**
 * Release build for the GitHub release branch.
 *
 *   bun run build:release -- --out <dir>   build the plugin tree into <dir> (emptied first)
 *   bun run build:release -- --decide      print `release`, `version`, `tag`, `reason` as key=value lines
 *
 * The tree is deterministic: same commit in, same bytes out.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";

export const TAG_PREFIX = "pstack-v";
export const PACKAGE_ROOT = path.resolve(import.meta.dir, "..", "..");

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const COPIED = ["skills", "agents", "README.md", "THIRD-PARTY-NOTICES.txt"] as const;
const BUNDLE = "src/index.js";
const VERDICT = "src/verdict.ts";

export interface ReleaseDecision {
	release: boolean;
	version: string;
	tag: string;
	reason: string;
}

/** A version with no `pstack-v<version>` tag yet releases; one that already has its tag does nothing. */
export function decideRelease(version: string, tags: readonly string[]): ReleaseDecision {
	if (!VERSION.test(version)) throw new Error(`not a semver version: ${JSON.stringify(version)}`);
	const tag = `${TAG_PREFIX}${version}`;
	const exists = tags.includes(tag);
	return { release: !exists, version, tag, reason: exists ? `${tag} already exists` : `${tag} does not exist yet` };
}

type Manifest = Record<string, unknown>;

/** No `dependencies`: the extension is bundled and `@oh-my-pi/*` comes from the OMP host. */
export function releaseManifest(source: Manifest): Manifest {
	return {
		name: source.name,
		version: source.version,
		type: "module",
		description: source.description,
		license: source.license,
		peerDependencies: source.peerDependencies,
		omp: { extensions: [`./${BUNDLE}`] },
	};
}

function copyTree(from: string, to: string): void {
	fs.mkdirSync(to, { recursive: true });
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		if (entry.name === "node_modules" || TEST_FILE.test(entry.name)) continue;
		const source = path.join(from, entry.name);
		const target = path.join(to, entry.name);
		if (entry.isDirectory()) copyTree(source, target);
		else fs.copyFileSync(source, target);
	}
}

async function bundle(entry: string, banner?: string): Promise<string> {
	const result = await Bun.build({
		entrypoints: [entry],
		target: "bun",
		format: "esm",
		external: ["@oh-my-pi/*"],
		banner,
	});
	if (!result.success) throw new Error(`bundling ${entry} failed:\n${result.logs.join("\n")}`);
	return await result.outputs[0]!.text();
}

export async function buildRelease(out: string, root = PACKAGE_ROOT): Promise<void> {
	const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as Manifest;
	fs.rmSync(out, { recursive: true, force: true });
	fs.mkdirSync(path.join(out, "src"), { recursive: true });

	for (const name of COPIED) {
		const source = path.join(root, name);
		if (fs.statSync(source).isDirectory()) copyTree(source, path.join(out, name));
		else fs.copyFileSync(source, path.join(out, name));
	}

	fs.writeFileSync(path.join(out, BUNDLE), await bundle(path.join(root, "src", "index.ts")));
	// panel-verdicts.md imports <skill dir>/../../src/verdict.ts; the built tree has no other sources, so ship it self-contained.
	fs.writeFileSync(
		path.join(out, VERDICT),
		await bundle(path.join(root, "src", "verdict.ts"), "// Built from packages/pstack/src/verdict.ts; do not edit."),
	);
	fs.writeFileSync(path.join(out, "package.json"), `${JSON.stringify(releaseManifest(sourceManifest), null, "\t")}\n`);
}

function gitTags(): string[] {
	const result = Bun.spawnSync(["git", "tag", "--list", `${TAG_PREFIX}*`], { cwd: PACKAGE_ROOT });
	if (result.exitCode !== 0) throw new Error(`git tag --list failed: ${result.stderr.toString().trim()}`);
	return result.stdout.toString().split("\n").filter(Boolean);
}

if (import.meta.main) {
	const { values } = parseArgs({ args: Bun.argv.slice(2), options: { out: { type: "string" }, decide: { type: "boolean" } } });
	if (values.decide) {
		const { version } = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string };
		for (const [key, value] of Object.entries(decideRelease(version, gitTags()))) console.log(`${key}=${value}`);
	} else if (values.out) {
		await buildRelease(path.resolve(values.out));
		console.log(`built ${path.resolve(values.out)}`);
	} else {
		console.error("usage: bun run build:release -- --out <dir> | --decide");
		process.exit(2);
	}
}
