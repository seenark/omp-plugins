import type { SkillUseSource } from "./types.ts";

const SKILL_URI = /skill:\/\/([^\s/;,:"'`()<>[\]{}?#\\|&]+)/gu;

/** Every `skill://<name>` occurrence, sub-file reads and several listed paths included. */
export function skillNamesIn(text: string): string[] {
	return [...text.matchAll(SKILL_URI)].map(match => match[1]!);
}

/** Skill names a tool call loads: read paths and bash commands. Other tools never count. */
export function skillNamesInToolCall(toolName: string, input: unknown): string[] {
	if (typeof input !== "object" || input === null) return [];
	const text = toolName === "read" ? ("path" in input ? input.path : undefined) : toolName === "bash" ? ("command" in input ? input.command : undefined) : undefined;
	return typeof text === "string" ? skillNamesIn(text) : [];
}

/** Only an explicit user attribution is a user use; anything else is the agent, or the subagent that autoloaded it. */
export function skillPromptSource(attribution: unknown, inSubagent: boolean): SkillUseSource {
	if (attribution === "user") return "user";
	return inSubagent ? "subagent" : "agent";
}

export function toolCallSource(inSubagent: boolean): SkillUseSource {
	return inSubagent ? "subagent" : "agent";
}
