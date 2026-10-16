import { PANEL_SEATS, seatRoleId, type PanelSeat } from "./roles.ts";

const THINKING_SUFFIX = /:(off|minimal|low|medium|high|xhigh|max)$/i;

/** Identity of a model across providers and thinking suffixes: two seats on one key are the same model. */
export function modelKey(spec: string): string {
	const id = spec.replace(THINKING_SUFFIX, "");
	return (id.includes("/") ? id.slice(id.indexOf("/") + 1) : id).toLowerCase();
}

export interface SeatModel {
	seat: PanelSeat;
	/** Undefined when the seat is unset, so absent. */
	model: string | undefined;
}

export interface PanelCheck {
	errors: string[];
	warnings: string[];
}

export const SINGLE_VENDOR_WARNING = "diversity reduced: single vendor";

/** Panel rules shared by setup and doctor: no two seats on one model; a single-vendor panel is flagged. */
export function checkPanel(seats: readonly SeatModel[], vendorOf: (spec: string) => string): PanelCheck {
	const configured = seats.filter((seat): seat is SeatModel & { model: string } => seat.model !== undefined);
	const bySeatKey = new Map<string, PanelSeat[]>();
	for (const { seat, model } of configured) {
		const key = modelKey(model);
		bySeatKey.set(key, [...(bySeatKey.get(key) ?? []), seat]);
	}
	const errors: string[] = [];
	for (const [key, group] of bySeatKey) {
		if (group.length < 2) continue;
		const model = configured.find(seat => modelKey(seat.model) === key)!.model;
		errors.push(`Panel seats ${group.map(seat => seat.toUpperCase()).join(", ")} share ${model}. Give each seat a different model.`);
	}
	const vendors = new Set(configured.map(seat => vendorOf(seat.model)));
	const warnings = configured.length > 0 && vendors.size === 1 ? [`Panel is single-vendor (${[...vendors][0]}): ${SINGLE_VENDOR_WARNING}.`] : [];
	return { errors, warnings };
}

export function seatModels(assignment: Readonly<Record<string, string | undefined>>): SeatModel[] {
	return PANEL_SEATS.map(seat => ({ seat, model: assignment[seatRoleId(seat)] }));
}
