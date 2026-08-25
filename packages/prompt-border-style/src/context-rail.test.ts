import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@oh-my-pi/pi-tui";

import {
	DEFAULT_CONTEXT_RAIL_CONFIG,
	normalizeContextRailConfig,
	parseContextRailGlyphAsset,
	renderContextRail,
	renderContextRailRows,
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
	test("normalizes legacy, valid, and invalid label glyph visibility", () => {
		expect(normalizeContextRailConfig({}).showLabelGlyph).toBe(true);
		expect(normalizeContextRailConfig({ showLabelGlyph: true }).showLabelGlyph).toBe(true);
		expect(normalizeContextRailConfig({ showLabelGlyph: false }).showLabelGlyph).toBe(false);
		expect(normalizeContextRailConfig({ showLabelGlyph: "off" }).showLabelGlyph).toBe(true);
		expect(normalizeContextRailConfig({ showLabelGlyph: 0 }).showLabelGlyph).toBe(true);
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
			showLabelGlyph: true,
			glyphDirectory: DEFAULT_CONTEXT_RAIL_CONFIG.glyphDirectory,
			labelGlyph: { frames: [], fps: undefined },
			pointerGlyph: { frames: [], fps: undefined },
		});
	});

	test("validates the configurable glyph directory without serializing the asset", () => {
		const asset = { frames: ["A"], fps: 16 };
		expect(normalizeContextRailConfig({ glyphDirectory: "/tmp/context rail" }, asset)).toMatchObject({
			glyphDirectory: "/tmp/context rail",
			labelGlyph: asset,
		});
		expect(normalizeContextRailConfig({ glyphDirectory: "" }, asset).glyphDirectory).toBe(
			DEFAULT_CONTEXT_RAIL_CONFIG.glyphDirectory,
		);
		expect(normalizeContextRailConfig({ glyphDirectory: "   " }, asset).glyphDirectory).toBe(
			DEFAULT_CONTEXT_RAIL_CONFIG.glyphDirectory,
		);
		expect(normalizeContextRailConfig({ glyphDirectory: 42 }, asset).glyphDirectory).toBe(
			DEFAULT_CONTEXT_RAIL_CONFIG.glyphDirectory,
		);
	});

	test("parses static and whitespace-separated glyph assets", () => {
		expect(parseContextRailGlyphAsset("A0 A1\nA2")).toEqual({ frames: ["A0", "A1", "A2"], fps: undefined });
		expect(parseContextRailGlyphAsset("A0\n\nA1\n \nA2")).toEqual({ frames: ["A0", "A1", "A2"], fps: undefined });
		expect(parseContextRailGlyphAsset("  A0\n  A1  ")).toEqual({ frames: ["A0", "A1"], fps: undefined });
		expect(parseContextRailGlyphAsset("")).toEqual({ frames: [], fps: undefined });
	});

	test("parses valid fps and discards invalid fps directives", () => {
		expect(parseContextRailGlyphAsset("\n fps=16 \nA\n\nB")).toEqual({ frames: ["A", "B"], fps: 16 });
		expect(parseContextRailGlyphAsset("fps=0\nA")).toEqual({ frames: ["A"], fps: undefined });
		expect(parseContextRailGlyphAsset("fps=nan\nA")).toEqual({ frames: ["A"], fps: undefined });
	});
	test("parses and removes a size directive while preserving multiline frames", () => {
		expect(parseContextRailGlyphAsset("fps=16\nsize=2x2\nAB\nCD\n\nEF\nGH")).toEqual({
			frames: ["AB\nCD", "EF\nGH"],
			fps: 16,
			size: { width: 2, height: 2 },
		});
		expect(parseContextRailGlyphAsset("size=0x4\nA")).toEqual({
			frames: ["A"],
			fps: undefined,
		});
	});

	test("keeps every label position", () => {
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

	test("renders the selected label glyph frame before the percentage and wraps frames", () => {
		const usage = { tokens: 50_000, contextWindow: 100_000, percent: 50 };
		const options = {
			pointer: "hidden" as const,
			labelPosition: "left" as const,
			labelGlyphs: ["A0", "A1"],
		};
		const secondFrame = renderContextRail(16, palette, usage, undefined, { ...options, labelFrame: 1 });
		const wrappedFrame = renderContextRail(16, palette, usage, undefined, { ...options, labelFrame: 3 });

		expect(secondFrame.startsWith("A150%")).toBe(true);
		expect(wrappedFrame.startsWith("A150%")).toBe(true);
		expect(visibleWidth(secondFrame)).toBe(16);
		expect(visibleWidth(wrappedFrame)).toBe(16);
	});
	test("hides only the label glyph while preserving percentage, width, and pointer", () => {
		const hidden = renderContextRail(
			16,
			palette,
			{ tokens: 50_000, contextWindow: 100_000, percent: 50 },
			undefined,
			{
				pointer: "visible",
				labelPosition: "left",
				labelGlyphs: ["A0"],
				pointerGlyphs: ["x"],
				showLabelGlyph: false,
			},
		);
		expect(hidden.startsWith("50%")).toBe(true);
		expect(hidden).not.toContain("A0");
		expect(hidden[8]).toBe("x");
		expect(visibleWidth(hidden)).toBe(16);
	});
	test("renders configured pointer glyph frames at the usage marker", () => {
		const usage = { tokens: 50_000, contextWindow: 100_000, percent: 50 };
		const second = renderContextRail(16, palette, usage, undefined, {
			pointer: "visible",
			labels: "bar-only",
			pointerGlyphs: ["o", "O"],
			pointerFrame: 1,
		});
		const fallback = renderContextRail(16, palette, usage, undefined, {
			pointer: "visible",
			labels: "bar-only",
			pointerGlyphs: [],
			pointerGlyphFallback: "x",
		});
		expect(second[8]).toBe("O");
		expect(fallback[8]).toBe("x");
		expect(visibleWidth(second)).toBe(16);
		expect(visibleWidth(fallback)).toBe(16);
	});
	test("preserves multi-codepoint pointer glyph frames", () => {
		const glyph = "\u{102e7d}\u{102e7e}";
		const line = renderContextRail(
			20,
			palette,
			{ tokens: 3_000, contextWindow: 100_000, percent: 3 },
			undefined,
			{ pointer: "visible", labels: "bar-only", pointerGlyphs: [glyph] },
		);
		expect(line).toContain(glyph);
		expect(line).not.toContain("\x1b[0m");
		expect(visibleWidth(line)).toBe(20);
	});
	test("flattens multiline block frames into the single rail row", () => {
		const line = renderContextRail(
			24,
			palette,
			{ tokens: 50_000, contextWindow: 100_000, percent: 50 },
			undefined,
			{ pointer: "hidden", labelPosition: "left", labelGlyphs: ["AB\nCD"] },
		);
		expect(line).not.toContain("\n");
		expect(line.startsWith("ABCD50%")).toBe(true);
		expect(visibleWidth(line)).toBe(24);
	});
	test("renders a configured multiline frame beside the top-aligned usage gauge", () => {
		const rows = renderContextRailRows(
			24,
			palette,
			{ tokens: 50_000, contextWindow: 100_000, percent: 50 },
			undefined,
			{
				pointer: "hidden",
				labels: "always",
				labelPosition: "left",
				labelGlyphs: ["AB\nCD"],
				labelGlyphSize: { width: 2, height: 2 },
			},
		);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toContain("AB");
		expect(rows[0]).toContain("50%");
		expect(rows[1]).toContain("CD");
		expect(rows[1]).not.toContain("50%");
		expect(rows.every(row => visibleWidth(row) === 24)).toBe(true);
	});
	test("skips multiline label art when the label glyph is hidden", () => {
		const rows = renderContextRailRows(
			24,
			palette,
			{ tokens: 50_000, contextWindow: 100_000, percent: 50 },
			undefined,
			{
				pointer: "hidden",
				labels: "always",
				labelPosition: "left",
				labelGlyphs: ["AB\nCD"],
				labelGlyphSize: { width: 2, height: 2 },
				showLabelGlyph: false,
			},
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toContain("50%");
		expect(rows[0]).not.toContain("AB");
		expect(rows[0]).not.toContain("CD");
		expect(visibleWidth(rows[0]!)).toBe(24);
	});

	test("preserves one-row rendering without a size header and prioritizes the gauge on overflow", () => {
		const legacy = renderContextRailRows(24, palette, undefined, undefined, {
			pointer: "hidden",
			labelPosition: "left",
			labelGlyphs: ["AB\nCD"],
		});
		expect(legacy).toHaveLength(1);
		const narrow = renderContextRailRows(
			10,
			palette,
			{ tokens: 2_000, contextWindow: 100_000, percent: 2 },
			undefined,
			{
				pointer: "hidden",
				labels: "always",
				labelPosition: "left",
				labelGlyphs: ["ABCDEFG\nHIJKLMN"],
				labelGlyphSize: { width: 2, height: 2 },
			},
		);
		expect(narrow).toHaveLength(2);
		expect(narrow[0]).toContain("2%");
		expect(narrow.every(row => visibleWidth(row) === 10)).toBe(true);
	});

	test("falls back to the supplied glyph or plain percentage", () => {
		const usage = { tokens: 50_000, contextWindow: 100_000, percent: 50 };
		for (const labelGlyphs of [[], [" ", "\t"]]) {
			const line = renderContextRail(16, palette, usage, undefined, {
				pointer: "hidden",
				labelPosition: "left",
				labelGlyphs,
				labelFrame: Number.NaN,
				labelGlyphFallback: "✓",
			});
			expect(line.startsWith("✓50%")).toBe(true);
			expect(visibleWidth(line)).toBe(16);
		}
		const plain = renderContextRail(16, palette, usage, undefined, {
			pointer: "hidden",
			labelPosition: "left",
			labelGlyphs: [],
		});
		expect(plain.startsWith("50%")).toBe(true);
	});

	test("counts framed labels in marker protection and ANSI/wide width", () => {
		const usage = { tokens: 50_000, contextWindow: 100_000, percent: 50 };
		const marked = renderContextRail(
			12,
			palette,
			usage,
			{ thresholdPercent: 0 },
			{ pointer: "hidden", labelPosition: "left", labelGlyphs: ["XY"] },
		);
		const wide = renderContextRail(16, palette, usage, undefined, {
			pointer: "hidden",
			labelPosition: "left",
			labelGlyphs: ["界"],
		});
		const ansi = renderContextRail(16, palette, usage, undefined, {
			pointer: "hidden",
			labelPosition: "left",
			labelGlyphs: ["\x1b[31m⚡\x1b[0m"],
		});

		expect(marked[0]).toBe("┃");
		expect(marked.slice(1, 6)).toBe("XY50%");
		expect(visibleWidth(marked)).toBe(12);
		expect(wide.startsWith("界50%")).toBe(true);
		expect(visibleWidth(wide)).toBe(16);
		expect(ansi).toContain("\x1b[31m⚡\x1b[0m50%");
		expect(visibleWidth(ansi)).toBe(16);
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
