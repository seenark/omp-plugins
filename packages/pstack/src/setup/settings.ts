import { MODEL_ROLES, PANEL_ROLES } from "../roles.ts";
import type { Assignment } from "./presets.ts";

/** The slice of OMP's in-process settings API that setup touches. */
export interface SetupSettings {
	modelRoles(): Record<string, string>;
	fallbackChains(): Record<string, string[]>;
	taskIsolation(): boolean;
	setModelRole(role: string, model: string | undefined): void;
	setFallbackChain(role: string, chain: string[] | undefined): void;
	setTaskIsolation(enabled: boolean): void;
	/** Persist queued writes, then re-read the stored config so the next read reflects disk. */
	commit(): Promise<void>;
}

export interface ConfigSnapshot {
	roles: Record<string, string>;
	chains: Record<string, string[]>;
	isolation: boolean;
}

export type SaveResult =
	| { ok: true; changed: boolean }
	| { ok: false; restored: boolean; reason: string };

const PSTACK_ROLE_IDS = new Set(MODEL_ROLES.map(role => role.id));
const SEAT_IDS = new Set(PANEL_ROLES.map(role => role.id));

export function snapshot(settings: SetupSettings): ConfigSnapshot {
	return {
		roles: { ...settings.modelRoles() },
		chains: Object.fromEntries(Object.entries(settings.fallbackChains()).map(([role, chain]) => [role, [...chain]])),
		isolation: settings.taskIsolation(),
	};
}

const canonical = (record: Record<string, unknown>): string => JSON.stringify(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)));

export function sameConfig(a: ConfigSnapshot, b: ConfigSnapshot): boolean {
	return a.isolation === b.isolation && canonical(a.roles) === canonical(b.roles) && canonical(a.chains) === canonical(b.chains);
}

/** The config setup wants: `before` with only pstack roles and seat chains replaced. A configured seat gets an empty chain so OMP never swaps its model silently. */
export function targetSnapshot(before: ConfigSnapshot, assignment: Assignment, isolation: boolean): ConfigSnapshot {
	const roles = { ...before.roles };
	const chains = { ...before.chains };
	for (const id of PSTACK_ROLE_IDS) {
		const model = assignment[id];
		if (model === undefined) delete roles[id];
		else roles[id] = model;
		if (SEAT_IDS.has(id)) {
			if (model === undefined) delete chains[id];
			else chains[id] = [];
		}
	}
	return { roles, chains, isolation };
}

export function readAssignment(settings: SetupSettings): Assignment {
	const roles = settings.modelRoles();
	return Object.fromEntries(MODEL_ROLES.map(role => [role.id, roles[role.id]]));
}

function applyDiff(settings: SetupSettings, from: ConfigSnapshot, to: ConfigSnapshot): void {
	for (const role of new Set([...Object.keys(from.roles), ...Object.keys(to.roles)])) {
		if (from.roles[role] !== to.roles[role]) settings.setModelRole(role, to.roles[role]);
	}
	for (const role of new Set([...Object.keys(from.chains), ...Object.keys(to.chains)])) {
		if (canonical({ chain: from.chains[role] }) !== canonical({ chain: to.chains[role] })) settings.setFallbackChain(role, to.chains[role]);
	}
	if (from.isolation !== to.isolation) settings.setTaskIsolation(to.isolation);
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Write `assignment` (and task isolation) through the settings API, read it back, and restore the
 * snapshot when the readback differs from what was written. Only pstack roles and seat chains change.
 */
export async function saveAssignment(settings: SetupSettings, assignment: Assignment, isolation: boolean): Promise<SaveResult> {
	const before = snapshot(settings);
	const target = targetSnapshot(before, assignment, isolation);
	if (sameConfig(before, target)) return { ok: true, changed: false };
	let reason: string;
	try {
		applyDiff(settings, before, target);
		await settings.commit();
		if (sameConfig(snapshot(settings), target)) return { ok: true, changed: true };
		reason = "the stored config differs from what setup wrote";
	} catch (error) {
		reason = message(error);
	}
	try {
		applyDiff(settings, snapshot(settings), before);
		await settings.commit();
		return { ok: false, restored: sameConfig(snapshot(settings), before), reason };
	} catch (error) {
		return { ok: false, restored: false, reason: `${reason}; restoring the previous config failed: ${message(error)}` };
	}
}
