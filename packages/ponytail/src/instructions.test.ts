import { describe, expect, it } from "bun:test";
import { buildHelperSkillPrompt, buildPonytailInstructions, filterPonytailSkillBody, stripSkillFrontmatter } from "./instructions.ts";

const SKILL = [
	"---",
	"name: ponytail",
	"---",
	"",
	"# Ponytail",
	"",
	"- Full: a rule that only starts with a mode word, kept everywhere.",
	'- lite: "lite example"',
	'- full: "full example"',
	"",
	"| Level | Behavior |",
	"|-------|----------|",
	"| **lite** | lite row |",
	"| **full** | full row |",
	"| **ultra** | ultra row |",
	"| **Other** | not a mode, kept |",
].join("\n");

describe("Ponytail instructions", () => {
	it("keeps only the current mode's table row and quoted example, as Upstream filters", () => {
		const filtered = filterPonytailSkillBody(SKILL, "lite");
		expect(filtered).toContain("| **lite** | lite row |");
		expect(filtered).toContain('- lite: "lite example"');
		expect(filtered).not.toContain("full row");
		expect(filtered).not.toContain("ultra row");
		expect(filtered).not.toContain('- full: "full example"');
		expect(filtered).toContain("- Full: a rule that only starts with a mode word, kept everywhere.");
		expect(filtered).toContain("| **Other** | not a mode, kept |");
		expect(filtered).toStartWith("# Ponytail");
	});

	it("prefixes each runtime mode, fixes the review line, and sends nothing for off", () => {
		expect(buildPonytailInstructions("ultra", SKILL)).toStartWith("PONYTAIL MODE ACTIVE — level: ultra\n\n# Ponytail");
		expect(buildPonytailInstructions("review", "")).toBe(
			"PONYTAIL MODE ACTIVE — level: review. Behavior defined by /ponytail-review skill.",
		);
		expect(buildPonytailInstructions("off", SKILL)).toBeUndefined();
	});

	it("strips frontmatter and normalizes CRLF like Upstream", () => {
		expect(stripSkillFrontmatter("---\nname: x\n---\n\nBody")).toBe("Body");
		expect(filterPonytailSkillBody("---\r\nname: x\r\n---\r\nA\r\nB", "full")).toBe("A\nB");
	});

	it("builds the helper prompt with the skill body and optional user text", () => {
		const prompt = buildHelperSkillPrompt("ponytail-gain", "---\nname: g\n---\n\nBody\n", "");
		expect(prompt).toBe('[IMPORTANT: User invoked the "ponytail-gain" skill; follow its instructions. Full skill below.]\n\nBody\n\n---');
		expect(buildHelperSkillPrompt("ponytail-gain", "Body", "x y")).toEndWith("\n\n---\n\nUser: x y");
	});
});
