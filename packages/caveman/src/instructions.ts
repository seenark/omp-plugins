import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { CavemanActiveMode } from "./types.ts";

/** Strip YAML frontmatter from a vendored SKILL.md, rejecting malformed wrappers. */
export function stripSkillFrontmatter(text: string): string | undefined {
	const normalized = text.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
	const lines = normalized.split("\n");
	if (lines[0] !== "---") return undefined;
	const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
	if (closingIndex < 0) return undefined;
	const body = lines.slice(closingIndex + 1).join("\n").replace(/^\n+/, "");
	return body.trim().length > 0 ? body : undefined;
}

/** Read the vendored `<skillDirectory>/<mode>/SKILL.md` and return its body, or undefined when malformed. */
export async function readCavemanSkillBody(skillDirectory: string, mode: CavemanActiveMode): Promise<string | undefined> {
	return stripSkillFrontmatter(await readFile(path.join(skillDirectory, mode, "SKILL.md"), "utf8"));
}

export function appendCavemanSystemPrompt(systemPrompt: readonly string[], addition: string): string[] {
	return [...systemPrompt, addition];
}
