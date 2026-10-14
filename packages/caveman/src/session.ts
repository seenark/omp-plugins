import { isCavemanMode, isRecord, type CavemanMode } from "./types.ts";

export function resolveCavemanSessionMode(entries: readonly unknown[], fallback: CavemanMode): CavemanMode {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== "caveman-mode") continue;
		const data = entry.data;
		if (!isRecord(data) || !isCavemanMode(data.mode)) continue;
		return data.mode;
	}
	return fallback;
}

/** Whole-message "stop caveman" / "normal mode", ignoring case and trailing punctuation (mirrors Ponytail upstream). */
export function isCavemanDeactivationCommand(text: string): boolean {
	const normalized = text.trim().toLowerCase().replace(/[.!?\s]+$/, "");
	return normalized === "stop caveman" || normalized === "normal mode";
}
