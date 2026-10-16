import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { editFrontmatter } from "./frontmatter.ts";
import { renderNotices } from "./notices.ts";
import { IMPORT_MAP, PSTACK_LICENSE, PSTACK_MANIFEST, TEAM_KIT_LICENSE } from "./source.ts";
import { renderTermReport, scanTerms, type TermFinding } from "./terms.ts";
import type { Exclusion, Fork, Group, Pin, Rename, Rule, TermCategory, Tree, VFile } from "./types.ts";

export const PIN_FILE = "upstream.json";
export const NOTICES_FILE = "THIRD-PARTY-NOTICES.txt";
const DEFAULT_RULE_FILES = "**/*.md";
const CONFLICT_MARKER = /^<{7} /m;

/** Cursor mode UI keys on poteto-mode (icon, color); OMP has no sticky modes. */
const STICKY_MODE_KEYS = ["icon", "color"];
/** Principle skills are hidden from the prompt list; `/skill:principle-...` still loads them. */
const HIDDEN_SKILL_PREFIX = "principle-";

export class SyncConfigError extends Error {}

export interface Drift {
	path: string;
	kind: "changed" | "missing" | "stale";
}

export interface Conflict {
	path: string;
	reason: string;
}

export interface Collision {
	name: string;
	directory: string;
}

export interface SyncOptions {
	packageRoot: string;
	/** Upstream at the target revision. */
	upstream: Tree;
	/** Upstream at the revision currently pinned. Defaults to `upstream` (no Upstream change). */
	base?: Tree;
	repository: string;
	revision: string;
	groups: readonly Group[];
	/** Directories of other discovered skills, checked for name collisions with ours. */
	skillDirectories?: readonly string[];
	write: boolean;
}

export interface SyncResult {
	pin: Pin;
	drift: Drift[];
	conflicts: Conflict[];
	unusedRules: string[];
	collisions: Collision[];
	findings: TermFinding[];
	report: string;
}

interface Config {
	rules: Rule[];
	exclusions: Exclusion[];
	forks: Map<string, Fork>;
	renames: Rename[];
	terms: TermCategory[];
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The three reference shapes Upstream uses for another skill: `/name`, a `../name/` path, and **name** or `name`. */
function renameRules({ from, to, reason }: Rename): Rule[] {
	const name = escapeRegExp(from);
	return [
		{ id: `rename/${from}/slash-command`, rationale: reason, pattern: new RegExp(`(?<![\\w/.:-])/${name}(?![\\w-])`), replacement: `/${to}` },
		{ id: `rename/${from}/path`, rationale: reason, pattern: new RegExp(`(?<=\\.\\./|skills/)${name}(?=/)`), replacement: to },
		{ id: `rename/${from}/mention`, rationale: reason, pattern: new RegExp(`(\\*\\*|\`)${name}\\1`), replacement: `$1${to}$1` },
	];
}

function compile(groups: readonly Group[]): Config {
	const renames = groups.flatMap(group => group.renames ?? []);
	const rules = [...renames.flatMap(renameRules), ...groups.flatMap(group => group.rules ?? [])];
	const exclusions = groups.flatMap(group => group.exclusions ?? []);
	const problems: string[] = [];

	const ids = new Set<string>();
	for (const rule of rules) {
		if (ids.has(rule.id)) problems.push(`duplicate rule id ${rule.id}`);
		ids.add(rule.id);
		if (rule.rationale.trim() === "") problems.push(`rule ${rule.id} has no rationale`);
		if (rule.pattern === "") problems.push(`rule ${rule.id} has an empty pattern`);
	}
	for (const exclusion of exclusions) if (exclusion.rationale.trim() === "") problems.push(`exclusion ${exclusion.path} has no rationale`);
	for (const rename of renames) if (rename.reason.trim() === "") problems.push(`rename ${rename.from} has no reason`);

	const forks = new Map<string, Fork>();
	for (const fork of groups.flatMap(group => group.forks ?? [])) {
		if (forks.has(fork.path)) problems.push(`duplicate fork ${fork.path}`);
		if (fork.reason.trim() === "" || fork.since.trim() === "") problems.push(`fork ${fork.path} needs a reason and a since`);
		forks.set(fork.path, fork);
	}
	if (problems.length > 0) throw new SyncConfigError(problems.join("\n"));
	return { rules, exclusions, forks, renames, terms: groups.flatMap(group => group.terms ?? []) };
}

function importPath(upstreamPath: string): string | undefined {
	for (const { from, to } of IMPORT_MAP) if (upstreamPath.startsWith(from)) return to + upstreamPath.slice(from.length);
	return undefined;
}

function isText(file: VFile): boolean {
	return !file.data.includes(0);
}

function withText(file: VFile, text: string): VFile {
	return { data: Buffer.from(text, "utf8"), executable: file.executable };
}

function globally(pattern: RegExp): RegExp {
	return new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
}

function countMatches(rule: Rule, text: string): number {
	if (typeof rule.pattern === "string") return text.split(rule.pattern).length - 1;
	return text.match(globally(rule.pattern))?.length ?? 0;
}

function substitute(rule: Rule, text: string): string {
	if (typeof rule.pattern === "string") {
		const replacement = rule.replacement;
		return typeof replacement === "string" ? text.split(rule.pattern).join(replacement) : text.replaceAll(rule.pattern, replacement);
	}
	return text.replace(globally(rule.pattern), rule.replacement as string);
}

interface BuildResult {
	files: Tree;
	shadowed: string[];
	unused: string[];
}

/** Imports, excludes, renames, normalises frontmatter, then applies the substitution table, in that order. */
function build(upstream: Tree, config: Config): BuildResult {
	const excluded = config.exclusions.map(exclusion => new Bun.Glob(exclusion.path));
	let files: Tree = new Map();
	for (const [upstreamPath, file] of upstream) {
		const mapped = importPath(upstreamPath);
		if (mapped !== undefined && !excluded.some(glob => glob.match(mapped))) files.set(mapped, file);
	}

	for (const { from, to } of config.renames) {
		const renamed: Tree = new Map();
		for (const [filePath, file] of files) renamed.set(filePath.startsWith(`skills/${from}/`) ? `skills/${to}/${filePath.slice(`skills/${from}/`.length)}` : filePath, file);
		if (renamed.size !== files.size) throw new SyncConfigError(`renaming skill ${from} to ${to} collides with an existing skill`);
		files = renamed;
	}

	const skillName = /^skills\/([^/]+)\/SKILL\.md$/;
	const agentName = /^agents\/([^/]+)\.md$/;
	for (const [filePath, file] of files) {
		const skill = skillName.exec(filePath)?.[1];
		const agent = agentName.exec(filePath)?.[1];
		const name = skill ?? agent;
		if (name === undefined || !isText(file)) continue;
		const text = file.data.toString("utf8");
		const edited = editFrontmatter(text, {
			name,
			remove: skill === undefined ? [] : STICKY_MODE_KEYS,
			add: skill?.startsWith(HIDDEN_SKILL_PREFIX) ? { hide: "true" } : {},
		});
		if (edited !== text) files.set(filePath, withText(file, edited));
	}

	const globs = config.rules.map(rule => new Bun.Glob(rule.files ?? DEFAULT_RULE_FILES));
	const original = config.rules.map(() => 0);
	const atTurn = config.rules.map(() => 0);
	for (const [filePath, file] of files) {
		if (!isText(file)) continue;
		const before = file.data.toString("utf8");
		let text = before;
		config.rules.forEach((rule, index) => {
			if (!globs[index]!.match(filePath)) return;
			original[index]! += countMatches(rule, before);
			const matches = countMatches(rule, text);
			atTurn[index]! += matches;
			if (matches > 0) text = substitute(rule, text);
		});
		if (text !== before) files.set(filePath, withText(file, text));
	}

	return {
		files,
		shadowed: config.rules.filter((_, index) => original[index]! > 0 && atTurn[index] === 0).map(rule => rule.id),
		unused: config.rules.filter((_, index) => original[index] === 0 && atTurn[index] === 0).map(rule => rule.id),
	};
}

function readCurrent(packageRoot: string, relative: string): VFile | undefined {
	const absolute = path.join(packageRoot, relative);
	const stat = fs.statSync(absolute, { throwIfNoEntry: false });
	if (!stat?.isFile()) return undefined;
	return { data: fs.readFileSync(absolute), executable: (stat.mode & 0o111) !== 0 };
}

function sameFile(a: VFile | undefined, b: VFile | undefined): boolean {
	return a !== undefined && b !== undefined && a.executable === b.executable && a.data.equals(b.data);
}

/** `git merge-file`: our edits, the revision they were made against, the new Upstream. Returns the conflict count. */
function merge(ours: Buffer, base: Buffer, theirs: Buffer): { data: Buffer; conflicts: number } {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-merge-"));
	try {
		const [ourFile, baseFile, theirFile] = ["ours", "base", "theirs"].map(name => path.join(scratch, name)) as [string, string, string];
		fs.writeFileSync(ourFile, ours);
		fs.writeFileSync(baseFile, base);
		fs.writeFileSync(theirFile, theirs);
		const result = spawnSync("git", ["merge-file", "-p", "-L", "ours", "-L", "pinned upstream", "-L", "new upstream", ourFile, baseFile, theirFile]);
		if (result.error || result.status === null || result.status < 0 || result.status > 127) throw new SyncConfigError(`git merge-file failed: ${result.error ?? result.stderr}`);
		return { data: result.stdout, conflicts: result.status };
	} finally {
		fs.rmSync(scratch, { recursive: true, force: true });
	}
}

function resolveFork(fork: Fork, ours: VFile | undefined, base: VFile | undefined, theirs: VFile | undefined, conflicts: Conflict[]): VFile | undefined {
	if (ours !== undefined && CONFLICT_MARKER.test(ours.data.toString("utf8"))) {
		conflicts.push({ path: fork.path, reason: "unresolved conflict markers" });
		return ours;
	}
	if (theirs === undefined) {
		if (ours !== undefined) conflicts.push({ path: fork.path, reason: "Upstream removed a forked file" });
		return ours;
	}
	if (ours === undefined) return theirs;
	if (base === undefined || sameFile(base, theirs)) return ours;
	if (fork.kind === "rewritten") {
		conflicts.push({ path: fork.path, reason: "Upstream changed a rewritten file" });
		return ours;
	}
	const merged = merge(ours.data, base.data, theirs.data);
	if (merged.conflicts > 0) conflicts.push({ path: fork.path, reason: `${merged.conflicts} merge conflict(s); resolve the markers` });
	return { data: merged.data, executable: ours.executable };
}

function skillNames(files: Tree): string[] {
	return [...files.keys()].flatMap(file => /^skills\/([^/]+)\/SKILL\.md$/.exec(file)?.[1] ?? []);
}

function findCollisions(names: readonly string[], directories: readonly string[]): Collision[] {
	const collisions: Collision[] = [];
	for (const directory of directories) {
		for (const name of names) if (fs.existsSync(path.join(directory, name, "SKILL.md"))) collisions.push({ name, directory });
	}
	return collisions;
}

function describePin(upstream: Tree, repository: string, revision: string): Pin {
	const manifest = upstream.get(PSTACK_MANIFEST);
	const version = manifest ? (JSON.parse(manifest.data.toString("utf8")) as { version?: string }).version : undefined;
	if (!version) throw new SyncConfigError(`${PSTACK_MANIFEST} is missing or has no version`);
	return { repository, revision, version };
}

function requireLicense(upstream: Tree, upstreamPath: string): string {
	const file = upstream.get(upstreamPath);
	if (!file) throw new SyncConfigError(`${upstreamPath} is missing from Upstream`);
	return file.data.toString("utf8");
}

export function runSync(options: SyncOptions): SyncResult {
	const { packageRoot, upstream, groups } = options;
	const config = compile(groups);
	const theirs = build(upstream, config);
	if (theirs.shadowed.length > 0) throw new SyncConfigError(`shadowed rules never apply, remove or reorder: ${theirs.shadowed.join(", ")}`);
	const base = options.base === undefined ? theirs.files : build(options.base, config).files;

	for (const fork of config.forks.values()) {
		if (!theirs.files.has(fork.path) && !base.has(fork.path) && readCurrent(packageRoot, fork.path) === undefined) {
			throw new SyncConfigError(`fork ${fork.path} matches no file`);
		}
	}

	const desired: Tree = new Map();
	const drift: Drift[] = [];
	const conflicts: Conflict[] = [];
	const stale: string[] = [];
	for (const filePath of new Set([...theirs.files.keys(), ...base.keys(), ...config.forks.keys()])) {
		const current = readCurrent(packageRoot, filePath);
		const fork = config.forks.get(filePath);
		const next = fork ? resolveFork(fork, current, base.get(filePath), theirs.files.get(filePath), conflicts) : theirs.files.get(filePath);
		if (next === undefined) {
			if (current !== undefined) {
				stale.push(filePath);
				drift.push({ path: filePath, kind: "stale" });
			}
			continue;
		}
		desired.set(filePath, next);
		if (!sameFile(current, next)) drift.push({ path: filePath, kind: current === undefined ? "missing" : "changed" });
	}

	const pin = describePin(upstream, options.repository, options.revision);
	const pinText = `${JSON.stringify(pin, null, "\t")}\n`;
	const noticesPath = path.join(packageRoot, NOTICES_FILE);
	const noticesText = renderNotices(fs.existsSync(noticesPath) ? fs.readFileSync(noticesPath, "utf8") : undefined, {
		pin,
		exclusions: config.exclusions,
		licenses: { pstack: requireLicense(upstream, PSTACK_LICENSE), teamKit: requireLicense(upstream, TEAM_KIT_LICENSE) },
	});
	for (const [name, text] of [[PIN_FILE, pinText], [NOTICES_FILE, noticesText]] as const) {
		const current = readCurrent(packageRoot, name);
		if (current?.data.toString("utf8") !== text) drift.push({ path: name, kind: current === undefined ? "missing" : "changed" });
	}

	if (options.write) {
		for (const [filePath, file] of desired) {
			const absolute = path.join(packageRoot, filePath);
			if (sameFile(readCurrent(packageRoot, filePath), file)) continue;
			fs.mkdirSync(path.dirname(absolute), { recursive: true });
			fs.writeFileSync(absolute, file.data);
			fs.chmodSync(absolute, file.executable ? 0o755 : 0o644);
		}
		for (const filePath of stale) {
			fs.rmSync(path.join(packageRoot, filePath));
			for (let directory = path.dirname(path.join(packageRoot, filePath)); directory !== packageRoot && fs.readdirSync(directory).length === 0; directory = path.dirname(directory)) fs.rmdirSync(directory);
		}
		fs.writeFileSync(path.join(packageRoot, PIN_FILE), pinText);
		fs.writeFileSync(noticesPath, noticesText);
	}

	const findings = scanTerms(desired, config.terms);
	const collisions = findCollisions(skillNames(desired), options.skillDirectories ?? []);
	const result: SyncResult = { pin, drift, conflicts, unusedRules: theirs.unused, collisions, findings, report: "" };
	result.report = renderReport(result, config.terms, options.write);
	return result;
}

function renderReport(result: SyncResult, terms: readonly TermCategory[], written: boolean): string {
	const list = (title: string, items: readonly string[]) => (items.length > 0 ? [`## ${title}`, "", ...items.map(item => `- ${item}`), ""] : []);
	return [
		`# pstack sync report: pstack ${result.pin.version} at ${result.pin.revision}`,
		"",
		...list("Conflicts", result.conflicts.map(conflict => `${conflict.path}: ${conflict.reason}`)),
		...(written
			? [`${result.drift.length} file(s) updated.`, ""]
			: list("Drift from sync output", result.drift.map(entry => `${entry.path} (${entry.kind})`))),
		...list("Skill name collisions", result.collisions.map(collision => `${collision.name} also exists in ${collision.directory}`)),
		...list("Rules that matched nothing", result.unusedRules),
		renderTermReport(result.findings, terms),
	].join("\n");
}
