import { describe, expect, it } from "bun:test";
import { activeSeats, resolveSeats } from "./panel.ts";

const models = (configured: string[]) => ({
	resolve: (spec: string) => (configured.includes(spec) ? ({ provider: "p", id: spec.slice(1) } as never) : undefined),
});

describe("panel seats", () => {
	it("resolves all five seats and leaves unset ones without a model", () => {
		const seats = resolveSeats(models(["@pstack-panel-a", "@pstack-panel-d"]));
		expect(seats.map(seat => [seat.seat, seat.model])).toEqual([
			["a", "p/pstack-panel-a"],
			["b", undefined],
			["c", undefined],
			["d", "p/pstack-panel-d"],
			["e", undefined],
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
