import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runSync } from "../engine.ts";
import { loadTree } from "../source.ts";
import type { Group, Rule } from "../types.ts";
import { SKILL_COMMANDS, sessions } from "./sessions.ts";

const temporary: string[] = [];
afterEach(() => {
	for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function scratch(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-sessions-test-"));
	temporary.push(directory);
	return directory;
}

/** Syncs Upstream files (package-relative paths, as they land in the package) through `group` and returns the output files. */
function syncFiles(files: Record<string, string>, group: Group) {
	const root = scratch();
	const all: Record<string, string> = {
		"pstack/LICENSE": "license\n",
		"cursor-team-kit/LICENSE": "license\n",
		"pstack/plugin.json": '{"version":"9.9.9"}',
	};
	for (const [file, content] of Object.entries(files)) all[`pstack/${file}`] = content;
	for (const [file, content] of Object.entries(all)) {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), content);
	}
	const packageRoot = scratch();
	const result = runSync({ packageRoot, upstream: loadTree(root), repository: "https://example.test/repo", revision: "rev-1", groups: [group], write: true });
	return { result, read: (file: string) => fs.readFileSync(path.join(packageRoot, file), "utf8") };
}

function withFrontmatter(file: string, body: string): string {
	return /(?:SKILL\.md|^agents\/[^/]+\.md)$/.test(file) ? `---\nname: x\ndescription: "x"\n---\n\n${body}` : body;
}

/** Input for rules whose pattern is a regex; string-pattern rules use their own pattern text. */
const REGEX_INPUT: Record<string, string> = {
	"sessions/no-cross-project-glob": "Don't glob across `~/.cursor/projects/*/`.",
	"sessions/deslop-from-team-kit": "(the `deslop` skill from the `cursor-team-kit` plugin (`/deslop`))",
	"sessions/skill-slash-form": "Run /how, then /principle-<name> and /verify-<app>.",
};

/** A concrete file for rules scoped by a glob or by the default Markdown scope. */
const CONCRETE_FILE: Record<string, string> = {
	"sessions/reflect-skill-use": "skills/reflect/references/judgment-reviewer.md",
	"sessions/no-cross-project-glob": "skills/recall/SKILL.md",
	"sessions/user-skill-directory": "skills/automate-me/SKILL.md",
	"sessions/project-skill-directory": "skills/automate-me/SKILL.md",
	"sessions/driver-such-as": "skills/poteto-mode/playbooks/shipping.md",
	"sessions/deslop-from-team-kit": "skills/poteto-mode/SKILL.md",
	"sessions/skill-slash-form": "skills/poteto-help/SKILL.md",
};

function fixtureFor(rule: Rule): { file: string; input: string } {
	const file = CONCRETE_FILE[rule.id] ?? rule.files;
	if (file === undefined || file.includes("*")) throw new Error(`rule ${rule.id} needs a concrete fixture file`);
	const input = typeof rule.pattern === "string" ? rule.pattern : REGEX_INPUT[rule.id];
	if (input === undefined) throw new Error(`rule ${rule.id} needs a regex fixture`);
	return { file, input };
}

describe("sessions group", () => {
	for (const rule of sessions.rules ?? []) {
		it(`${rule.id} applies to its Upstream text and changes it`, () => {
			const { file, input } = fixtureFor(rule);
			const { read, result } = syncFiles({ [file]: withFrontmatter(file, `${input}\n`) }, { ...sessions, rules: [rule] });
			expect(result.unusedRules).toEqual([]);
			expect(read(file).endsWith(`${input}\n`)).toBe(false);
		});
	}

	it("applies every shipped rule together without shadowing", () => {
		const merged: Record<string, string> = {};
		for (const rule of sessions.rules ?? []) {
			const { file, input } = fixtureFor(rule);
			merged[file] = `${merged[file] ?? ""}${input}\n\n`;
		}
		const { result } = syncFiles(
			Object.fromEntries(Object.entries(merged).map(([file, body]) => [file, withFrontmatter(file, body)])),
			sessions,
		);
		expect(result.unusedRules).toEqual([]);
		expect(result.findings.filter(finding => finding.category === "sessions")).toEqual([]);
	});

	it("points history, skill and goal references at OMP", () => {
		const { read } = syncFiles(
			{
				"skills/recall/SKILL.md": withFrontmatter(
					"skills/recall/SKILL.md",
					"Transcripts live at `~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl`, where `<slug>` is the workspace path with the leading slash dropped and each \"/\" turned into \"-\" (so `/Users/you/proj` becomes `Users-you-proj`). Every line is one chat message.\n",
				),
				"agents/poteto-agent.md": withFrontmatter(
					"agents/poteto-agent.md",
					"With no path, before any other work, search `~/.cursor/plugins/` for a file whose path ends in `skills/poteto-mode/SKILL.md`. If more than one file matches, use the copy whose `.cursor-plugin/plugin.json` has the highest `version`.\n",
				),
				"skills/poteto-mode/playbooks/bug-fix.md": "Drive a long or stubborn hunt with Cursor's `/loop` command.\n",
			},
			sessions,
		);
		expect(read("skills/recall/SKILL.md")).toContain("~/.omp/agent/sessions/");
		expect(read("skills/recall/SKILL.md")).not.toContain(".cursor");
		expect(read("agents/poteto-agent.md")).toContain("skill://poteto-mode");
		expect(read("agents/poteto-agent.md")).not.toContain(".cursor");
		expect(read("skills/poteto-mode/playbooks/bug-fix.md")).toContain("/goal set");
	});

	it("rewrites bare skill slash commands to /skill:<name>", () => {
		const { read } = syncFiles(
			{ "skills/a/SKILL.md": withFrontmatter("skills/a/SKILL.md", "Use /how and `/poteto-mode`, `/pstack-tdd`, /principle-<name>, /verify-<app>. Start /poteto. Run /pstack setup.\n") },
			sessions,
		);
		const body = read("skills/a/SKILL.md");
		expect(body).toContain("/skill:how");
		expect(body).toContain("`/skill:poteto-mode`");
		expect(body).toContain("`/skill:pstack-tdd`");
		expect(body).toContain("/skill:principle-<name>");
		expect(body).toContain("/skill:verify-<app>");
		expect(body).toContain("Start /poteto.");
		expect(body).toContain("Run /pstack setup.");
	});

	it("leaves paths, URLs and non-pstack slash commands alone", () => {
		const text = "See skills/how/SKILL.md, ../how/SKILL.md, https://example.test/why, /tmp/swarm-1/, ~/how and /loop.\n";
		const { read } = syncFiles({ "skills/a/SKILL.md": withFrontmatter("skills/a/SKILL.md", text) }, sessions);
		expect(read("skills/a/SKILL.md")).toContain(text.trim());
	});

	it("names every skill pstack ships", () => {
		const skillsDirectory = path.join(import.meta.dir, "../../../skills");
		const shipped = fs.readdirSync(skillsDirectory).filter(name => !name.startsWith("principle-"));
		expect([...SKILL_COMMANDS].sort()).toEqual(shipped.sort());
	});
});
