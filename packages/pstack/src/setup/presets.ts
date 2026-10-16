import { PANEL_SEATS } from "../roles.ts";
import type { ModelChoice } from "./catalog.ts";
import { modelKey } from "./rules.ts";

/** Model spec per role id; undefined leaves the role unset (a work role falls back, a seat is absent). */
export type Assignment = Record<string, string | undefined>;

export const PRESET_NAMES = ["claude-only", "claude-codex", "lean"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export const PRESET_DESCRIPTIONS: Record<PresetName, string> = {
	"claude-only": "Claude on every role and seat.",
	"claude-codex": "Claude for work roles, Codex as judge, seats alternating between the two.",
	lean: "Cheaper models for work roles and the judge; the panel still gets distinct seats.",
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

/** Distinct models for the seats: take one from each list in turn, preferred picks first. */
function seatPicks(lists: readonly (readonly ModelChoice[])[]): ModelChoice[] {
	const picked = new Map<string, ModelChoice>();
	for (let index = 0; picked.size < PANEL_SEATS.length && lists.some(list => index < list.length); index++) {
		for (const list of lists) {
			const choice = list[index];
			if (choice && picked.size < PANEL_SEATS.length) picked.set(modelKey(choice.spec), choice);
		}
	}
	return [...picked.values()];
}

function preferred(tiers: Tiers, order: readonly ("top" | "mid" | "cheap")[]): ModelChoice[] {
	return [...order.map(name => tiers[name]), ...tiers.ranked];
}

function assign(work: readonly [string, ModelChoice][], seats: readonly ModelChoice[]): Assignment {
	const assignment: Assignment = Object.fromEntries(work.map(([role, choice]) => [role, choice.spec]));
	PANEL_SEATS.forEach((seat, index) => {
		assignment[`pstack-panel-${seat}`] = seats[index]?.spec;
	});
	return assignment;
}

/** Fill every role from the served models; undefined when the registry cannot supply the preset's vendors. */
export function presetAssignment(name: PresetName, choices: readonly ModelChoice[]): Assignment | undefined {
	const claude = rank(choices.filter(choice => choice.vendor === CLAUDE));
	const codexPool = choices.filter(choice => choice.provider === CODEX_PROVIDER);
	const codex = rank(codexPool.length > 0 ? codexPool : choices.filter(choice => choice.vendor === CODEX_VENDOR));
	switch (name) {
		case "claude-only":
			if (!claude) return undefined;
			return assign(
				[
					["pstack-explore", claude.cheap],
					["pstack-build", claude.mid],
					["pstack-mechanical", claude.cheap],
					["pstack-design", claude.top],
					["pstack-judge", claude.top],
					["pstack-security", claude.top],
				],
				seatPicks([preferred(claude, ["top", "mid", "cheap"])]),
			);
		case "claude-codex":
			if (!claude || !codex) return undefined;
			return assign(
				[
					["pstack-explore", claude.cheap],
					["pstack-build", claude.mid],
					["pstack-mechanical", claude.cheap],
					["pstack-design", claude.top],
					["pstack-judge", codex.top],
					["pstack-security", claude.top],
				],
				seatPicks([preferred(claude, ["top", "mid", "cheap"]), preferred(codex, ["top", "mid", "cheap"])]),
			);
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
				seatPicks([preferred(pool, ["mid", "cheap", "top"])]),
			);
		}
	}
}
