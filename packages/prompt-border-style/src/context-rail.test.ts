import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@oh-my-pi/pi-tui";

import {
	DEFAULT_CONTEXT_RAIL_CONFIG,
	normalizeContextRailConfig,
	parseContextRailGlyphAsset,
	renderContextRail,
	renderContextRailRows,
	type ContextRailPalette,
	type ContextRailPresentation,
	type ContextRailUsage,
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

const usage: ContextRailUsage = { tokens: 62_000, contextWindow: 100_000, percent: 62 };
const boundaries = { speculationPercent: 70, thresholdPercent: 85 };

function markerPresentation(
	mode: "compact" | "full" | "custom" = "compact",
	meaningPlacement: "top" | "below" | "beside" = "beside",
	overrides: Partial<ContextRailPresentation["roles"]> = {},
	customItems: ContextRailPresentation["customItems"] = [],
): ContextRailPresentation {
	return {
		mode,
		meaningPlacement,
		roles: {
			speculation: { frame: "SS", meaning: "spec", visible: true },
			pointer: { frame: "PP", meaning: "now", visible: true },
			compaction: { frame: "CC", meaning: "compact", visible: true },
			maximum: { frame: "MM", meaning: "max", visible: true },
			...overrides,
		},
		customItems,
	};
}

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
		).toMatchObject({
			enabled: false,
			placement: "below",
			visibility: "collapse-while-typing",
			pointer: { ...DEFAULT_CONTEXT_RAIL_CONFIG.pointer, visibility: "hidden" },
			labels: "bar-only",
			labelPosition: "right",
			showLabelGlyph: true,
			glyphDirectory: DEFAULT_CONTEXT_RAIL_CONFIG.glyphDirectory,
			labelGlyph: { frames: [], fps: undefined },
			pointerGlyph: { frames: [], fps: undefined },
			mode: "compact",
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
	test("normalizes role objects, legacy pointer visibility, and custom templates", () => {
		const normalized = normalizeContextRailConfig({
			mode: "full",
			pointer: "hidden",
			speculation: { framesFile: "", meaning: "" },
			compaction: { framesFile: "compact.frames", fps: 18 },
			custom: {
				meaningPlacement: "top",
				items: [
					{ role: "pointer", template: "{frame} {percent}" },
					{ role: "pointer", template: "{frame} duplicate" },
					{ role: "maximum", template: "{role}" },
				],
			},
		});
		expect(normalized.mode).toBe("full");
		expect(normalized.pointer).toEqual({
			framesFile: "pointer.txt",
			visibility: "hidden",
			meaning: "now",
		});
		expect(normalized.speculation).toEqual({ framesFile: "speculation.txt", meaning: "spec" });
		expect(normalized.compaction).toEqual({ framesFile: "compact.frames", fps: 18, meaning: "compact" });
		expect(normalized.maximum).toEqual({ framesFile: "maximum.txt", meaning: "max" });
		expect(normalized.custom.meaningPlacement).toBe("top");
		expect(normalized.custom.items).toEqual([
			{ role: "speculation", template: "{frame} {text-meaning}" },
			{ role: "pointer", template: "{frame} {percent}" },
			{ role: "compaction", template: "{frame} {text-meaning}" },
			{ role: "maximum", template: "{frame} {window} {text-meaning}" },
		]);
	});

	test("inserts defaults for invalid mode, meanings, filenames, and placement", () => {
		const normalized = normalizeContextRailConfig({
			mode: "invalid",
			speculation: { framesFile: " ", meaning: 12 },
			pointer: { framesFile: "", visibility: "invalid", meaning: "" },
			custom: { meaningPlacement: "invalid", items: [{ role: "pointer", template: "{frame}{frame}" }] },
		});
		expect(normalized.mode).toBe("compact");
		expect(normalized.speculation).toEqual({ framesFile: "speculation.txt", meaning: "spec" });
		expect(normalized.pointer).toEqual({
			framesFile: "pointer.txt",
			visibility: "auto",
			meaning: "now",
		});
		expect(normalized.custom.meaningPlacement).toBe("beside");
		expect(normalized.custom.items.find(item => item.role === "pointer")?.template).toBe("{frame} {percent}");
	});
	test("renders positioned tiles over a continuous fixed-width bar", () => {
		const line = renderContextRail(32, palette, usage, boundaries, {
			presentation: markerPresentation(),
		});
		expect(visibleWidth(line)).toBe(32);
		expect(line).toContain("─");
		expect(line).toContain("62%");
		expect(line).toContain("SS");
		expect(line).toContain("PP");
		expect(line).toContain("CC");
		expect(line).toContain("MM");
	});

	test("keeps the continuous bar in every presentation mode", () => {
		for (const mode of ["compact", "full", "custom"] as const) {
			const line = renderContextRail(32, palette, usage, boundaries, {
				presentation: markerPresentation(mode),
			});
			expect(line).toContain("─");
			expect(visibleWidth(line)).toBe(32);
		}
	});

	test("keeps tiles ordered by their actual anchors as the pointer moves", () => {
		const before = renderContextRail(40, palette, { ...usage, percent: 20 }, boundaries, {
			presentation: markerPresentation(),
		});
		const after = renderContextRail(40, palette, { ...usage, percent: 90 }, boundaries, {
			presentation: markerPresentation(),
		});
		expect(before.indexOf("PP")).toBeLessThan(before.indexOf("SS"));
		expect(after.indexOf("PP")).toBeGreaterThan(after.indexOf("CC"));
		expect(visibleWidth(before)).toBe(40);
		expect(visibleWidth(after)).toBe(40);
	});

	test("retains higher-priority tiles before shifting or hiding the pointer", () => {
		const line = renderContextRail(8, palette, usage, { speculationPercent: 98, thresholdPercent: 99 }, {
			presentation: markerPresentation(),
		});
		expect(line.endsWith("MM")).toBe(true);
		expect(line).toContain("CC");
		expect(line).toContain("SS");
		expect(visibleWidth(line)).toBe(8);
	});
	test("compact mode renders the bar, percent, and tiles without meanings", () => {
		const line = renderContextRail(32, palette, usage, boundaries, {
			presentation: markerPresentation("compact"),
		});
		expect(line).toContain("─");
		expect(line).toContain("62%");
		expect(line).not.toContain("spec");
		expect(line).not.toContain("now");
		expect(line).not.toContain("62K");
		expect(line).not.toContain("100K");
		expect(visibleWidth(line)).toBe(32);
	});

	test("full mode adds meanings and native-like numeric values beside the tiles", () => {
		const line = renderContextRail(100, palette, usage, boundaries, {
			presentation: markerPresentation("full"),
		});
		expect(line).toContain("62%");
		expect(line).toContain("100K");
		expect(line).toContain("spec");
		expect(line).toContain("now");
		expect(line).toContain("compact");
		expect(line).toContain("max");
		expect(visibleWidth(line)).toBe(100);
		expect(line).toContain("─");
	});

	test("custom mode expands every supported token while keeping frames inline", () => {
		const items = (["speculation", "pointer", "compaction", "maximum"] as const).map(role => ({
			role,
			template: "{role}:{frame}:{text-meaning}:{percent}:{tokens}:{window}",
		}));
		const line = renderContextRail(160, palette, usage, boundaries, {
			presentation: markerPresentation("custom", "beside", {}, items),
		});
		for (const token of ["speculation", "pointer", "compaction", "maximum", "spec", "now", "compact", "max", "62%", "62K", "100K"]) {
			expect(line).toContain(token);
		}
		expect(line).toContain("SS");
		expect(line).toContain("PP");
		expect(line).toContain("CC");
		expect(line).toContain("MM");
		expect(line).not.toContain("\n");
		expect(line).toContain("─");
		expect(visibleWidth(line)).toBe(160);
	});

	test("preserves custom beside whitespace without adding an automatic gap", () => {
		const noGapItems = [
			{ role: "speculation" as const, template: "{frame}" },
			{ role: "pointer" as const, template: "{frame}{percent}" },
			{ role: "compaction" as const, template: "{frame}" },
			{ role: "maximum" as const, template: "{frame}" },
		];
		const explicitGapItems = noGapItems.map(item =>
			item.role === "pointer" ? { ...item, template: "{frame} {percent}" } : item,
		);
		const noGap = renderContextRail(80, palette, usage, boundaries, {
			presentation: markerPresentation("custom", "beside", {}, noGapItems),
		});
		const explicitGap = renderContextRail(80, palette, usage, boundaries, {
			presentation: markerPresentation("custom", "beside", {}, explicitGapItems),
		});
		expect(noGap).toContain("PP62%");
		expect(explicitGap).toContain("PP 62%");
		expect(noGap).not.toContain("PP 62%");
		expect(visibleWidth(noGap)).toBe(80);
		expect(visibleWidth(explicitGap)).toBe(80);
	});

	test("preserves exact beside spacing for every role", () => {
		const roleFrames = { speculation: "SS", pointer: "PP", compaction: "CC", maximum: "MM" } as const;
		const roleMeanings = {
			speculation: "speculation",
			pointer: "pointer",
			compaction: "compaction",
			maximum: "maximum",
		} as const;
		for (const role of ["speculation", "pointer", "compaction", "maximum"] as const) {
			const roles = Object.fromEntries(
				(["speculation", "pointer", "compaction", "maximum"] as const).map(candidate => [
					candidate,
					{
						frame: roleFrames[candidate],
						meaning: roleMeanings[candidate],
						visible: candidate === role,
					},
				]),
			) as ContextRailPresentation["roles"];
			const items = (["speculation", "pointer", "compaction", "maximum"] as const).map(candidate => ({
				role: candidate,
				template: candidate === role ? "{frame}{role}" : "{frame}",
			}));
			const line = renderContextRail(80, palette, usage, boundaries, {
				presentation: {
					mode: "custom",
					meaningPlacement: "beside",
					roles,
					customItems: items,
				},
			});
			const adjacent = [`${roleFrames[role]}${role}`, `${role}${roleFrames[role]}`];
			expect(adjacent.some(fragment => line.includes(fragment))).toBe(true);
		}
	});

	test("custom top and below placements use annotation rows and keep the frame row single-line", () => {
		const items = (["speculation", "pointer", "compaction", "maximum"] as const).map(role => ({
			role,
			template: "{frame} {text-meaning}",
		}));
		for (const placement of ["top", "below"] as const) {
			const rows = renderContextRailRows(80, palette, usage, boundaries, {
				presentation: markerPresentation("custom", placement, {}, items),
			});
			expect(rows).toHaveLength(2);
			expect(rows.every(row => visibleWidth(row) === 80)).toBe(true);
			const frameRow = placement === "top" ? rows[1]! : rows[0]!;
			const annotationRow = placement === "top" ? rows[0]! : rows[1]!;
			expect(frameRow).not.toContain("spec");
			expect(frameRow).not.toContain("now");
			expect(annotationRow).toContain("spec");
			expect(annotationRow).toContain("now");
			expect(frameRow).not.toContain("\n");
		}
	});

	test("hides unavailable boundary roles while preserving pointer and maximum", () => {
		const line = renderContextRail(40, palette, usage, undefined, {
			presentation: markerPresentation(),
		});
		expect(line).toContain("PP");
		expect(line).toContain("MM");
		expect(line).not.toContain("SS");
		expect(line).not.toContain("CC");
		expect(visibleWidth(line)).toBe(40);
	});

	test("uses complete ANSI and wide-codepoint tiles without truncating them", () => {
		const line = renderContextRail(32, palette, usage, boundaries, {
			presentation: markerPresentation("compact", "beside", {
				pointer: { frame: "\x1b[31m界\x1b[0m", meaning: "now", visible: true },
				maximum: { frame: "👀", meaning: "max", visible: true },
			}),
		});
		expect(line).toContain("\x1b[31m界\x1b[0m");
		expect(line).toContain("👀");
		expect(visibleWidth(line)).toBe(32);
	});

	test("formats sub-one-percent and over-limit percentages without clamping display text", () => {
		const items = [
			{ role: "pointer" as const, template: "{frame} {percent}" },
			{ role: "maximum" as const, template: "{frame} {percent} {tokens} {window}" },
		];
		const low = renderContextRail(64, palette, { tokens: 999, contextWindow: 1_000_000, percent: 0.5 }, undefined, {
			presentation: markerPresentation("custom", "beside", {}, items),
		});
		const high = renderContextRail(64, palette, { tokens: 620_000, contextWindow: 1_000_000, percent: 120 }, undefined, {
			presentation: markerPresentation("custom", "beside", {}, items),
		});
		expect(low).toContain("0.5%");
		expect(low).toContain("999");
		expect(low).toContain("1M");
		expect(high).toContain("120%");
		expect(high).toContain("620K");
		expect(high).toContain("1M");
		expect(visibleWidth(low)).toBe(64);
		expect(visibleWidth(high)).toBe(64);
	});

	test("preserves complete tiles before truncating annotation text at narrow widths", () => {
		const items = (["speculation", "pointer", "compaction", "maximum"] as const).map(role => ({
			role,
			template: "{frame} very-long-meaning-{text-meaning}-{tokens}-{window}",
		}));
		const line = renderContextRail(10, palette, usage, boundaries, {
			presentation: markerPresentation("custom", "beside", {}, items),
		});
		expect(visibleWidth(line)).toBe(10);
		expect(line).toContain("MM");
		expect(line).toContain("CC");
	});

	test("returns blank fixed-width rows when usage is unknown", () => {
		const compact = renderContextRail(16, palette, undefined, boundaries, {
			presentation: markerPresentation(),
		});
		const top = renderContextRailRows(16, palette, undefined, boundaries, {
			presentation: markerPresentation("custom", "top"),
		});
		expect(compact).toBe(" ".repeat(16));
		expect(top).toEqual([" ".repeat(16), " ".repeat(16)]);
	});
	test("hides the pointer rather than crossing higher-priority anchors", () => {
		const line = renderContextRail(
			8,
			palette,
			{ tokens: 100_000, contextWindow: 100_000, percent: 100 },
			{ speculationPercent: 98, thresholdPercent: 99 },
			{ presentation: markerPresentation() },
		);
		expect(line).toContain("SS");
		expect(line).toContain("CC");
		expect(line.endsWith("MM")).toBe(true);
		expect(line).not.toContain("PP");
		expect(visibleWidth(line)).toBe(8);
	});

	test("keeps custom beside annotations on their template side", () => {
		const items = [
			{ role: "pointer" as const, template: "{role} {frame} {percent}" },
			{ role: "maximum" as const, template: "{frame}" },
		];
		const line = renderContextRail(40, palette, { tokens: 50_000, contextWindow: 100_000, percent: 50 }, undefined, {
			presentation: markerPresentation("custom", "beside", {}, items),
		});
		const roleStart = line.indexOf("pointer");
		const frameStart = line.indexOf("PP");
		const percentStart = line.indexOf("50%");
		expect(roleStart).toBeGreaterThanOrEqual(0);
		expect(frameStart).toBeGreaterThan(roleStart);
		expect(percentStart).toBeGreaterThan(frameStart);
		expect(visibleWidth(line)).toBe(40);
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
