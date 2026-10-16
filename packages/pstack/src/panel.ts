import type { BeforeSubagentSpawnEvent, BeforeSubagentSpawnEventResult, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { PANEL_ROLES, findLaneAgent, type PanelRole, type PanelSeat } from "./roles.ts";
import { SINGLE_VENDOR_WARNING } from "./setup/rules.ts";

type ModelQuery = Pick<ExtensionContext["models"], "resolve" | "family">;

export interface SeatStatus {
	seat: PanelSeat;
	role: PanelRole;
	/** Resolved model `provider/id`; undefined when the seat role is unset. */
	model: string | undefined;
	/** Lineage token from the models API (every Claude release shares one); undefined when the seat is unset. */
	vendor: string | undefined;
}

/** Resolve each seat role through the models API. An unset role resolves to nothing. */
export function resolveSeats(models: ModelQuery): SeatStatus[] {
	return PANEL_ROLES.map(role => {
		const model = models.resolve(`@${role.id}`);
		return { seat: role.seat, role, model: model ? `${model.provider}/${model.id}` : undefined, vendor: model ? models.family(model) : undefined };
	});
}

/** Configured seats in seat order, capped at `maxPanelSize`. */
export function activeSeats(models: ModelQuery, maxPanelSize: number): SeatStatus[] {
	return resolveSeats(models)
		.filter(seat => seat.model !== undefined)
		.slice(0, maxPanelSize);
}

/** The single-vendor note when every seat that ran is one vendor, else undefined. A lone seat is single-vendor by definition. */
export function diversityNote(vendors: readonly string[]): string | undefined {
	return vendors.length > 0 && new Set(vendors).size === 1 ? SINGLE_VENDOR_WARNING : undefined;
}

export function seatOfAgent(agent: string | undefined): PanelRole | undefined {
	const lane = agent === undefined ? undefined : findLaneAgent(agent);
	return lane?.role.kind === "panel" ? lane.role : undefined;
}

/**
 * OMP fails a child whose single role alias is unset ("No model selected") instead of skipping it,
 * so pstack refuses the spawn up front. `before_subagent_spawn` fails open: it is not the only guard.
 */
export function guardSeatSpawn(event: BeforeSubagentSpawnEvent, ctx: ExtensionContext): BeforeSubagentSpawnEventResult | undefined {
	const role = seatOfAgent(event.agent);
	if (!role || ctx.models.resolve(`@${role.id}`)) return undefined;
	return {
		block: true,
		reason: `Panel seat ${role.seat.toUpperCase()} has no model: the model role ${role.id} is unset. Skip this seat and continue with the seats that have models. Do not retry it or substitute another agent.`,
	};
}
