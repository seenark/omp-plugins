import { isRecord } from "./config-store.ts";

/** EventBus channel on which a feature reports a skill it sent to the model as plain text. */
export const SKILL_USE_EVENT = "codesook/skill-use/v1";

export type SkillUseEvent = { name: string; path: string; source: "user" };

export function parseSkillUseEvent(data: unknown): SkillUseEvent | undefined {
	if (!isRecord(data) || data.source !== "user") return undefined;
	if (typeof data.name !== "string" || data.name === "" || typeof data.path !== "string" || data.path === "") return undefined;
	return { name: data.name, path: data.path, source: "user" };
}
