import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_DISPLAY_CONFIG,
	DEFAULT_GLYPHS,
	isDisplayVisible,
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
					proxyStatus: "online",
					error: "",
				},
				config,
				DEFAULT_GLYPHS.compressed,
				asset,
			);
			expect(sequence).toEqual({ frames: [["A", "B Headroom -32% (1,234 saved)"], ["C Headroom -32% (1,234 saved)"]], fps: 8 });
			expect(renderDisplay("compressed", {
				label: "Headroom",
				compressionPercent: 32,
				tokensSaved: 1234,
				tokensBefore: 5000,
				tokensAfter: 3766,
				proxyStatus: "online",
				error: "",
			}, config, DEFAULT_GLYPHS.compressed, 1, asset.frames)).toBe("C Headroom -32% (1,234 saved)");
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
		expect(widgetState(true, false, false, true, true)).toBe("compressed");
	});

	it("builds explicit config and glyph initialization files", () => {
		const files = buildHeadroomInitFiles("all", { symbol: (key: string) => key === "status.success" ? "S" : "" }, {
			config: "/tmp/headroom-config.json",
			glyphs: "/tmp/headroom-glyphs",
		});
		expect(files[0]?.path).toBe("/tmp/headroom-config.json");
		expect(files).toHaveLength(8);
		expect(files.at(-1)?.content).toBe("S\n");
	});
});
