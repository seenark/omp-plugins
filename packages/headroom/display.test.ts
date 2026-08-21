import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_DISPLAY_CONFIG,
	DEFAULT_GLYPHS,
	DEFAULT_TEMPLATES,
	isDisplayVisible,
	loadDisplayConfig,
	loadGlyph,
	loadGlyphAsset,
	loadGlyphFrames,
	renderDisplay,
	resolveThemeGlyph,
	widgetState,
	type DisplayValues,
} from "./display.ts";
import { buildHeadroomInitFiles } from "./init.ts";

const values: Omit<DisplayValues, "icon" | "state"> = {
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
			off: "{icon} Headroom off",
			"remote-blocked": "{icon} Headroom remote blocked",
			starting: "{icon} Headroom starting",
			offline: "{icon} Headroom not running",
			idle: "{icon} Headroom idle",
			online: "{icon} Headroom",
			compressed: "{icon} Headroom -{compressionPercent}% ({tokensSaved} saved)",
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
			visible: true,
			glyphDirectory: "~/.config/codesook-omp/headroom",
			status: DEFAULT_TEMPLATES,
		});
		expect(isDisplayVisible({})).toBe(true);
		expect(isDisplayVisible({ visible: false })).toBe(false);
		expect(isDisplayVisible({ visible: "false" as unknown as boolean })).toBe(true);
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
			const config = {
				glyphDirectory: directory,
				status: { compressed: "{icon} {label} -{compressionPercent}% {tokensSaved}" },
			};

			expect(loadGlyphFrames("compressed", config)).toEqual(["A", "B"]);
			expect(loadGlyph("compressed", config, "fallback", 1)).toBe("B");
			expect(renderDisplay("compressed", values, config, "fallback", 1)).toBe("B Headroom -32% 1,234");
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});
	it("parses legacy, multi-character, and opt-in animated glyph assets", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-headroom-glyph-assets-"));
		const config = { glyphDirectory: directory };
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

	it("renders preloaded glyph frames without rereading the asset", () => {
		const config = {
			glyphDirectory: "/path/that/does/not/exist",
			status: { compressed: "{icon} {label} -{compressionPercent}% {tokensSaved} {state} {proxyStatus}" },
		};

		expect(renderDisplay("compressed", values, config, "fallback", 1, ["A", "B"])).toBe(
			"B Headroom -32% 1,234 compressed online",
		);
	});

	it("uses the OMP symbol fallback when a state file is absent", () => {
		expect(renderDisplay("online", values, { glyphDirectory: "/path/that/does/not/exist" }, "●")).toBe(
			"● Headroom",
		);
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

			expect(loadDisplayConfig(configPath)).toEqual({
				status: { idle: "{icon} waiting" },
				glyphDirectory: "~/.config/codesook-omp/headroom",
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
