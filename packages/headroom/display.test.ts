import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_DISPLAY_CONFIG,
	DEFAULT_GLYPHS,
	DEFAULT_HEADROOM_SEGMENT_TEMPLATE,
	DEFAULT_PONYTAIL_GLYPH_DIRECTORY,
	DEFAULT_PONYTAIL_TEMPLATE,
	DEFAULT_TEMPLATES,
	isDisplayVisible,
	isPonytailNativeVisible,
	loadDisplayConfig,
	loadGlyph,
	loadGlyphAsset,
	loadGlyphFrames,
	loadPonytailGlyphAsset,
	normalizeDisplayConfig,
	parsePonytailStatus,
	renderDisplay,
	renderPonytailDisplay,
	renderStatusSegments,
	resolvePonytailSessionStatus,
	resolveThemeGlyph,
	widgetState,
	writeDisplaySegmentVisibility,
	writePonytailNativeVisibility,
	type DisplayValues,
} from "./display.ts";
import { buildHeadroomInitFiles } from "./init.ts";

const values: Omit<DisplayValues, "glyph" | "state"> = {
	label: "Headroom",
	compressionPercent: 32,
	tokensSaved: 1234,
	tokensBefore: 5000,
	tokensAfter: 3766,
	proxyStatus: "online",
	error: "",
};

describe("Headroom display", () => {
	it("exports the complete direct display defaults", () => {
		expect(DEFAULT_TEMPLATES).toEqual({
			off: "{glyph} Headroom off",
			"remote-blocked": "{glyph} Headroom remote blocked",
			starting: "{glyph} Headroom starting",
			offline: "{glyph} Headroom not running",
			idle: "{glyph} Headroom idle",
			online: "{glyph} Headroom",
			compressed: "{glyph} Headroom -{compressionPercent}% ({tokensSaved} saved)",
		});
		expect(DEFAULT_GLYPHS).toEqual({
			off: "○",
			"remote-blocked": "⚠",
			starting: "⏳",
			offline: "○",
			idle: "○",
			online: "✓",
			compressed: "✓",
		});
		expect(DEFAULT_DISPLAY_CONFIG).toEqual({
			order: ["ponytail", "headroom"],
			separator: "  ",
			segments: {
				ponytail: {
					visible: true,
					nativeVisible: false,
					glyphDirectory: DEFAULT_PONYTAIL_GLYPH_DIRECTORY,
					template: DEFAULT_PONYTAIL_TEMPLATE,
				},
				headroom: {
					visible: true,
					glyphDirectory: "~/.config/codesook-omp/headroom",
					template: DEFAULT_HEADROOM_SEGMENT_TEMPLATE,
					status: DEFAULT_TEMPLATES,
				},
			},
		});
		expect(isDisplayVisible({})).toBe(true);
		expect(isDisplayVisible({ segments: { headroom: { visible: false } } })).toBe(false);
		expect(
			isDisplayVisible({ segments: { headroom: { visible: "false" as unknown as boolean } } }),
		).toBe(true);
		expect(isPonytailNativeVisible({})).toBe(false);
		expect(isPonytailNativeVisible({ segments: { ponytail: { nativeVisible: true } } })).toBe(true);
	});

	it("uses theme symbols for generated glyph defaults and falls back when empty", () => {
		const files = buildHeadroomInitFiles("glyphs", {
			symbol: (key: string) => ({ "status.disabled": "D", "status.success": "S" })[key] ?? "",
		}, {
			config: "/tmp/settings.json",
			display: "/tmp/display-config.json",
			glyphs: "/tmp/headroom-glyphs",
		});

		expect(files.map((file) => file.content)).toEqual(["D\n", "⚠\n", "⏳\n", "○\n", "○\n", "S\n", "S\n"]);
		expect(resolveThemeGlyph({ symbol: () => "" }, "online")).toBe(DEFAULT_GLYPHS.online);
	});
	it("renders a per-state template with a per-state glyph file", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-glyphs-"));
		try {
			fs.writeFileSync(path.join(directory, "compressed.txt"), "A B");
			const config = normalizeDisplayConfig({
				segments: {
					headroom: {
						glyphDirectory: directory,
						status: { compressed: "{glyph} {label} -{compressionPercent}% {tokensSaved}" },
					},
				},
			});

			expect(loadGlyphFrames("compressed", config)).toEqual(["A", "B"]);
			expect(loadGlyph("compressed", config, "fallback", 1)).toBe("B");
			expect(renderDisplay("compressed", values, config, "fallback", 1)).toBe("B Headroom -32% 1,234");
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});
	it("parses legacy, multi-character, and opt-in animated glyph assets", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-glyph-assets-"));
		const config = normalizeDisplayConfig({ segments: { headroom: { glyphDirectory: directory } } });
		try {
			fs.writeFileSync(path.join(directory, "off.txt"), "\n  fps=16  \nAB\n\nCD\n");
			expect(loadGlyphAsset("off", config)).toEqual({ frames: ["AB", "CD"], fps: 16 });

			fs.writeFileSync(path.join(directory, "online.txt"), "A B");
			expect(loadGlyphAsset("online", config)).toEqual({ frames: ["A", "B"], fps: undefined });

			for (const directive of ["bad", "0", "-4"]) {
				fs.writeFileSync(path.join(directory, "idle.txt"), `fps=${directive}\nA\n\nB`);
				expect(loadGlyphAsset("idle", config)).toEqual({ frames: ["A", "B"], fps: undefined });
			}

			fs.writeFileSync(path.join(directory, "offline.txt"), " \n\t\n");
			expect(loadGlyphAsset("offline", config)).toEqual({ frames: [], fps: undefined });
			expect(loadGlyph("offline", config, "fallback")).toBe("fallback");
			expect(loadGlyphAsset("compressed", config)).toEqual({ frames: [], fps: undefined });
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("renders captured Ponytail mode with its own animated glyph on the Headroom line", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-ponytail-glyph-assets-"));
		const config = normalizeDisplayConfig({
			separator: " | ",
			segments: {
				ponytail: {
					glyphDirectory: directory,
					template: "{activity} {glyph} ponytail: {modeIcon}{mode}",
				},
			},
		});
		try {
			fs.writeFileSync(path.join(directory, "full.txt"), "fps=8\nA\n\nB");
			const status = parsePonytailStatus("\u001b[2m●\u001b[0m 🐴 ponytail: ⚡ FULL");
			expect(status).toEqual({ active: true, mode: "full" });
			if (!status) throw new Error("Ponytail status did not parse");
			expect(loadPonytailGlyphAsset(status, config)).toEqual({ frames: ["A", "B"], fps: 8 });
			const ponytail = renderPonytailDisplay(status, config, 1, ["A", "B"]);
			expect(ponytail).toBe("● B ponytail: ⚡ FULL");
			expect(renderStatusSegments("✓ Headroom", ponytail, config)).toBe(
				"● B ponytail: ⚡ FULL | ✓ Headroom",
			);
			config.order = ["headroom", "ponytail"];
			expect(renderStatusSegments("✓ Headroom", ponytail, config)).toBe(
				"✓ Headroom | ● B ponytail: ⚡ FULL",
			);
			config.order = ["headroom"];
			expect(renderStatusSegments("✓ Headroom", ponytail, config)).toBe("✓ Headroom");
			expect(parsePonytailStatus("")).toEqual({ active: false, mode: "off" });
			expect(renderPonytailDisplay({ active: false, mode: "off" }, config)).toBe("");
			expect(
				resolvePonytailSessionStatus([
					{ type: "custom", customType: "ponytail-mode", data: { mode: "lite" } },
					{ type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } },
				]),
			).toEqual({ active: false, mode: "ultra" });
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("renders preloaded glyph frames without rereading the asset", () => {
		const config = normalizeDisplayConfig({
			segments: {
				headroom: {
					glyphDirectory: "/path/that/does/not/exist",
					status: {
						compressed: "{glyph} {label} -{compressionPercent}% {tokensSaved} {state} {proxyStatus}",
					},
				},
			},
		});

		expect(renderDisplay("compressed", values, config, "fallback", 1, ["A", "B"])).toBe(
			"B Headroom -32% 1,234 compressed online",
		);
	});

	it("uses the OMP symbol fallback when a state file is absent", () => {
		const config = normalizeDisplayConfig({
			segments: { headroom: { glyphDirectory: "/path/that/does/not/exist" } },
		});
		expect(renderDisplay("online", values, config, "●")).toBe("● Headroom");
	});

	it("reads the dedicated display-config.json shape", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-config-"));
		const configPath = path.join(directory, "display-config.json");
		try {
			fs.writeFileSync(
				configPath,
				JSON.stringify({
					status: { idle: "{icon} waiting" },
					glyphDirectory: "~/.config/codesook-omp/headroom",
				}),
			);

			expect(loadDisplayConfig(configPath)).toMatchObject({
				order: ["ponytail", "headroom"],
				segments: {
					headroom: {
						glyphDirectory: "~/.config/codesook-omp/headroom",
						status: { idle: "{glyph} waiting" },
					},
				},
			});
			writeDisplaySegmentVisibility("ponytail", false, configPath);
			expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toMatchObject({
				order: ["ponytail", "headroom"],
				segments: {
					ponytail: { visible: false },
					headroom: {
						visible: true,
						status: { idle: "{glyph} waiting" },
					},
				},
			});
			writePonytailNativeVisibility(true, configPath);
			expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toMatchObject({
				segments: { ponytail: { visible: false, nativeVisible: true } },
			});
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it("prioritizes disabled, blocked, starting, and offline states", () => {
		expect(widgetState(false, false, false, null, false)).toBe("off");
		expect(widgetState(true, true, false, null, false)).toBe("remote-blocked");
		expect(widgetState(true, false, true, false, false)).toBe("starting");
		expect(widgetState(true, false, false, false, true)).toBe("offline");
		expect(widgetState(true, false, false, true, true)).toBe("compressed");
	});
});
