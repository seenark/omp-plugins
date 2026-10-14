import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { appendCavemanSystemPrompt, readCavemanSkillBody, stripSkillFrontmatter } from "./instructions.ts";
import { CAVEMAN_ACTIVE_MODES, DEFAULT_SKILL_DIRECTORY } from "./types.ts";

describe("Caveman instructions", () => {
	it("injects exactly the vendored skill body of each active mode", async () => {
		const bodies = new Set<string>();
		for (const mode of CAVEMAN_ACTIVE_MODES) {
			const file = await readFile(path.join(DEFAULT_SKILL_DIRECTORY, mode, "SKILL.md"), "utf8");
			const body = await readCavemanSkillBody(DEFAULT_SKILL_DIRECTORY, mode);
			expect(file.endsWith(body!)).toBe(true);
			expect(file.slice(0, file.length - body!.length)).toMatch(/^---\n[\s\S]*\n---\n\n?$/);
			expect(body).toStartWith(`# ${mode}\n`);
			bodies.add(body!);
		}
		expect(bodies.size).toBe(CAVEMAN_ACTIVE_MODES.length);
	});

	it("rejects malformed frontmatter and appends without replacing prior prompts", () => {
		expect(stripSkillFrontmatter("# no frontmatter")).toBeUndefined();
		expect(stripSkillFrontmatter("---\nname: x\n---\n")).toBeUndefined();
		expect(appendCavemanSystemPrompt(["base"], "caveman")).toEqual(["base", "caveman"]);
	});
});
