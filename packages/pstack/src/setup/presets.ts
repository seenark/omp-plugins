import { MODEL_ROLES, PANEL_SEATS, seatRoleId } from "../roles.ts";
import type { ModelChoice } from "./catalog.ts";
import { modelKey } from "./rules.ts";

/** Model spec per role id; undefined leaves the role unset (a work role falls back, a seat is absent). */
export type Assignment = Record<string, string | undefined>;

export const PRESET_NAMES = ["claude-only", "claude-codex", "lean"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export const PRESET_DESCRIPTIONS: Record<PresetName, string> = {
	"claude-only": "Claude on every work role and a three-model Claude panel (seats A to C).",
	"claude-codex": "claude-only plus one Codex seat, with Codex as judge. On roles you already have, only adds the seat and moves the judge.",
	lean: "Cheaper models for work roles and the judge; a two-seat panel (A and B).",
};

const CLAUDE = "anthropic";
const CODEX_PROVIDER = "openai-codex";
const CODEX_VENDOR = "openai";

// shortcut: tiers come from model-id keywords, since OMP exposes no capability tier; adjust the roles by hand when a vendor names models otherwise.
const TOP = /opus|\bpro\b|max|ultra/i;
const CHEAP = /haiku|mini|nano|flash|lite|small|spark/i;

/** A pinned snapshot such as `claude-opus-4-20250514`: numeric id order would rank it above every newer undated release, and registries keep retired ones. */
const isSnapshot = (choice: ModelChoice): boolean => /-\d{8}$/.test(choice.id);

function tier(choice: ModelChoice): number {
	if (TOP.test(choice.id)) return 0;
	return CHEAP.test(choice.id) ? 2 : 1;
}

interface Tiers {
	top: ModelChoice;
	mid: ModelChoice;
	cheap: ModelChoice;
	/** Strongest first, newest first within a tier, pinned snapshots after releases, one entry per model. */
	ranked: ModelChoice[];
}

function rank(pool: readonly ModelChoice[]): Tiers | undefined {
	const ranked = pool
		.filter((choice, index) => pool.findIndex(other => modelKey(other.spec) === modelKey(choice.spec)) === index)
		.sort((a, b) => tier(a) - tier(b) || Number(isSnapshot(a)) - Number(isSnapshot(b)) || b.id.localeCompare(a.id, undefined, { numeric: true }));
	const first = ranked[0];
	if (!first) return undefined;
	return {
		top: first,
		mid: ranked.find(choice => tier(choice) === 1) ?? first,
		cheap: ranked.find(choice => tier(choice) === 2) ?? ranked[ranked.length - 1]!,
		ranked,
	};
}

type TierName = "top" | "mid" | "cheap";

/** The first `count` distinct models: the preferred tiers in order, then the rest of the ranking. */
function seatPicks(tiers: Tiers, order: readonly TierName[], count: number): ModelChoice[] {
	const picked = new Map<string, ModelChoice>();
	for (const choice of [...order.map(name => tiers[name]), ...tiers.ranked]) {
		if (!picked.has(modelKey(choice.spec))) picked.set(modelKey(choice.spec), choice);
	}
	return [...picked.values()].slice(0, count);
}

function assign(work: readonly [string, ModelChoice][], seats: readonly ModelChoice[]): Assignment {
	const assignment: Assignment = Object.fromEntries(work.map(([role, choice]) => [role, choice.spec]));
	PANEL_SEATS.forEach((seat, index) => {
		assignment[seatRoleId(seat)] = seats[index]?.spec;
	});
	return assignment;
}

const CLAUDE_SEATS = 3;
const LEAN_SEATS = 2;

/**
 * The roles a preset sets, from the served models; undefined when the registry cannot supply the preset's vendors.
 * Seats the preset does not fill stay unset. `claude-codex` on roles the user already has is a delta on `current`:
 * one Codex seat in the first free seat (none when a seat already runs Codex) and the judge moved to Codex.
 */
export function presetAssignment(name: PresetName, choices: readonly ModelChoice[], current: Assignment = {}): Assignment | undefined {
	const claude = rank(choices.filter(choice => choice.vendor === CLAUDE));
	const codexPool = choices.filter(choice => choice.provider === CODEX_PROVIDER);
	const codexChoices = codexPool.length > 0 ? codexPool : choices.filter(choice => choice.vendor === CODEX_VENDOR);
	const codex = rank(codexChoices);
	switch (name) {
		case "claude-only":
			if (!claude) return undefined;
			return assign(claudeWork(claude, claude.top), seatPicks(claude, ["top", "mid", "cheap"], CLAUDE_SEATS));
		case "claude-codex": {
			if (!claude || !codex) return undefined;
			if (MODEL_ROLES.some(role => current[role.id] !== undefined)) {
				const seatIds = PANEL_SEATS.map(seatRoleId);
				const codexKeys = new Set(codexChoices.map(choice => modelKey(choice.spec)));
				const hasCodexSeat = seatIds.some(id => current[id] !== undefined && codexKeys.has(modelKey(current[id]!)));
				const freeSeat = seatIds.find(id => current[id] === undefined) ?? seatIds[seatIds.length - 1]!;
				return { ...current, "pstack-judge": codex.top.spec, ...(hasCodexSeat ? {} : { [freeSeat]: codex.top.spec }) };
			}
			return assign(claudeWork(claude, codex.top), [...seatPicks(claude, ["top", "mid", "cheap"], CLAUDE_SEATS), codex.top]);
		}
		case "lean": {
			const pool = claude ?? rank(choices);
			if (!pool) return undefined;
			return assign(
				[
					["pstack-explore", pool.cheap],
					["pstack-build", pool.mid],
					["pstack-mechanical", pool.cheap],
					["pstack-design", pool.mid],
					["pstack-judge", pool.mid],
					["pstack-security", pool.mid],
				],
				seatPicks(pool, ["mid", "cheap", "top"], LEAN_SEATS),
			);
		}
	}
}

function claudeWork(claude: Tiers, judge: ModelChoice): [string, ModelChoice][] {
	return [
		["pstack-explore", claude.cheap],
		["pstack-build", claude.mid],
		["pstack-mechanical", claude.cheap],
		["pstack-design", claude.top],
		["pstack-judge", judge],
		["pstack-security", claude.top],
	];
}
