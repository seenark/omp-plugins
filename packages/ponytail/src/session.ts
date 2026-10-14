import { isRecord } from "@codesook/omp-shared-display/config-store";
import {
	normalizePersistedMode,
	normalizeRuntimeMode,
	type PonytailMode,
	type PonytailRuntimeMode,
} from "./types.ts";

export const PONYTAIL_SESSION_ENTRY = "ponytail-mode";

/** Newest valid `ponytail-mode` entry wins (`data.mode`, the shape Upstream wrote); undefined when the branch has none. */
export function readPonytailSessionMode(entries: readonly unknown[]): PonytailMode | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== PONYTAIL_SESSION_ENTRY) continue;
		const mode = isRecord(entry.data) ? normalizePersistedMode(entry.data.mode) : null;
		if (mode) return mode;
	}
	return undefined;
}

/** Upstream isDeactivationCommand: the whole message is "stop ponytail" or "normal mode", ignoring case and trailing punctuation. */
export function isPonytailDeactivationCommand(text: string): boolean {
	const normalized = text.trim().toLowerCase().replace(/[.!?\s]+$/, "");
	return normalized === "stop ponytail" || normalized === "normal mode";
}

export type PonytailCommand =
	| { type: "status" }
	| { type: "set-mode"; mode: PonytailRuntimeMode }
	| { type: "set-default"; mode: PonytailRuntimeMode }
	| { type: "invalid" };

/** Upstream parsePonytailCommand. Bare `/ponytail` reports status when on, else turns the default mode on (`full` when the default is off). */
export function parsePonytailCommand(
	text: string,
	defaultMode: PonytailRuntimeMode,
	currentMode: PonytailMode,
): PonytailCommand {
	const [primary, secondary] = text.trim().toLowerCase().split(/\s+/);
	if (!primary) {
		if (currentMode !== "off") return { type: "status" };
		return { type: "set-mode", mode: defaultMode === "off" ? "full" : defaultMode };
	}
	if (primary === "status") return { type: "status" };
	if (primary === "default") {
		const mode = normalizeRuntimeMode(secondary);
		return mode ? { type: "set-default", mode } : { type: "invalid" };
	}
	const mode = normalizeRuntimeMode(primary);
	return mode ? { type: "set-mode", mode } : { type: "invalid" };
}
