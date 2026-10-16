import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Tree } from "./types.ts";

export const UPSTREAM_REPOSITORY = "https://github.com/cursor/plugins";

/** Upstream directories that become package content. Everything else in Upstream is never imported. */
export const IMPORT_MAP: ReadonlyArray<{ from: string; to: string }> = [
	{ from: "pstack/skills/", to: "skills/" },
	{ from: "pstack/agents/", to: "agents/" },
	{ from: "cursor-team-kit/skills/deslop/", to: "skills/deslop/" },
];

export const PSTACK_LICENSE = "pstack/LICENSE";
export const TEAM_KIT_LICENSE = "cursor-team-kit/LICENSE";
export const PSTACK_MANIFEST = "pstack/plugin.json";

const UPSTREAM_PATHS = [...IMPORT_MAP.map(entry => entry.from.replace(/\/$/, "")), PSTACK_LICENSE, TEAM_KIT_LICENSE, PSTACK_MANIFEST];
const IGNORED = /(^|\/)(node_modules|\.DS_Store)(\/|$)|\.log$/;

function walk(root: string, relative: string, tree: Tree): void {
	if (IGNORED.test(relative)) return;
	const absolute = path.join(root, relative);
	const stat = fs.statSync(absolute, { throwIfNoEntry: false });
	if (!stat) return;
	if (stat.isDirectory()) {
		for (const name of fs.readdirSync(absolute).sort()) walk(root, `${relative}/${name}`, tree);
		return;
	}
	tree.set(relative, { data: fs.readFileSync(absolute), executable: (stat.mode & 0o111) !== 0 });
}

/** Reads the Upstream directories sync cares about from a checkout (or fixture) rooted at `root`. */
export function loadTree(root: string): Tree {
	const tree: Tree = new Map();
	for (const upstreamPath of UPSTREAM_PATHS) walk(root, upstreamPath, tree);
	return tree;
}

function extract(archive: Buffer): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-upstream-"));
	execFileSync("tar", ["-x", "-C", directory], { input: archive });
	return directory;
}

/** Materialises `revision` of a local git repository, without touching its working tree. */
export function archiveRevision(repository: string, revision: string): string {
	const archive = execFileSync("git", ["-C", repository, "archive", "--format=tar", revision, ...UPSTREAM_PATHS], {
		maxBuffer: 512 * 1024 * 1024,
	});
	return extract(archive);
}

/** Fetches exactly `revision` from `url` into a throwaway repository and materialises it. */
export function fetchRevision(url: string, revision: string): string {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-fetch-"));
	try {
		const git = (...args: string[]) => execFileSync("git", ["-C", scratch, ...args], { stdio: ["ignore", "pipe", "inherit"] });
		git("init", "-q");
		git("fetch", "-q", "--depth", "1", url, revision);
		return archiveRevision(scratch, revision);
	} finally {
		fs.rmSync(scratch, { recursive: true, force: true });
	}
}

/** Resolves `revision` to an Upstream tree: from `checkout` when it holds the revision, else fetched. */
export function resolveTree(revision: string, checkout?: string): Tree {
	let directory: string | undefined;
	if (checkout !== undefined) {
		try {
			directory = archiveRevision(checkout, revision);
		} catch {
			directory = undefined;
		}
	}
	directory ??= fetchRevision(UPSTREAM_REPOSITORY, revision);
	try {
		return loadTree(directory);
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
}
