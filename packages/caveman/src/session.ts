import { isCavemanLevel, isRecord, type CavemanConfig, type CavemanLevel } from "./types.ts";

export function resolveCavemanSessionLevel(entries: readonly unknown[], fallback: CavemanLevel): CavemanLevel {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== "caveman-level") continue;
		const data = entry.data;
		if (!isRecord(data) || !isCavemanLevel(data.level)) continue;
		return data.level;
	}
	return fallback;
}

export function resolveCavemanSessionLevelFromConfig(entries: readonly unknown[], config: CavemanConfig): CavemanLevel {
	return resolveCavemanSessionLevel(entries, config.defaultLevel);
}

/** Whole-message "stop caveman" / "normal mode", ignoring case and trailing punctuation (mirrors Ponytail upstream). */
export function isCavemanDeactivationCommand(text: string): boolean {
	const normalized = text.trim().toLowerCase().replace(/[.!?\s]+$/, "");
	return normalized === "stop caveman" || normalized === "normal mode";
}

