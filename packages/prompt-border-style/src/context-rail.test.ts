import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@oh-my-pi/pi-tui";

import {
	DEFAULT_CONTEXT_RAIL_CONFIG,
	normalizeContextRailConfig,
	renderContextRail,
	type ContextRailPalette,
} from "./context-rail";

const palette: ContextRailPalette = {
	horizontal: "─",
	pointer: "●",
	speculation: "╎",
	threshold: "┃",
	used: value => value,
	unused: value => value,
	normal: value => value,
	warning: value => value,
	purple: value => value,
	error: value => value,
	muted: value => value,
	label: value => value,
};

describe("Context Rail config", () => {
	test("normalizes missing and invalid values to the agreed defaults", () => {
		expect(normalizeContextRailConfig(undefined)).toEqual(DEFAULT_CONTEXT_RAIL_CONFIG);
		expect(
			normalizeContextRailConfig({
				enabled: "yes",
				placement: "side",
				visibility: "typing",
				pointer: "marker",
				labels: "text",
				labelPosition: "middle",
			}),
		).toEqual(DEFAULT_CONTEXT_RAIL_CONFIG);
	});

	test("preserves valid plugin settings", () => {
		expect(
			normalizeContextRailConfig({
				enabled: false,
				placement: "below",
				visibility: "collapse-while-typing",
				pointer: "hidden",
				labels: "bar-only",
				labelPosition: "right",
			}),
		).toEqual({
			enabled: false,
			placement: "below",
			visibility: "collapse-while-typing",
			pointer: "hidden",
			labels: "bar-only",
			labelPosition: "right",
		});
	});

	test("accepts every label position", () => {
		for (const labelPosition of ["left", "center", "right"] as const) {
			expect(normalizeContextRailConfig({ labelPosition }).labelPosition).toBe(labelPosition);
		}
	});
});

describe("Context Rail renderer", () => {
	test("renders a muted full-width line when usage is unknown", () => {
		const line = renderContextRail(12, palette);
		expect(visibleWidth(line)).toBe(12);
		expect(line).toBe("────────────");
	});

	test("renders usage, pointer, and adaptive percentage label", () => {
		const line = renderContextRail(24, palette, { tokens: 50_000, contextWindow: 100_000, percent: 50 });
		expect(visibleWidth(line)).toBe(24);
		expect(line).toContain("●");
		expect(line).toContain("50%");
	});
	test("places the percentage label at the requested side without changing rail width", () => {
		const usage = { tokens: 50_000, contextWindow: 100_000, percent: 50 };
		const expectedStarts = { left: 0, center: 6, right: 13 } as const;
		for (const [labelPosition, expectedStart] of Object.entries(expectedStarts) as [
			"left" | "center" | "right",
			number,
		][]) {
			const line = renderContextRail(16, palette, usage, undefined, {
				pointer: "hidden",
				labelPosition,
			});
			expect(visibleWidth(line)).toBe(16);
			expect(line.indexOf("50%")).toBe(expectedStart);
		}
	});

	test("keeps marker cells when the label would overlap them", () => {
		const line = renderContextRail(
			12,
			palette,
			{ tokens: 50_000, contextWindow: 100_000, percent: 50 },
			{ thresholdPercent: 0 },
			{ pointer: "hidden", labelPosition: "left" },
		);
		expect(visibleWidth(line)).toBe(12);
		expect(line[0]).toBe("┃");
		expect(line.indexOf("50%")).toBe(1);
	});

	test("hides automatic pointer and labels in compact mode", () => {
		const line = renderContextRail(
			24,
			palette,
			{ tokens: 50_000, contextWindow: 100_000, percent: 50 },
			undefined,
			{ compact: true, pointer: "auto", labels: "auto" },
		);
		expect(visibleWidth(line)).toBe(24);
		expect(line).not.toContain("●");
		expect(line).not.toContain("50%");
	});

	test("changes used-fill semantics at the native warning and purple levels", () => {
		const semanticPalette = {
			...palette,
			warning: (value: string) => `W${value}W`,
			purple: (value: string) => `P${value}P`,
		};
		expect(
			renderContextRail(16, semanticPalette, { tokens: 60_000, contextWindow: 100_000, percent: 60 }, undefined, {
				labels: "bar-only",
			}),
		).toContain("W");
		expect(
			renderContextRail(16, semanticPalette, { tokens: 80_000, contextWindow: 100_000, percent: 80 }, undefined, {
				labels: "bar-only",
			}),
		).toContain("P");
	});

	test("renders optional speculative and compaction markers", () => {
		const line = renderContextRail(
			24,
			palette,
			{ tokens: 50_000, contextWindow: 100_000, percent: 20 },
			{ speculationPercent: 40, thresholdPercent: 80 },
			{ pointer: "hidden", labels: "bar-only" },
		);
		expect(line).toContain("╎");
		expect(line).toContain("┃");
	});

	test("keeps an over-limit rail full and visibly error-marked", () => {
		const errorPalette = { ...palette, error: (value: string) => `!${value}!` };
		const line = renderContextRail(12, errorPalette, { tokens: 120_000, contextWindow: 100_000, percent: 120 }, undefined, {
			pointer: "visible",
			labels: "bar-only",
		});
		expect(visibleWidth(line)).toBeGreaterThanOrEqual(12);
		expect(line).toContain("!");
	});
});
