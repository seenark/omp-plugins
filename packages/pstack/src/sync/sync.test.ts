import { afterAll, afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NOTICES_FILE, PIN_FILE, runSync, SyncConfigError, type SyncOptions } from "./engine.ts";
import { collisions } from "./rules/collisions.ts";
import { dispatch } from "./rules/dispatch.ts";
import { sessions } from "./rules/sessions.ts";
import { loadTree } from "./source.ts";
import { scanTerms } from "./terms.ts";
import type { Group } from "./types.ts";

/** Fixture trees lack the files the other groups move or fork, so these tests run the collision renames and the slash-form rewrite alone. */
const shippedGroups = [collisions, sessions];

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
			"See the **pstack-tdd** skill.\nTry `/skill:pstack-tdd` or [tdd](../../pstack-tdd/SKILL.md) and /skill:pstack-teach.\nA tddish word and /tdds stay.\n",
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

	it("keeps a rewritten fork that Upstream never had, with no conflict", () => {
		const pinned = upstreamTree({ "pstack/skills/a/SKILL.md": original });
		const ours: Group = { name: "f", forks: [{ path: "skills/a/references/ours.md", kind: "rewritten", reason: "ours alone", since: "9.9.9" }] };
		const packageRoot = scratch();
		fs.mkdirSync(path.join(packageRoot, "skills/a/references"), { recursive: true });
		fs.writeFileSync(path.join(packageRoot, "skills/a/references/ours.md"), "ours\n");
		const { result } = sync(pinned, [ours], { packageRoot });
		expect(read(packageRoot, "skills/a/references/ours.md")).toBe("ours\n");
		expect(result.conflicts).toEqual([]);
		expect(result.drift.map(entry => entry.path)).not.toContain("skills/a/references/ours.md");
	});

	it("still reports a conflict when Upstream drops a file it once had and ours is forked", () => {
		const { pinned, packageRoot } = withEdit("rewritten");
		const next = upstreamTree({ "pstack/skills/other/SKILL.md": skill("other") });
		const { result } = sync(next, [forked("rewritten")], { packageRoot, base: pinned, revision: "rev-2" });
		expect(result.conflicts).toEqual([{ path: "skills/a/SKILL.md", reason: "Upstream removed a forked file" }]);
		expect(read(packageRoot, "skills/a/SKILL.md")).toContain("line ONE (ours)");
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

describe("dispatch adaptations", () => {
	const PB = "skills/poteto-mode/playbooks/";
	const POTETO = "skills/poteto-mode/SKILL.md";
	const HELP = "skills/poteto-help/SKILL.md";
	const fixtures: Record<string, { file: string; input: string; expected: string }> = {
		"dispatch/poteto-subagent-type": { file: POTETO, input: '**Use `subagent_type: "poteto-agent"` for any subagent you spawn.', expected: '**Use `agent: "poteto-agent"` for any subagent you spawn inside a playbook step**' },
		"dispatch/poteto-task-defaults": { file: POTETO, input: "**Defaults for every `Task` call.** `run_in_background: true`.", expected: "**Defaults for every `task` call.** Spawn every independent task" },
		"dispatch/poteto-effort": { file: POTETO, input: "**Match the model to the job.** Before each spawn.", expected: "**Match the effort to the job.**" },
		"dispatch/poteto-create-skill": { file: POTETO, input: "the **create-skill** skill (Cursor's built-in for authoring SKILL.md files).", expected: "the **create-skill** skill when the session lists one." },
		"dispatch/poteto-session-pickup-entry": { file: POTETO, input: "Resuming from a transcript, cloud-agent URL, or pushed branch.", expected: "Resuming from a transcript or a pushed branch." },
		"dispatch/playbook-code-delegate": { file: `${PB}feature.md`, input: "Delegate to a subagent using your configured feature model (default `grok-4.7-xhigh-fast`) now.", expected: "Delegate to a `poteto-agent` subagent (the `pstack-build` model role) now." },
		"dispatch/playbook-refactoring-delegate": { file: `${PB}refactoring.md`, input: "Delegate to a subagent using your configured refactoring model (default `grok-4.7-xhigh-fast`) now.", expected: "Delegate to a `pstack-mechanical` subagent now." },
		"dispatch/playbook-explore-agent": { file: `${PB}multi-phase-plan.md`, input: "Explore with the agent and an explicit model per the Subagents section (the **guard-the-context-window** principle skill).", expected: "Explore with the agent per the Subagents section (the **guard-the-context-window** principle skill)." },
		"dispatch/playbook-verification-lanes": { file: `${PB}multi-phase-plan.md`, input: "per the **swarm** skill, on the `swarm workers` model (default `grok-4.7-xhigh-fast`).", expected: "per the **swarm** skill, as isolated background tasks on the `pstack-build` lane." },
		"dispatch/playbook-live-lane-vm": { file: `${PB}multi-phase-plan.md`, input: "Each live lane runs on its own cloud VM at the PR head.", expected: "Each live lane runs as its own isolated background task at the PR head." },
		"dispatch/playbook-lane-video": { file: `${PB}multi-phase-plan.md`, input: "Record a video of the change on a lane VM.", expected: "Record a video of the change in its lane." },
		"dispatch/playbook-worktree-tasks": { file: `${PB}opening-a-pr.md`, input: "Multiple `Task` calls on the same branch each get their own worktree, or reset.", expected: "Multiple `task` calls on the same branch each run with `isolated: true`, which gives each its own worktree, or reset." },
		"dispatch/playbook-shipping-verifier": { file: `${PB}shipping.md`, input: "One verifier per PR, each a Cursor cloud agent, runs it.", expected: "One verifier per PR, each an isolated background task, runs it." },
		"dispatch/playbook-autopilot-owner": { file: `${PB}autopilot-full.md`, input: "Each owner is a Cursor cloud agent that builds, opens a PR.", expected: "Each owner is an isolated background task (`isolated: true`) that builds, opens a PR." },
		"dispatch/playbook-autopilot-vm": { file: `${PB}autopilot-full.md`, input: "Assume the VM dies. Push soon.", expected: "Assume the isolated task's worktree is discarded when it ends. Push soon." },
		"dispatch/playbook-pickup-no-cloud-url": { file: `${PB}session-pickup.md`, input: "Locate it: a transcript, a cloud-agent URL, or a pushed branch.", expected: "Locate it: a transcript, or a pushed branch." },
		"dispatch/playbook-pickup-isolated": { file: `${PB}session-pickup.md`, input: "Resist the bias to re-derive it.\nNext.", expected: "Run any agent that continues the prior work as an isolated background `task`" },
		"dispatch/playbook-pickup-transcript-task": { file: `${PB}session-pickup.md`, input: "Parse a long transcript in a subagent and keep the timeline.", expected: "Parse a long transcript in a read-only `pstack-explore` task and keep the timeline." },
		"dispatch/playbook-orchestrate-task-tools": { file: `${PB}orchestrate.md`, input: "drained only through the Task tool.", expected: "drained only through the `task` and `wait` tools." },
		"dispatch/playbook-orchestrate-nesting": { file: `${PB}orchestrate.md`, input: "(nesting works to depth 3, and a nested spawn has the full Task schema including `environment`)", expected: "(nesting is bounded by OMP's `task.maxRecursionDepth`, 2 by default, and a nested spawn has the full `task` schema including `isolated`)" },
		"dispatch/playbook-orchestrate-worker-isolation": { file: `${PB}orchestrate.md`, input: 'Always `environment: "cloud"` unless the task needs this machine: a simulator.', expected: "Always a background `task` with `isolated: true`, so each gets its own worktree." },
		"dispatch/playbook-orchestrate-local-store": { file: `${PB}orchestrate.md`, input: "Cloud agents cannot read the local store, so their briefs inline what they need or point at repo paths.", expected: "An isolated task cannot read this chat's local store, so its brief inlines what it needs or points at repo paths." },
		"dispatch/playbook-orchestrate-verbatim": { file: `${PB}orchestrate.md`, input: "Verbatim paste is for cloud spawns and every resume.", expected: "Verbatim paste is for isolated spawns and every resume." },
		"dispatch/playbook-orchestrate-budget": { file: `${PB}orchestrate.md`, input: "its spawn budget with the cloud default and the local exception list, the drain protocol", expected: "its spawn budget with the isolated default and the non-isolated exception list, the drain protocol" },
		"dispatch/playbook-orchestrate-rebase": { file: `${PB}orchestrate.md`, input: "Chain rebases run in cloud. A local rebase at this scale takes the laptop down.", expected: "Chain rebases run in an isolated task, so a rebase at this scale never touches the coordinator's checkout." },
		"dispatch/playbook-orchestrate-externalize": { file: `${PB}orchestrate.md`, input: "Work that exists only on one VM when that VM dies was never done.", expected: "Work that exists only in one isolated worktree when the session ends was never done." },
		"dispatch/playbook-orchestrate-probe": { file: `${PB}orchestrate.md`, input: "Probe the ledger, the cloud agent's status in the Cursor dashboard.", expected: "Probe the ledger, the task's entry under `history://`." },
		"dispatch/playbook-orchestrate-restart": { file: `${PB}orchestrate.md`, input: "After a Cursor restart: local agents are dead, cloud work is not. Re-read.", expected: "After an OMP restart: running tasks are dead, pushed branches and PRs are not. Re-read." },
		"dispatch/playbook-orchestrate-reattach": { file: `${PB}orchestrate.md`, input: "then reattach cloud work by PR and branch rather than agent id.", expected: "then reattach work by PR and branch rather than agent id." },
		"dispatch/playbook-pause-restart": { file: POTETO, input: "going offline, a Cursor restart, or imminent compaction.", expected: "going offline, an OMP restart, or imminent compaction." },
		"dispatch/playbook-cleanup-editor-state": {
			file: `${PB}worktree-cleanup.md`,
			input: "More: Xcode `DerivedData`, `~/Library/Application Support/Cursor` (`state.vscdb.backup`, and `snapshots/roots/<root>` where a `<root>` named for a folder you opened as a workspace balloons), package caches.",
			expected: "More: Xcode `DerivedData`, package caches.",
		},
		"dispatch/playbook-authoring-create-skill": { file: `${PB}authoring-a-skill.md`, input: "1. Use the **create-skill** skill (Cursor's built-in for authoring SKILL.md files).", expected: "1. Use the **create-skill** skill when the session lists one. Otherwise write the SKILL.md directly:" },
		"dispatch/interrogate-reviewers": {
			file: "skills/interrogate/SKILL.md",
			input: "Launch all reviewers in a single message with the Task tool, one per entry.\n\n| Reviewer A | `x` |\n\nNever treat an alias entry as a rejected slug or apply either fallback to it.\n\nAfter.",
			expected: "Launch all reviewers in a single `task` call, one critic per configured panel seat",
		},
		"dispatch/arena-runners": { file: "skills/arena/SKILL.md", input: "3. Pick the runners. Use the `arena runners` line in the rule.", expected: "3. Pick the runners. Each runner is the builder agent of one configured panel seat" },
		"dispatch/arena-fan-out": { file: "skills/arena/SKILL.md", input: "Spawn all N subagents in one message with `run_in_background: true`, each with the task.", expected: "Spawn all N subagents in one `task` call with `isolated: true`, each with the task." },
		"dispatch/arena-cross-judge": { file: "skills/arena/SKILL.md", input: "After all Phase B candidates complete, choose one model from the pool. Spawn one readonly judge subagent on that model. It sees the rubric.", expected: "After all Phase B candidates complete, spawn one `pstack-judge` subagent as the cross-judge. It is read-only. It sees the rubric." },
		"dispatch/architect-runners": { file: "skills/architect/SKILL.md", input: "Take the runners from the `architect runners` line in the rule, in place of arena.", expected: "Take the runners from the configured panel seats, exactly as the **arena** skill's Phase A does." },
		"dispatch/how-lanes": { file: "skills/how/SKILL.md", input: "Every spawn is a Task subagent with `subagent_type: generalPurpose` and `readonly: true`.", expected: "Every spawn is a read-only `task`. Explorers are `pstack-explore` agents" },
		"dispatch/why-lanes": { file: "skills/why/SKILL.md", input: "Each spawn below names a role line in the rule and a default.", expected: "Each spawn below names a lane agent" },
		"dispatch/why-read-only": { file: "skills/why/SKILL.md", input: "Every spawn is `generalPurpose` with `readonly: false` (agent mode).", expected: "Every spawn is a read-only lane: `pstack-explore` for investigators" },
		"dispatch/why-discovery": { file: "skills/why/SKILL.md", input: "Before spawning investigators, list the available MCPs from the Cursor environment. Use the map.", expected: "Before spawning investigators, list the MCP servers connected to this session." },
		"dispatch/why-investigator-agent": { file: "skills/why/SKILL.md", input: "`model`: the `why investigators` line, default `grok-4.7-xhigh-fast`.", expected: "`agent`: `pstack-explore`." },
		"dispatch/why-synthesizer-agent": { file: "skills/why/SKILL.md", input: "Spawn one synthesizer. `model`: the `why synthesizer` line, default `claude-opus-5-5-xhigh`. It gets:", expected: "Spawn one synthesizer. `agent`: `pstack-judge`. It gets:" },
		"dispatch/reflect-spawn": { file: "skills/reflect/SKILL.md", input: "One message, three `Task` calls, `subagent_type: generalPurpose`, agent mode.", expected: "One `task` call with three read-only lanes." },
		"dispatch/reflect-lanes": { file: "skills/reflect/SKILL.md", input: "Each reviewer and the synthesizer name a role line in the rule.", expected: "Each reviewer and the synthesizer name a lane agent" },
		"dispatch/reflect-table": {
			file: "skills/reflect/SKILL.md",
			input: "| Lens | Role line | Default `model` | Prompt template |\n|---|---|---|---|\n| Judgment | `a` | `b` | `references/judgment-reviewer.md` |\n| Tooling | `a` | `b` | `references/tooling-reviewer.md` |\n| Divergent | `reflect judgment, divergent, synthesizer` | `claude-opus-5-5-xhigh` | `references/divergent-reviewer.md` |",
			expected: "| Lens | Agent | Prompt template |\n|---|---|---|\n| Judgment | `pstack-judge` |",
		},
		"dispatch/reflect-synthesizer": { file: "skills/reflect/SKILL.md", input: "One `Task` call, `subagent_type: generalPurpose`, `model` from the line.", expected: "One `task` call to `pstack-judge`." },
		"dispatch/reflect-create-skill": { file: "skills/reflect/SKILL.md", input: "hand to Cursor's built-in `create-skill` skill and run its draft / test / iterate loop.", expected: "hand to the `create-skill` skill when the session lists one, otherwise to the Authoring or modifying a skill playbook, and run its draft / test / iterate loop." },
		"dispatch/reflect-example-slug": { file: "skills/reflect/references/synthesizer.md", input: "- \"we renamed `gpt-4` to `gpt-4o` in `encodingForModel`\"", expected: "- \"we renamed `fetchUser` to `loadUser` in `sessionStore`\"" },
		"dispatch/automate-me-create-skill-intro": { file: "skills/automate-me/SKILL.md", input: "three others: Cursor's built-in `create-skill` (authoring), and prose.", expected: "three others: the `create-skill` skill when the session lists one (authoring), and prose." },
		"dispatch/automate-me-create-skill-use": { file: "skills/automate-me/SKILL.md", input: "Use Cursor's built-in `create-skill` skill to author the skill. Placement:", expected: "Use the `create-skill` skill, when the session lists one, to author the skill. Otherwise follow the Authoring or modifying a skill playbook. Placement:" },
		"dispatch/swarm-worker-lane": { file: "skills/swarm/SKILL.md", input: "4. Pick the worker model from the `swarm workers` line in the rule.", expected: "4. Pick the worker lane: `pstack-build` when a worker writes" },
		"dispatch/swarm-fan-out": { file: "skills/swarm/SKILL.md", input: 'Spawn all N workers in one message with `subagent_type: generalPurpose`, `environment: "cloud"`.', expected: "Spawn all N workers in one `task` call, each with `agent` set to the step 4 lane and `isolated: true`" },
		"dispatch/swarm-base-branch": { file: "skills/swarm/SKILL.md", input: "When a worker must start from a non-default pushed branch, pass `cloud_base_branch`.", expected: "When a worker must start from a non-default branch, name the branch and its SHA in the brief" },
		"dispatch/no-comments-agent": { file: "skills/no-comments/SKILL.md", input: '1. Spawn `Task` with `subagent_type: "comment-sicko"`. Pass the scope.', expected: '1. Spawn a `task` with `agent: "comment-sicko"`. Pass the scope.' },
		"dispatch/help-custom-mode": { file: HELP, input: "Do the work, and mention once that a Custom Mode keeps it on.", expected: "Do the work, and mention once that `/poteto <task>` starts it directly." },
		"dispatch/help-no-model-rule": { file: HELP, input: "- No `~/.cursor/rules/pstack-models.mdc` means `/setup-pstack` hasn't run.", expected: "- No `pstack-*` model roles in the user's OMP config means `/pstack setup` hasn't run" },
		"dispatch/help-missing-roles": { file: HELP, input: "When the model rule is missing and it matters, ask whether the user wants to pick a model for each role and a reasoning budget now. It matters.", expected: "When no `pstack-*` model roles are set and it matters, ask whether the user wants to pick a model for each role now. It matters." },
		"dispatch/help-later-roles": { file: HELP, input: "- Later: every role keeps its default model until they run `/setup-pstack`.", expected: "- Later: every work role keeps its built-in fallback and every panel seat stays absent until they run `/pstack setup`." },
		"dispatch/help-install": { file: HELP, input: "1. Install with `/add-plugin pstack` in chat, or from Customize in the sidebar.", expected: "1. Install with `omp plugin install @codesook/omp-pstack`." },
		"dispatch/help-setup-step": { file: HELP, input: "2. Run [`/setup-pstack`](../setup-pstack/SKILL.md). It asks for a reasoning budget, maps a model to each role, and writes a rule. The rule applies to new chats.", expected: "2. Run [`/pstack setup`](../setup-pstack/SKILL.md). It offers presets," },
		"dispatch/help-loads": { file: HELP, input: "Installing changes nothing until the user invokes a skill. Only `/setup-pstack` loads from the user's words.", expected: "Installing changes nothing until the user starts a run with `/poteto <task>` or `/skill:poteto-mode`." },
		"dispatch/help-cost": { file: HELP, input: "Rerun `/setup-pstack` and pick a smaller budget or cheaper models. A shorter panel list runs fewer subagents, one for each entry. Save it.", expected: "Rerun `/pstack setup` and pick cheaper models for the roles." },
		"dispatch/help-built-for": { file: HELP, input: "pstack is built for Cursor. Its skills use the Agent Skills format.", expected: "pstack is built for OMP. Its skills use the Agent Skills format, so other tools can read them." },
		"dispatch/help-stays-on": {
			file: HELP,
			input: 'Whether `/poteto-mode` stays on depends on how the user starts it:\n\n- Enter on it.\n\nLink [docs](https://example.test). To get the same style, spawn it with `subagent_type: "poteto-agent"`.',
			expected: '`/poteto <task>` starts the skill on the task and marks pstack active for the Agent Session.',
		},
		"dispatch/help-swarm-row": { file: HELP, input: "| Run parallel checks, or race workers, as cloud agents | link |", expected: "| Run parallel checks, or race workers, as isolated background tasks | link |" },
		"dispatch/help-setup-row": { file: HELP, input: "| Pick a model for each role and a reasoning budget | link |", expected: "| Pick a model for each role | link |" },
		"dispatch/help-plan-mode": { file: HELP, input: "Cursor's Plan Mode works alongside it.", expected: "OMP's plan mode works alongside it." },
		"dispatch/help-mode-stopped": { file: HELP, input: "| It stopped | It was started with Enter. Start it as a Custom Mode, or start each task with `/poteto-mode`. |", expected: "| It stopped | Start each task with `/poteto <task>`. |" },
		"dispatch/help-new-model": { file: HELP, input: "| No effect | The rule from `/setup-pstack` applies to new chats. Start one. |", expected: "| No effect | The roles apply to subagents spawned after `/pstack setup` finishes. `/pstack doctor` shows which roles are set. |" },
		"dispatch/help-skill-not-loading": { file: HELP, input: "Only `/setup-pstack` loads from the user's words. The others load when typed.", expected: "Skills marked `disable-model-invocation` do not load from the user's words. They load when typed." },
		"dispatch/help-parallel-overwrite": { file: HELP, input: "Give each its own worktree, or run them as cloud agents, which each get their own machine.", expected: "Give each its own worktree, or run them as isolated background tasks, which each get their own worktree." },
		"dispatch/ask-tool": { file: "skills/automate-me/SKILL.md", input: "Use the `AskQuestion` tool (structured).", expected: "Use the `ask` tool (structured)." },
		"dispatch/agent-field": { file: `${PB}multi-phase-plan.md`, input: 'Explore with `subagent_type: "poteto-agent"` now.', expected: 'Explore with `agent: "poteto-agent"` now.' },
		"dispatch/effort-phrase": { file: "skills/figure-it-out/SKILL.md", input: "Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section.", expected: "Pick each subagent's lane and `effort` for the job, per the Subagents section." },
		"dispatch/task-prompt": { file: "skills/reflect/references/judgment-reviewer.md", input: "or a `Task` prompt naming its path, or a tool call.", expected: "or a `task` prompt naming its path, or a tool call." },
		"dispatch/setup-command": { file: "skills/recall/SKILL.md", input: "Run /setup-pstack now, not ../setup-pstack/SKILL.md.", expected: "Run /pstack setup now, not ../setup-pstack/SKILL.md." },
	};

	const ruleGroup: Group = { name: "dispatch", rules: dispatch.rules };
	const byFile = new Map<string, string[]>();
	for (const { file, input } of Object.values(fixtures)) byFile.set(file, [...(byFile.get(file) ?? []), input]);
	const upstream = upstreamTree(
		Object.fromEntries(
			[...byFile].map(([file, inputs]) => {
				const body = `${inputs.join("\n\n")}\n`;
				const name = /^skills\/([^/]+)\/SKILL\.md$/.exec(file)?.[1];
				return [`pstack/${file}`, name === undefined ? body : skill(name, body)];
			}),
		),
	);
	const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-dispatch-test-"));
	afterAll(() => fs.rmSync(packageRoot, { recursive: true, force: true }));
	sync(upstream, [ruleGroup], { packageRoot });

	it("has a must-apply fixture for every dispatch rule and none for a missing one", () => {
		expect(Object.keys(fixtures).sort()).toEqual(ruleGroup.rules!.map(rule => rule.id).sort());
	});

	for (const [id, { file, input, expected }] of Object.entries(fixtures)) {
		it(`applies ${id}`, () => {
			const output = read(packageRoot, file);
			expect(output).toContain(expected);
			expect(output).not.toContain(input);
		});
	}

	it("leaves a line without the Cursor primitive alone", () => {
		const untouched = upstreamTree({ "pstack/skills/swarm/SKILL.md": skill("swarm", "Spawn every worker with the pstack-build lane.\n") });
		const result = sync(untouched, [ruleGroup]);
		expect(read(result.packageRoot, "skills/swarm/SKILL.md")).toContain("Spawn every worker with the pstack-build lane.");
	});
});

describe("vendored output after the dispatch adaptations", () => {
	const root = path.resolve(import.meta.dir, "../..");
	const files = new Map<string, { data: Buffer; executable: boolean }>();
	for (const relative of new Bun.Glob("{skills,agents}/**/*").scanSync({ cwd: root })) {
		const absolute = path.join(root, relative);
		if (!relative.includes("node_modules") && fs.statSync(absolute).isFile()) files.set(relative, { data: fs.readFileSync(absolute), executable: false });
	}
	const dispatchTerms = dispatch.terms!;

	it("has no Cursor dispatch term left", () => {
		expect(scanTerms(files, dispatchTerms.filter(category => category.id === "dispatch"))).toEqual([]);
	});

	it("names only OMP lanes where it needs a Cursor model sheet", () => {
		const sheet = scanTerms(files, dispatchTerms.filter(category => category.id === "cursor-other"));
		expect(sheet.filter(finding => !/(babysit|bug-fix|autonomous-run|poteto-help|poteto-mode)/.test(finding.file) || finding.term !== "Cursor")).toEqual([]);
	});

	it("must trip: a Cursor dispatch term is found when one is present", () => {
		const dirty = new Map([["skills/x/SKILL.md", { data: Buffer.from("Spawn with subagent_type: generalPurpose via AskQuestion"), executable: false }]]);
		expect(new Set(scanTerms(dirty, dispatchTerms).map(finding => finding.term))).toEqual(new Set(["subagent_type", "generalPurpose", "AskQuestion"]));
	});
});
