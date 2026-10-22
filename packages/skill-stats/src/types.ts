export type SkillUseSource = "user" | "agent" | "subagent";
export const SKILL_USE_SOURCES: readonly SkillUseSource[] = ["user", "agent", "subagent"];

/** One recorded use. `path` is the SKILL.md that was actually loaded. */
export type SkillUse = { at: string; name: string; path: string; source: SkillUseSource; session: string };

export type StoreMeta = {
	recordingStartedAt: string;
	importedAt?: string;
	resetAll?: string;
	resetBySkill: Record<string, string>;
};

export type Scope = { kind: "global" } | { kind: "project"; root: string };
export type Origin = "npx-skills" | "plugin" | "managed" | "home" | "project";

export type SkillInfo = {
	name: string;
	path: string;
	scope: Scope;
	origin: Origin;
	/** Epoch ms: `npx skills` lock `installedAt`, else SKILL.md mtime. */
	installedAt: number | undefined;
};

export function isSkillUse(value: unknown): value is SkillUse {
	if (typeof value !== "object" || value === null) return false;
	const use = value as Record<string, unknown>;
	return (
		typeof use.at === "string" &&
		Number.isFinite(Date.parse(use.at)) &&
		typeof use.name === "string" &&
		typeof use.path === "string" &&
		typeof use.session === "string" &&
		(SKILL_USE_SOURCES as readonly unknown[]).includes(use.source)
	);
}
