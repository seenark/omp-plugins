import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runSync, SyncConfigError } from "./engine.ts";
import { pr } from "./rules/pr.ts";
import { loadTree } from "./source.ts";
import { scanTerms } from "./terms.ts";
import type { Group } from "./types.ts";

const temporary: string[] = [];
afterEach(() => {
	for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function scratch(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-pr-test-"));
	temporary.push(directory);
	return directory;
}

function upstreamTree(files: Record<string, string>) {
	const root = scratch();
	const all = { "pstack/LICENSE": "l\n", "cursor-team-kit/LICENSE": "l\n", "pstack/plugin.json": '{"version":"9.9.9"}', ...files };
	for (const [file, content] of Object.entries(all)) {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), content);
	}
	return loadTree(root);
}

function sync(files: Record<string, string>, groups: readonly Group[]) {
	const packageRoot = scratch();
	const result = runSync({ packageRoot, upstream: upstreamTree(files), repository: "https://example.test/repo", revision: "rev-1", groups, write: true });
	return { packageRoot, result };
}

const MODE = "skills/poteto-mode";
const FALLBACK_FILE = `${MODE}/SKILL.md`;

/** Package paths that the glob-scoped rules need a concrete file for. */
const FILE_OF: Record<string, string> = {
	"pr/triage-reference-wording": `${MODE}/references/bugbot-triage.md`,
};

/** Upstream text a rule must apply to. A literal rule applies to its own pattern; a regex rule needs a sample. */
const SAMPLE_OF: Record<string, string> = {
	"pr/scripts-package": '{\n  "scripts": {\n    "test": "bun test orch watch-pr check-plan.test.ts",\n    "typecheck": "tsc --project watch-pr/tsconfig.json --noEmit --strict"\n  }\n}\n',
	"pr/drop-graphite-requirement": "Stay on `gh`. Never require Graphite (`gt`). Record it. Never require `gt`.\n",
	"pr/shipping-watch-run":
		"On GitHub, watch the run with the queued watcher from `playbooks/babysit.md` (`scripts/watch-pr/watch-pr --queued-stack --stack-prs <bottom-to-top>`) under `/loop` until it reports `COMPLETE` at the ceiling.\n",
	"pr/babysit-status-and-stop":
		"6. **Trust the active forge's verdict, not a green check list.** Run `scripts/watch-pr/watch-pr` under `/loop`.\n\n   Stop at `READY`.\n\n   Answer a user question. Revise the list and rearm with the corrected snapshot.\n7. **Next.**\n",
	"pr/triage-reference-wording": "# Bugbot triage\nSkip when: Bugbot flags it; the Bugbot comment is only that; six Bugbot passes.\n",
};

function sampleFor(rule: NonNullable<Group["rules"]>[number]): { file: string; text: string } {
	const text = SAMPLE_OF[rule.id] ?? (typeof rule.pattern === "string" ? rule.pattern : undefined);
	if (text === undefined) throw new Error(`rule ${rule.id} is a regex and has no sample`);
	const file = FILE_OF[rule.id] ?? rule.files ?? FALLBACK_FILE;
	if (/[*{]/.test(file)) throw new Error(`rule ${rule.id} scope ${file} needs a FILE_OF entry`);
	return { file, text };
}

describe("PR workflow adaptations", () => {
	const samples = (pr.rules ?? []).map(sampleFor);
	const files: Record<string, string> = {
		"pstack/skills/poteto-mode/scripts/watch-pr/cli.ts": "// Bugbot watcher\n",
		"pstack/skills/poteto-mode/scripts/watch-pr/watch-pr": "#!/bin/sh\n",
	};
	for (const { file, text } of samples) {
		const upstreamPath = `pstack/${file.replace("review-bot-triage", "bugbot-triage")}`;
		files[upstreamPath] = `${files[upstreamPath] ?? ""}${text}\n`;
	}
	files[`pstack/${MODE}/references/bugbot-triage.md`] ??= "";
	// The fork needs the real package file, which the fixture package root lacks; its own test covers it.
	const run = () => sync(files, [{ ...pr, forks: [] }]);

	it("applies every rule to its Upstream text", () => {
		const { result } = run();
		expect(samples).toHaveLength(pr.rules!.length);
		expect(result.unusedRules).toEqual([]);
	});

	it("leaves no Graphite, /loop, Bugbot or watch-pr term in the output", () => {
		const { result } = run();
		expect(result.findings.filter(finding => finding.category === "pr")).toEqual([]);
	});

	it("drops the watch-pr script and moves the triage reference under a vendor-neutral name", () => {
		const { packageRoot } = run();
		expect(fs.existsSync(path.join(packageRoot, MODE, "scripts/watch-pr"))).toBe(false);
		expect(fs.existsSync(path.join(packageRoot, MODE, "references/bugbot-triage.md"))).toBe(false);
		expect(fs.existsSync(path.join(packageRoot, MODE, "references/review-bot-triage.md"))).toBe(true);
	});

	it("keeps the move target consistent with the links that point at it", () => {
		const { packageRoot } = run();
		const link = fs.readFileSync(path.join(packageRoot, FALLBACK_FILE), "utf8");
		expect(link).toContain("review-bot-triage.md");
		expect(link).not.toContain("bugbot-triage.md");
	});
});

describe("PR term scan", () => {
	const scan = (text: string) => scanTerms(new Map([["a.md", { data: Buffer.from(text), executable: false }]]), pr.terms!);
	const names = (text: string) => scan(text).map(finding => finding.term);

	it("flags the Graphite CLI by its command and the other Cursor-only terms", () => {
		expect(names("Use `gt` to restack, or Graphite, or /loop, or Bugbot, or watch-pr.")).toEqual(["Graphite", "gt", "/loop", "Bugbot", "watch-pr"]);
	});

	it("does not flag the shell test operator or a quoted forge name in code", () => {
		expect(names('[ "$age" -gt 0 ] && forge "gt" && gt-free')).toEqual([]);
	});
});

describe("autopilot-stack fork", () => {
	it("records the degradation with a reason, against a file that exists in the package", () => {
		const fork = pr.forks!.find(entry => entry.path === `${MODE}/playbooks/autopilot-stack.md`);
		expect(fork?.kind).toBe("patched");
		expect(fork?.reason.trim()).not.toBe("");
		expect(fs.existsSync(path.join(import.meta.dir, "../..", fork!.path))).toBe(true);
	});
});

describe("moves", () => {
	const files = { "pstack/skills/a/SKILL.md": "---\nname: a\ndescription: d\n---\nsee notes\n", "pstack/skills/a/old.md": "old name\n" };
	const move = (from: string, to: string): Group => ({ name: "m", moves: [{ from, to, reason: "r" }] });

	it("places a file at its new path, where rules see it", () => {
		const group: Group = { ...move("skills/a/old.md", "skills/a/new.md"), rules: [{ id: "m/r", reason: "r", files: "skills/a/new.md", pattern: "old", replacement: "new" }] };
		const { packageRoot, result } = sync(files, [group]);
		expect(fs.existsSync(path.join(packageRoot, "skills/a/old.md"))).toBe(false);
		expect(fs.readFileSync(path.join(packageRoot, "skills/a/new.md"), "utf8")).toBe("new name\n");
		expect(result.unusedRules).toEqual([]);
	});

	it("fails when the source is missing, the target is taken, or the reason is blank", () => {
		expect(() => sync(files, [move("skills/a/missing.md", "skills/a/new.md")])).toThrow(/matches no file/);
		expect(() => sync(files, [move("skills/a/old.md", "skills/a/SKILL.md")])).toThrow(/collides/);
		expect(() => sync(files, [{ name: "m", moves: [{ from: "skills/a/old.md", to: "skills/a/new.md", reason: " " }] }])).toThrow(SyncConfigError);
	});
});
