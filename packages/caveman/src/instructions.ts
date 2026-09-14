import { readFile } from "node:fs/promises";
import {
	CAVEMAN_ACTIVE_LEVELS,
	isCavemanActiveLevel,
	type CavemanActiveLevel,
	type CavemanLevel,
} from "./types.ts";

const LEVEL_PATTERN = CAVEMAN_ACTIVE_LEVELS.join("|");
const TABLE_LEVEL_RE = new RegExp(`^\\|\\s*\\*\\*(${LEVEL_PATTERN})\\*\\*\\s*\\|`);
const EXAMPLE_LEVEL_RE = new RegExp(`^-\\s+(${LEVEL_PATTERN}):\\s`);

export const CAVEMAN_ACTIVATION_PREFIX = "CAVEMAN MODE ACTIVE — level:";

function normalizeNewlines(text: string): string {
	return text.replace(/\r\n?/g, "\n");
}

/** Strip YAML frontmatter from a vendored SKILL.md, rejecting malformed wrappers. */
export function stripSkillFrontmatter(text: string): string | undefined {
	const normalized = normalizeNewlines(text).replace(/^\uFEFF/, "");
	const lines = normalized.split("\n");
	if (lines[0] !== "---") return undefined;
	const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
	if (closingIndex < 0) return undefined;
	const body = lines.slice(closingIndex + 1).join("\n").replace(/^\n+/, "");
	return body.trim().length > 0 ? body : undefined;
}

/**
 * Select one canonical intensity row and its matching examples while retaining
 * every shared rule. Returns undefined when the vendored skill is malformed.
 */
export function filterCavemanSkill(text: string, level: CavemanActiveLevel): string | undefined {
	if (!isCavemanActiveLevel(level)) return undefined;
	const body = stripSkillFrontmatter(text);
	if (!body) return undefined;
	const lines = body.split("\n");
	const intensityHeading = lines.findIndex(line => /^##\s+Intensity\s*$/.test(line));
	if (intensityHeading < 0) return undefined;
	const intensityEnd = lines.findIndex((line, index) => index > intensityHeading && /^##\s+/.test(line));
	const intensityLimit = intensityEnd < 0 ? lines.length : intensityEnd;
	const selectedTableRow = lines
		.slice(intensityHeading, intensityLimit)
		.some(line => TABLE_LEVEL_RE.test(line) && line.includes(`**${level}**`));
	const selectedExampleRow = lines.some(line => {
		const match = line.match(EXAMPLE_LEVEL_RE);
		return match?.[1] === level;
	});
	if (!selectedTableRow || !selectedExampleRow) return undefined;

	const filtered: string[] = [];
	for (const line of lines) {
		const tableMatch = line.match(TABLE_LEVEL_RE);
		if (tableMatch && tableMatch[1] !== level) continue;
		const exampleMatch = line.match(EXAMPLE_LEVEL_RE);
		if (exampleMatch && exampleMatch[1] !== level) continue;
		filtered.push(line === "Default: **full**." ? `Current level: **${level}**.` : line);
	}
	while (filtered.length > 0 && filtered[filtered.length - 1] === "") filtered.pop();
	return `CAVEMAN MODE ACTIVE — level: ${level}\n\n${filtered.join("\n")}`;
}

export async function readCavemanSkill(skillPath: string): Promise<string> {
	return readFile(skillPath, "utf8");
}

export function appendCavemanSystemPrompt(systemPrompt: readonly string[], addition: string): string[] {
	return [...systemPrompt, addition];
}

export function filterCavemanSkillForLevel(text: string, level: CavemanLevel): string | undefined {
	return level === "off" ? undefined : filterCavemanSkill(text, level);
}
