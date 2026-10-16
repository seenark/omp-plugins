import { describe, expect, it } from "bun:test";
import { activeSeats, diversityNote, resolveSeats } from "./panel.ts";
import { SINGLE_VENDOR_WARNING } from "./setup/rules.ts";

const models = (configured: string[]) => ({
	resolve: (spec: string) => (configured.includes(spec) ? ({ provider: "p", id: spec.slice(1) } as never) : undefined),
	family: () => "fam",
});

describe("panel seats", () => {
	it("resolves all five seats and leaves unset ones without a model", () => {
		const seats = resolveSeats(models(["@pstack-panel-a", "@pstack-panel-d"]));
		expect(seats.map(seat => [seat.seat, seat.model, seat.vendor])).toEqual([
			["a", "p/pstack-panel-a", "fam"],
			["b", undefined, undefined],
			["c", undefined, undefined],
			["d", "p/pstack-panel-d", "fam"],
			["e", undefined, undefined],
		]);
	});

	it("keeps only configured seats, in seat order", () => {
		const seats = activeSeats(models(["@pstack-panel-e", "@pstack-panel-b"]), 5);
		expect(seats.map(seat => seat.seat)).toEqual(["b", "e"]);
	});

	it("caps the panel at the maximum panel size", () => {
		const configured = ["a", "b", "c", "d"].map(seat => `@pstack-panel-${seat}`);
		expect(activeSeats(models(configured), 2).map(seat => seat.seat)).toEqual(["a", "b"]);
		expect(activeSeats(models(configured), 5).map(seat => seat.seat)).toEqual(["a", "b", "c", "d"]);
	});

	it("has no seats when none is configured", () => {
		expect(activeSeats(models([]), 5)).toEqual([]);
	});
});

describe("diversityNote", () => {
	it("states single vendor for one vendor, including a lone seat, and stays silent for a mix or an empty panel", () => {
		expect(diversityNote(["claude", "claude"])).toBe(SINGLE_VENDOR_WARNING);
		expect(diversityNote(["claude"])).toBe(SINGLE_VENDOR_WARNING);
		expect(diversityNote(["claude", "gpt"])).toBeUndefined();
		expect(diversityNote([])).toBeUndefined();
	});
});
