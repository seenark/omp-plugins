import type { BeforeSubagentSpawnEvent, BeforeSubagentSpawnEventResult, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { PANEL_ROLES, findLaneAgent, type PanelRole, type PanelSeat } from "./roles.ts";

type ModelQuery = Pick<ExtensionContext["models"], "resolve">;

export interface SeatStatus {
	seat: PanelSeat;
	role: PanelRole;
	/** Resolved model `provider/id`; undefined when the seat role is unset. */
	model: string | undefined;
}

/** Resolve each seat role through the models API. An unset role resolves to nothing. */
export function resolveSeats(models: ModelQuery): SeatStatus[] {
	return PANEL_ROLES.map(role => {
		const model = models.resolve(`@${role.id}`);
		return { seat: role.seat, role, model: model ? `${model.provider}/${model.id}` : undefined };
	});
}

/** Configured seats in seat order, capped at `maxPanelSize`. */
export function activeSeats(models: ModelQuery, maxPanelSize: number): SeatStatus[] {
	return resolveSeats(models)
		.filter(seat => seat.model !== undefined)
		.slice(0, maxPanelSize);
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
