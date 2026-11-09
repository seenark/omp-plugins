import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { PANEL_SKILLS } from "./activation.ts";
import { LANE_AGENTS, MODEL_ROLES, PANEL_SEATS } from "./roles.ts";
import { panel } from "./sync/rules/panel.ts";

const SKILLS = path.resolve(import.meta.dir, "..", "skills");
const read = (relative: string) => fs.readFileSync(path.join(SKILLS, relative), "utf8");
const PANEL_FILES = [...PANEL_SKILLS.map(skill => `${skill}/SKILL.md`), "poteto-mode/references/panel-verdicts.md", "poteto-mode/references/provider-dispatch.md"];

/** Every `pstack-...` agent a skill names, with `<seat>` expanded to each seat. */
function agentsNamedIn(text: string): string[] {
	const names = new Set<string>();
	for (const match of text.matchAll(/`(pstack-[a-z0-9<>-]+)`/g)) {
		const name = match[1]!;
		if (name.includes("<seat>")) for (const seat of PANEL_SEATS) names.add(name.replace("<seat>", seat));
		else names.add(name);
	}
	return [...names];
}

describe("panel skills dispatch the role table's agents", () => {
	const known = new Set(LANE_AGENTS.map(agent => agent.name));
	const roles = new Set(MODEL_ROLES.map(role => role.id));

	it("name only agents that exist", () => {
		for (const file of PANEL_FILES) {
			for (const name of agentsNamedIn(read(file))) expect(known.has(name) || roles.has(name)).toBe(true);
		}
	});

	it("interrogate dispatches a builder per seat and no critic, arena a builder range and a critic for the judge", () => {
		const interrogate = agentsNamedIn(read("interrogate/SKILL.md"));
		const arena = agentsNamedIn(read("arena/SKILL.md"));
		for (const seat of PANEL_SEATS) expect(interrogate).toContain(`pstack-panel-${seat}-builder`);
		expect(interrogate.some(name => name.endsWith("-critic"))).toBe(false);
		// Arena names the range once: `pstack-panel-a-builder` through `pstack-panel-e-builder`.
		expect(arena).toEqual(expect.arrayContaining(["pstack-panel-a-builder", "pstack-panel-e-builder"]));
		for (const seat of PANEL_SEATS) expect(arena).toContain(`pstack-panel-${seat}-critic`);
	});

	it("runs no judge lane in interrogate or arena, and synthesizes with the judge lane elsewhere", () => {
		expect(agentsNamedIn(read("interrogate/SKILL.md"))).not.toContain("pstack-judge");
		expect(agentsNamedIn(read("arena/SKILL.md"))).not.toContain("pstack-judge");
		expect(agentsNamedIn(read("poteto-mode/references/panel-verdicts.md"))).toContain("pstack-judge");
	});

	it("interrogate stops without a seat and never applies fixes", () => {
		const text = read("interrogate/SKILL.md");
		expect(text).toContain("/pstack setup");
		expect(text).toContain("Do not apply fixes");
	});
});

describe("fork registry", () => {
	it("records every changed panel skill and the new reference", () => {
		const forked = new Set((panel.forks ?? []).map(fork => fork.path));
		for (const skill of PANEL_SKILLS) expect(forked.has(`skills/${skill}/SKILL.md`)).toBe(true);
		expect(forked.has("skills/poteto-mode/references/panel-verdicts.md")).toBe(true);
		for (const fork of panel.forks ?? []) expect(fs.existsSync(path.join(SKILLS, "..", fork.path))).toBe(true);
	});
});
