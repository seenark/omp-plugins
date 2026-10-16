import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NOTICES_FILE, PIN_FILE, runSync, SyncConfigError, type SyncOptions } from "./engine.ts";
import { collisions } from "./rules/collisions.ts";
import { loadTree } from "./source.ts";
import type { Group } from "./types.ts";

/** Fixture trees lack the files the other groups move or fork, so these tests run the collision renames alone. */
const shippedGroups = [collisions];

const temporary: string[] = [];
afterEach(() => {
	for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function scratch(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-sync-test-"));
	temporary.push(directory);
	return directory;
}

const BASE_FILES: Record<string, string> = {
	"pstack/LICENSE": "pstack license text\n",
	"cursor-team-kit/LICENSE": "team kit license text\n",
	"pstack/plugin.json": '{"version":"9.9.9"}',
};

/** Builds an Upstream fixture tree on disk and loads it through the same reader sync uses. */
function upstreamTree(files: Record<string, string>) {
	const root = scratch();
	for (const [file, content] of Object.entries({ ...BASE_FILES, ...files })) {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), content);
	}
	return loadTree(root);
}

function skill(name: string, body = "body\n", extraFrontmatter = ""): string {
	return `---\nname: ${name}\ndescription: "${name} skill"\n${extraFrontmatter}---\n\n${body}`;
}

function sync(upstream: ReturnType<typeof upstreamTree>, groups: readonly Group[], options: Partial<SyncOptions> & { packageRoot?: string } = {}) {
	const packageRoot = options.packageRoot ?? scratch();
	const result = runSync({ packageRoot, upstream, repository: "https://example.test/repo", revision: "rev-1", groups, write: true, ...options });
	return { packageRoot, result };
}

function read(root: string, file: string): string {
	return fs.readFileSync(path.join(root, file), "utf8");
}

function snapshot(root: string): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (relative: string) => {
		for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
			const child = path.join(relative, entry.name);
			if (entry.isDirectory()) walk(child);
			else out[child] = fs.readFileSync(path.join(root, child), "utf8");
		}
	};
	walk("");
	return out;
}

const none: Group = { name: "none" };

describe("import and exclusion", () => {
	const upstream = upstreamTree({
		"pstack/skills/keep/SKILL.md": skill("keep"),
		"pstack/skills/make-bot-ui/SKILL.md": skill("make-bot-ui"),
		"pstack/agents/helper.md": skill("helper"),
		"pstack/automations/benny/README.md": "automation\n",
		"pstack/docs/guide/01.md": "guide\n",
		"cursor-team-kit/skills/deslop/SKILL.md": skill("deslop"),
		"cursor-team-kit/skills/fix-ci/SKILL.md": skill("fix-ci"),
	});
	const exclude: Group = { name: "x", exclusions: [{ path: "skills/make-bot-ui/**", rationale: "not wanted" }] };

	it("vendors skills, agents and deslop, and no other Upstream path", () => {
		const { packageRoot } = sync(upstream, [exclude]);
		expect(Object.keys(snapshot(packageRoot)).sort()).toEqual([
			NOTICES_FILE,
			"agents/helper.md",
			"skills/deslop/SKILL.md",
			"skills/keep/SKILL.md",
			PIN_FILE,
		]);
	});

	it("drops an Excluded path that exists in Upstream, and keeps it without the exclusion", () => {
		expect(fs.existsSync(path.join(sync(upstream, [exclude]).packageRoot, "skills/make-bot-ui"))).toBe(false);
		expect(fs.existsSync(path.join(sync(upstream, [none]).packageRoot, "skills/make-bot-ui/SKILL.md"))).toBe(true);
	});
});

describe("substitution table", () => {
	const upstream = upstreamTree({
		"pstack/skills/a/SKILL.md": skill("a", "use Task here and Task there\nkeep gt-free\n"),
		"pstack/skills/a/scripts/run.ts": "// Task stays in code\n",
	});

	it("applies literal and regex rules in order, only to files in scope", () => {
		const group: Group = {
			name: "g",
			rules: [
				{ id: "g/task", rationale: "r", pattern: "Task", replacement: "task" },
				{ id: "g/count", rationale: "r", pattern: /(\w+) here/, replacement: "$1 (here)" },
			],
		};
		const { packageRoot } = sync(upstream, [group]);
		expect(read(packageRoot, "skills/a/SKILL.md")).toContain("use task (here) and task there");
		expect(read(packageRoot, "skills/a/scripts/run.ts")).toBe("// Task stays in code\n");
	});

	it("honours an explicit file scope", () => {
		const group: Group = { name: "g", rules: [{ id: "g/ts", rationale: "r", files: "**/*.ts", pattern: "Task", replacement: "task" }] };
		const { packageRoot } = sync(upstream, [group]);
		expect(read(packageRoot, "skills/a/scripts/run.ts")).toBe("// task stays in code\n");
		expect(read(packageRoot, "skills/a/SKILL.md")).toContain("use Task here");
	});

	it("rejects a rule shadowed by an earlier rule and writes nothing", () => {
		const group: Group = {
			name: "g",
			rules: [
				{ id: "g/broad", rationale: "r", pattern: "Task", replacement: "task" },
				{ id: "g/narrow", rationale: "r", pattern: "Task here", replacement: "never" },
			],
		};
		const packageRoot = scratch();
		expect(() => sync(upstream, [group], { packageRoot })).toThrow(/shadowed.*g\/narrow/);
		expect(fs.readdirSync(packageRoot)).toEqual([]);
	});

	it("accepts a rule that matches only text an earlier rule produced, and reports a rule that matches nothing", () => {
		const group: Group = {
			name: "g",
			rules: [
				{ id: "g/first", rationale: "r", pattern: "Task", replacement: "Job" },
				{ id: "g/chained", rationale: "r", pattern: "Job here", replacement: "job (here)" },
				{ id: "g/stale", rationale: "r", pattern: "does not occur", replacement: "x" },
			],
		};
		const { packageRoot, result } = sync(upstream, [group]);
		expect(read(packageRoot, "skills/a/SKILL.md")).toContain("job (here)");
		expect(result.unusedRules).toEqual(["g/stale"]);
	});

	it("rejects a rule without a rationale or with a duplicate id", () => {
		const bare: Group = { name: "g", rules: [{ id: "g/x", rationale: " ", pattern: "Task", replacement: "t" }] };
		const twin: Group = { name: "g", rules: [{ id: "g/x", rationale: "r", pattern: "a", replacement: "b" }, { id: "g/x", rationale: "r", pattern: "c", replacement: "d" }] };
		expect(() => sync(upstream, [bare])).toThrow(SyncConfigError);
		expect(() => sync(upstream, [twin])).toThrow(/duplicate rule id/);
	});

	it("leaves binary files byte-identical and keeps the executable bit", () => {
		const root = scratch();
		for (const [file, data] of Object.entries(BASE_FILES)) {
			fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
			fs.writeFileSync(path.join(root, file), data);
		}
		fs.mkdirSync(path.join(root, "pstack/skills/a"), { recursive: true });
		fs.writeFileSync(path.join(root, "pstack/skills/a/SKILL.md"), skill("a"));
		fs.writeFileSync(path.join(root, "pstack/skills/a/image.bin"), Buffer.from([0, 84, 97, 115, 107, 255]));
		fs.writeFileSync(path.join(root, "pstack/skills/a/run.sh"), "#!/bin/sh\n", { mode: 0o755 });
		const group: Group = { name: "g", rules: [{ id: "g/all", rationale: "r", files: "**/*", pattern: "Task", replacement: "task" }] };
		const { packageRoot } = sync(loadTree(root), [group]);
		expect(fs.readFileSync(path.join(packageRoot, "skills/a/image.bin"))).toEqual(Buffer.from([0, 84, 97, 115, 107, 255]));
		expect(fs.statSync(path.join(packageRoot, "skills/a/run.sh")).mode & 0o111).not.toBe(0);
		expect(fs.statSync(path.join(packageRoot, "skills/a/SKILL.md")).mode & 0o111).toBe(0);
	});
});

describe("frontmatter and visibility", () => {
	const upstream = upstreamTree({
		"pstack/skills/principle-x/SKILL.md": skill("principle-x", "p\n", "disable-model-invocation: true\n"),
		"pstack/skills/standalone/SKILL.md": skill("standalone"),
		"pstack/skills/poteto-mode/SKILL.md": skill("Poteto Mode", "m\n", "icon: crown\ncolor: yellow\n"),
		"pstack/agents/poteto-agent.md": skill("poteto-agent", "a\n", "color: red\n"),
	});

	it("hides principle skills and no others", () => {
		const { packageRoot } = sync(upstream, [none]);
		expect(read(packageRoot, "skills/principle-x/SKILL.md")).toContain("\nhide: true\n");
		expect(read(packageRoot, "skills/standalone/SKILL.md")).not.toContain("hide:");
	});

	it("strips sticky-mode keys from skills and names every skill after its directory", () => {
		const { packageRoot } = sync(upstream, [none]);
		const poteto = read(packageRoot, "skills/poteto-mode/SKILL.md");
		expect(poteto).toContain("name: poteto-mode\n");
		expect(poteto).not.toMatch(/^(icon|color):/m);
		expect(read(packageRoot, "agents/poteto-agent.md")).toContain("color: red");
	});
});

describe("collision renames", () => {
	const upstream = upstreamTree({
		"pstack/skills/tdd/SKILL.md": skill("tdd"),
		"pstack/skills/teach/SKILL.md": skill("teach"),
		"pstack/skills/poteto-mode/playbooks/bug-fix.md": "See the **tdd** skill.\nTry `/tdd` or [tdd](../../tdd/SKILL.md) and /teach.\nA tddish word and /tdds stay.\n",
	});

	it("moves the skill, renames it, and rewrites every reference to it", () => {
		const { packageRoot } = sync(upstream, shippedGroups);
		expect(fs.existsSync(path.join(packageRoot, "skills/tdd"))).toBe(false);
		expect(read(packageRoot, "skills/pstack-tdd/SKILL.md")).toContain("name: pstack-tdd\n");
		expect(read(packageRoot, "skills/pstack-teach/SKILL.md")).toContain("name: pstack-teach\n");
		expect(read(packageRoot, "skills/poteto-mode/playbooks/bug-fix.md")).toBe(
			"See the **pstack-tdd** skill.\nTry `/pstack-tdd` or [tdd](../../pstack-tdd/SKILL.md) and /pstack-teach.\nA tddish word and /tdds stay.\n",
		);
	});

	it("rejects a rename onto an existing skill", () => {
		const clash = upstreamTree({ "pstack/skills/tdd/SKILL.md": skill("tdd"), "pstack/skills/pstack-tdd/SKILL.md": skill("pstack-tdd") });
		expect(() => sync(clash, shippedGroups)).toThrow(/collides/);
	});

	it("reports vendored names already owned by another skill directory", () => {
		const other = scratch();
		fs.mkdirSync(path.join(other, "pstack-tdd"));
		fs.writeFileSync(path.join(other, "pstack-tdd/SKILL.md"), skill("pstack-tdd"));
		const { result } = sync(upstream, shippedGroups, { skillDirectories: [other] });
		expect(result.collisions).toEqual([{ name: "pstack-tdd", directory: other }]);
		expect(sync(upstream, shippedGroups, { skillDirectories: [scratch()] }).result.collisions).toEqual([]);
	});
});

describe("re-running sync", () => {
	const upstream = upstreamTree({
		"pstack/skills/a/SKILL.md": skill("a", "Task\n"),
		"pstack/skills/principle-p/SKILL.md": skill("principle-p"),
		"pstack/skills/tdd/SKILL.md": skill("tdd"),
	});
	const group: Group = { name: "g", rules: [{ id: "g/t", rationale: "r", pattern: "Task", replacement: "task" }] };

	it("produces no diff when Upstream is unchanged", () => {
		const first = sync(upstream, [...shippedGroups, group]);
		const before = snapshot(first.packageRoot);
		const second = sync(upstream, [...shippedGroups, group], { packageRoot: first.packageRoot });
		expect(second.result.drift).toEqual([]);
		expect(snapshot(first.packageRoot)).toEqual(before);
	});

	it("check mode writes nothing and names every drifted path", () => {
		const { packageRoot } = sync(upstream, [group]);
		fs.writeFileSync(path.join(packageRoot, "skills/a/SKILL.md"), "hand edit\n");
		const { result } = sync(upstream, [group], { packageRoot, write: false });
		expect(result.drift).toEqual([{ path: "skills/a/SKILL.md", kind: "changed" }]);
		expect(read(packageRoot, "skills/a/SKILL.md")).toBe("hand edit\n");
	});

	it("check mode on a clean package reports no drift", () => {
		const { packageRoot } = sync(upstream, [group]);
		expect(sync(upstream, [group], { packageRoot, write: false }).result.drift).toEqual([]);
	});

	it("restores a hand-edited file that has no fork entry", () => {
		const { packageRoot } = sync(upstream, [group]);
		fs.writeFileSync(path.join(packageRoot, "skills/a/SKILL.md"), "hand edit\n");
		sync(upstream, [group], { packageRoot });
		expect(read(packageRoot, "skills/a/SKILL.md")).toContain("task");
	});
});

describe("fork registry", () => {
	const forked = (kind: "patched" | "rewritten"): Group => ({
		name: "f",
		forks: [{ path: "skills/a/SKILL.md", kind, reason: "diverges on purpose", since: "9.9.9" }],
	});
	const original = skill("a", "line one\nline two\nline three\nline four\nline five\nline six\nline seven\n");

	function withEdit(kind: "patched" | "rewritten") {
		const pinned = upstreamTree({ "pstack/skills/a/SKILL.md": original });
		const { packageRoot } = sync(pinned, [forked(kind)]);
		fs.writeFileSync(path.join(packageRoot, "skills/a/SKILL.md"), original.replace("line one", "line ONE (ours)"));
		return { pinned, packageRoot };
	}

	it("preserves a forked file the sync output would otherwise overwrite", () => {
		const { pinned, packageRoot } = withEdit("patched");
		const { result } = sync(pinned, [forked("patched")], { packageRoot });
		expect(read(packageRoot, "skills/a/SKILL.md")).toContain("line ONE (ours)");
		expect(result.drift).toEqual([]);
		expect(result.conflicts).toEqual([]);
	});

	it("keeps a file without a fork entry on sync output, as the must-trip contrast", () => {
		const { pinned, packageRoot } = withEdit("patched");
		sync(pinned, [none], { packageRoot });
		expect(read(packageRoot, "skills/a/SKILL.md")).toContain("line one");
	});

	it("merges a non-overlapping Upstream change into a patched fork", () => {
		const { pinned, packageRoot } = withEdit("patched");
		const next = upstreamTree({ "pstack/skills/a/SKILL.md": original.replace("line seven", "line SEVEN (upstream)") });
		const { result } = sync(next, [forked("patched")], { packageRoot, base: pinned, revision: "rev-2" });
		const merged = read(packageRoot, "skills/a/SKILL.md");
		expect(merged).toContain("line ONE (ours)");
		expect(merged).toContain("line SEVEN (upstream)");
		expect(result.conflicts).toEqual([]);
		expect(JSON.parse(read(packageRoot, PIN_FILE)).revision).toBe("rev-2");
	});

	it("reports a conflict, leaving markers, when Upstream changes the same lines", () => {
		const { pinned, packageRoot } = withEdit("patched");
		const next = upstreamTree({ "pstack/skills/a/SKILL.md": original.replace("line one", "line ONE (upstream)") });
		const { result } = sync(next, [forked("patched")], { packageRoot, base: pinned, revision: "rev-2" });
		expect(result.conflicts.map(conflict => conflict.path)).toEqual(["skills/a/SKILL.md"]);
		expect(read(packageRoot, "skills/a/SKILL.md")).toContain("<<<<<<<");
		const rerun = sync(next, [forked("patched")], { packageRoot, base: next, revision: "rev-2" });
		expect(rerun.result.conflicts.map(conflict => conflict.reason)).toEqual(["unresolved conflict markers"]);
	});

	it("reports an Upstream change to a rewritten file as a conflict and keeps ours", () => {
		const { pinned, packageRoot } = withEdit("rewritten");
		const next = upstreamTree({ "pstack/skills/a/SKILL.md": original.replace("line seven", "line SEVEN (upstream)") });
		const { result } = sync(next, [forked("rewritten")], { packageRoot, base: pinned, revision: "rev-2" });
		expect(result.conflicts.map(conflict => conflict.path)).toEqual(["skills/a/SKILL.md"]);
		expect(read(packageRoot, "skills/a/SKILL.md")).toContain("line ONE (ours)");
		expect(read(packageRoot, "skills/a/SKILL.md")).not.toContain("SEVEN");
	});

	it("rejects a fork entry that matches no file and one without a reason", () => {
		const pinned = upstreamTree({ "pstack/skills/a/SKILL.md": original });
		const missing: Group = { name: "f", forks: [{ path: "skills/none/SKILL.md", kind: "patched", reason: "r", since: "1" }] };
		const unreasoned: Group = { name: "f", forks: [{ path: "skills/a/SKILL.md", kind: "patched", reason: "", since: "1" }] };
		expect(() => sync(pinned, [missing])).toThrow(/matches no file/);
		expect(() => sync(pinned, [unreasoned])).toThrow(SyncConfigError);
	});
});

describe("Upstream changes", () => {
	it("removes a file Upstream dropped between the pinned and target revisions", () => {
		const pinned = upstreamTree({ "pstack/skills/a/SKILL.md": skill("a"), "pstack/skills/gone/SKILL.md": skill("gone") });
		const { packageRoot } = sync(pinned, [none]);
		const next = upstreamTree({ "pstack/skills/a/SKILL.md": skill("a") });
		sync(next, [none], { packageRoot, base: pinned, revision: "rev-2" });
		expect(fs.existsSync(path.join(packageRoot, "skills/gone"))).toBe(false);
		expect(fs.existsSync(path.join(packageRoot, "skills/a/SKILL.md"))).toBe(true);
	});

	it("leaves files it does not own alone", () => {
		const pinned = upstreamTree({ "pstack/skills/a/SKILL.md": skill("a") });
		const { packageRoot } = sync(pinned, [none]);
		fs.mkdirSync(path.join(packageRoot, "agents"), { recursive: true });
		fs.writeFileSync(path.join(packageRoot, "agents/generated.md"), "ours\n");
		sync(pinned, [none], { packageRoot });
		expect(read(packageRoot, "agents/generated.md")).toBe("ours\n");
	});
});

describe("Cursor term report", () => {
	const upstream = upstreamTree({
		"pstack/skills/a/SKILL.md": skill("a", "Use subagent_type here. AskQuestion once. gt create.\n"),
		"pstack/skills/b/SKILL.md": skill("b", "nothing Cursor-specific\n"),
	});
	const group: Group = {
		name: "t",
		terms: [
			{ id: "dispatch", owner: "T1", patterns: { subagent_type: /subagent_type/, AskQuestion: /AskQuestion/ } },
			{ id: "pr", owner: "T2", patterns: { gt: /\bgt\b/ } },
			{ id: "empty", owner: "T3", patterns: { nope: /nope/ } },
		],
	};

	it("lists remaining terms by category, term and file, and lists only files that match", () => {
		const { result } = sync(upstream, [group]);
		expect(result.findings).toEqual([
			{ category: "dispatch", owner: "T1", file: "skills/a/SKILL.md", term: "subagent_type", count: 1 },
			{ category: "dispatch", owner: "T1", file: "skills/a/SKILL.md", term: "AskQuestion", count: 1 },
			{ category: "pr", owner: "T2", file: "skills/a/SKILL.md", term: "gt", count: 1 },
		]);
		expect(result.report).toContain("skills/a/SKILL.md");
		expect(result.report).not.toContain("skills/b/SKILL.md");
	});

	it("does not fail the sync when terms remain", () => {
		expect(() => sync(upstream, [group])).not.toThrow();
	});

	it("stops reporting a term once a rule removes it", () => {
		const fix: Group = { ...group, rules: [{ id: "t/fix", rationale: "r", pattern: "subagent_type", replacement: "agent" }] };
		expect(sync(upstream, [fix]).result.findings.map(finding => finding.term)).toEqual(["AskQuestion", "gt"]);
	});
});

describe("third-party notices", () => {
	const upstream = upstreamTree({ "pstack/skills/a/SKILL.md": skill("a") });

	it("records the Pinned Revision, the version and both license texts", () => {
		const { packageRoot } = sync(upstream, [none], { revision: "abc123" });
		const notices = read(packageRoot, NOTICES_FILE);
		expect(notices).toContain("abc123");
		expect(notices).toContain("9.9.9");
		expect(notices).toContain("pstack license text");
		expect(notices).toContain("team kit license text");
		expect(JSON.parse(read(packageRoot, PIN_FILE))).toEqual({ repository: "https://example.test/repo", revision: "abc123", version: "9.9.9" });
	});

	it("keeps text outside the generated block when it regenerates", () => {
		const { packageRoot } = sync(upstream, [none], { revision: "abc123" });
		const file = path.join(packageRoot, NOTICES_FILE);
		fs.appendFileSync(file, "\nOther attribution\n");
		sync(upstream, [none], { packageRoot, revision: "def456" });
		const notices = read(packageRoot, NOTICES_FILE);
		expect(notices).toContain("Other attribution");
		expect(notices).toContain("def456");
		expect(notices).not.toContain("abc123");
	});
});
