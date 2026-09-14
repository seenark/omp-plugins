import { describe, expect, it } from "bun:test";
import {
	appendCavemanSystemPrompt,
	filterCavemanSkill,
	filterCavemanSkillForLevel,
	readCavemanSkill,
	stripSkillFrontmatter,
} from "./instructions.ts";
import { CAVEMAN_ACTIVE_LEVELS, DEFAULT_SKILL_PATH } from "./types.ts";

describe("Caveman instructions", () => {
	it("filters the vendored canonical skill to one active level", async () => {
		const skill = await readCavemanSkill(DEFAULT_SKILL_PATH);
		for (const level of CAVEMAN_ACTIVE_LEVELS) {
			const filtered = filterCavemanSkill(skill, level);
			expect(filtered).toStartWith(`CAVEMAN MODE ACTIVE — level: ${level}`);
			expect(filtered).toContain(`**${level}**`);
		}
		expect(filterCavemanSkillForLevel(skill, "off")).toBeUndefined();
	});

	it("rejects malformed frontmatter and appends without replacing prior prompts", () => {
		expect(stripSkillFrontmatter("# no frontmatter")).toBeUndefined();
		expect(appendCavemanSystemPrompt(["base"], "caveman")).toEqual(["base", "caveman"]);
	});
});
