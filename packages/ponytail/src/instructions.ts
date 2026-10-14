import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_PONYTAIL_CONFIG, normalizeRuntimeMode, type PonytailMode } from "./types.ts";

/** Helper skills Upstream exposes as `/ponytail-<name>` commands. */
export const PONYTAIL_HELPER_SKILLS = [
	"ponytail-review",
	"ponytail-audit",
	"ponytail-debt",
	"ponytail-gain",
	"ponytail-help",
] as const;
export type PonytailHelperSkill = (typeof PONYTAIL_HELPER_SKILLS)[number];

const FRONTMATTER = /^---[\s\S]*?---\s*/;

export function stripSkillFrontmatter(body: string): string {
	return body.replace(FRONTMATTER, "");
}

/**
 * Upstream filterSkillBodyForMode: drop frontmatter, then keep only the intensity-table row and worked
 * example for the current mode. A bullet or row whose label is not a mode stays verbatim.
 */
export function filterPonytailSkillBody(body: string, mode: PonytailMode): string {
	const effectiveMode = normalizeRuntimeMode(mode) ?? DEFAULT_PONYTAIL_CONFIG.defaultMode;
	return stripSkillFrontmatter(body)
		.split(/\r?\n/)
		.filter(line => {
			const tableLabel = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
			if (tableLabel) {
				const labelMode = normalizeRuntimeMode(tableLabel[1]!.trim());
				if (labelMode) return labelMode === effectiveMode;
			}
			// A worked example is `- lite: "..."`; a bullet that merely starts with a mode word has no quote.
			const exampleLabel = line.match(/^-\s*([^:]+):\s*"/);
			if (exampleLabel) {
				const labelMode = normalizeRuntimeMode(exampleLabel[1]!.trim());
				if (labelMode) return labelMode === effectiveMode;
			}
			return true;
		})
		.join("\n");
}

/** Upstream getPonytailInstructions for a readable skill. `off` has no instructions. */
export function buildPonytailInstructions(mode: PonytailMode, skill: string): string | undefined {
	if (mode === "off") return undefined;
	if (mode === "review") return `PONYTAIL MODE ACTIVE — level: review. Behavior defined by /ponytail-review skill.`;
	return `PONYTAIL MODE ACTIVE — level: ${mode}\n\n${filterPonytailSkillBody(skill, mode)}`;
}

export function readPonytailSkill(skillDirectory: string, name: "ponytail" | PonytailHelperSkill = "ponytail"): Promise<string> {
	return readFile(path.join(skillDirectory, name, "SKILL.md"), "utf8");
}

/** The user message a helper command sends: same shape OMP builds for `/skill:<name>`, without a skill directory. */
export function buildHelperSkillPrompt(name: PonytailHelperSkill, skill: string, args: string): string {
	const userArgs = args.trim();
	return [
		`[IMPORTANT: User invoked the "${name}" skill; follow its instructions. Full skill below.]`,
		"",
		stripSkillFrontmatter(skill).trim(),
		"",
		"---",
		...(userArgs ? ["", `User: ${userArgs}`] : []),
	].join("\n");
}
