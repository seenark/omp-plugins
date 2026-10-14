import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_DISPLAY_CONFIG,
	DEFAULT_GLYPHS,
	isDisplayVisible,
	formatCompact,
	loadGlyphAsset,
	normalizeDisplayConfig,
	renderDisplay,
	renderDisplayFrames,
	widgetState,
} from "./display.ts";
import { buildHeadroomInitFiles } from "./init.ts";

describe("Headroom display producer", () => {
	it("parses user block assets and publishes a complete animated sequence", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-display-"));
		try {
			fs.writeFileSync(path.join(directory, "compressed.txt"), "fps=8\nA\nB\n\nC\n");
			const config = normalizeDisplayConfig({ glyphDirectory: directory });
			const asset = loadGlyphAsset("compressed", config);
			expect(asset).toEqual({ frames: [["A", "B"], ["C"]], fps: 8 });
			const sequence = renderDisplayFrames(
				"compressed",
				{
					label: "Headroom",
					compressionPercent: 32,
					tokensSaved: 1234,
					tokensBefore: 5000,
					tokensAfter: 3766,
					lastPercent: 5,
					lastSaved: 50,
					proxyStatus: "online",
					error: "",
					reason: "",
				},
				config,
				DEFAULT_GLYPHS.compressed,
				asset,
			);
			expect(sequence).toEqual({ frames: [["A", "B Headroom -32% (1.2k saved)"], ["C Headroom -32% (1.2k saved)"]], fps: 8 });
			expect(renderDisplay("compressed", {
				label: "Headroom",
				compressionPercent: 32,
				tokensSaved: 1234,
				tokensBefore: 5000,
				tokensAfter: 3766,
				lastPercent: 5,
				lastSaved: 50,
				proxyStatus: "online",
				error: "",
				reason: "",
			}, config, DEFAULT_GLYPHS.compressed, 1, asset.frames)).toBe("C Headroom -32% (1.2k saved)");
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("keeps display defaults and state selection independent of the host", () => {
		expect(DEFAULT_DISPLAY_CONFIG.visible).toBe(true);
		expect(isDisplayVisible(DEFAULT_DISPLAY_CONFIG)).toBe(true);
		expect(isDisplayVisible({ display: { ...DEFAULT_DISPLAY_CONFIG, visible: false } })).toBe(false);
		expect(widgetState(false, false, false, null, false)).toBe("off");
		expect(widgetState(true, true, false, null, false)).toBe("remote-blocked");
		expect(widgetState(true, false, false, true, false)).toBe("compressed");
		expect(widgetState(true, false, false, true, true)).toBe("unavailable");
		expect(widgetState(true, false, false, false, true)).toBe("offline");
		expect(widgetState(true, false, false, null, false)).toBe("idle");
	});

	it("renders Headroom Savings, last-call, and reason placeholders with compact numbers", () => {
		const values = {
			label: "Headroom",
			compressionPercent: 11.6,
			tokensSaved: 3_400_000,
			tokensBefore: 29_000_000,
			tokensAfter: 25_600_000,
			lastPercent: 7,
			lastSaved: 950,
			proxyStatus: "online",
			error: "",
			reason: "401",
		};
		const config = normalizeDisplayConfig({});
		const render = (state: "compressed" | "unavailable", template?: string) =>
			renderDisplay(state, values, template ? { ...config, template } : config, "G", 0, [["G"]]);

		expect(render("compressed")).toBe("G Headroom -12% (3.4M saved)");
		expect(render("compressed", "{lastPercent}% {lastSaved} {tokensBefore} {tokensAfter}")).toBe("7% 950 29M 25.6M");
		expect(render("unavailable")).toBe("G Headroom unavailable (401)");
	});

	it("formats compact counts", () => {
		expect([0, 950, 999, 1000, 1234, 12_345, 999_950, 3_400_000].map(formatCompact)).toEqual([
			"0", "950", "999", "1k", "1.2k", "12.3k", "1M", "3.4M",
		]);
	});

	it("falls back to default state templates when user config omits them", () => {
		const config = normalizeDisplayConfig({ status: { compressed: "{glyph} custom" } });
		expect(config.status.compressed).toBe("{glyph} custom");
		expect(config.status.unavailable).toBe("{glyph} Headroom unavailable ({reason})");
	});

	it("builds explicit config and glyph initialization files", () => {
		const files = buildHeadroomInitFiles("all", { symbol: (key: string) => key === "status.success" ? "S" : "" }, {
			config: "/tmp/headroom-config.json",
			glyphs: "/tmp/headroom-glyphs",
		});
		expect(files[0]?.path).toBe("/tmp/headroom-config.json");
		expect(files).toHaveLength(10);
		expect(files.at(-1)?.content).toBe("S\n");
	});
});
