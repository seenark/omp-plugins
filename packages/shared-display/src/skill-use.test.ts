import { describe, expect, it } from "bun:test";
import { SKILL_USE_EVENT, parseSkillUseEvent } from "./skill-use.ts";

describe("Skill Use event contract", () => {
	it("keeps the versioned channel name", () => {
		expect(SKILL_USE_EVENT).toBe("codesook/skill-use/v1");
	});

	it("accepts a user skill use and drops unknown fields", () => {
		expect(parseSkillUseEvent({ name: "ponytail-review", path: "/skills/ponytail-review/SKILL.md", source: "user", extra: 1 })).toEqual({
			name: "ponytail-review",
			path: "/skills/ponytail-review/SKILL.md",
			source: "user",
		});
	});

	it("rejects other sources, empty names or paths, and non-objects", () => {
		expect(parseSkillUseEvent({ name: "a", path: "/a", source: "agent" })).toBeUndefined();
		expect(parseSkillUseEvent({ name: "", path: "/a", source: "user" })).toBeUndefined();
		expect(parseSkillUseEvent({ name: "a", path: "", source: "user" })).toBeUndefined();
		expect(parseSkillUseEvent({ name: "a", source: "user" })).toBeUndefined();
		expect(parseSkillUseEvent(null)).toBeUndefined();
		expect(parseSkillUseEvent("a")).toBeUndefined();
	});
});
