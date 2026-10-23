import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	envDefaultMode,
	loadPonytailConfig,
	normalizePonytailConfig,
	normalizePonytailRootConfig,
	seedMissingPonytailGlyphs,
	validatePonytailConfig,
	writePonytailConfig,
} from "./config.ts";
import { loadPonytailSequence } from "./display.ts";
import { DEFAULT_PONYTAIL_CONFIG, PACKAGE_ASSET_DIRECTORY, PONYTAIL_MODES } from "./types.ts";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});
const tempDirectory = (): string => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponytail-config-"));
	directories.push(directory);
	return directory;
};

describe("Ponytail config", () => {
	it("defaults when the root config is missing or has no Ponytail sections", () => {
		const directory = tempDirectory();
		const file = path.join(directory, "config.json");
		expect(loadPonytailConfig({ configPath: file }).config).toEqual(DEFAULT_PONYTAIL_CONFIG);
		fs.writeFileSync(file, JSON.stringify({ version: 1, display: {}, behavior: {} }));
		expect(loadPonytailConfig({ configPath: file }).config).toEqual(DEFAULT_PONYTAIL_CONFIG);
		expect(DEFAULT_PONYTAIL_CONFIG.defaultMode).toBe("full");
	});

	it("fails closed to off for an unreadable or wrong-shaped root config without throwing", () => {
		const directory = tempDirectory();
		const file = path.join(directory, "config.json");
		const warnings: string[] = [];
		for (const content of ["{ nope", "[]", JSON.stringify({ version: 2, display: {}, behavior: {} })]) {
			fs.writeFileSync(file, content);
			const { config } = loadPonytailConfig({ configPath: file, onWarning: message => warnings.push(message) });
			expect(config.defaultMode).toBe("off");
		}
		expect(warnings).toHaveLength(3);
	});

	it("rejects legacy and foreign Mode Levels instead of migrating them", () => {
		for (const defaultMode of ["review", "wenyan-full", "FULL", "", null]) {
			const warnings: string[] = [];
			expect(normalizePonytailConfig({ defaultMode }, message => warnings.push(message)).defaultMode).toBe("off");
			expect(warnings).toHaveLength(1);
		}
		for (const defaultMode of ["off", "lite", "full", "ultra"]) {
			expect(normalizePonytailConfig({ defaultMode }).defaultMode).toBe(defaultMode as "off");
		}
	});

	it("reads display fields and falls back per field", () => {
		const root = {
			version: 1,
			display: { ponytail: { visible: false, nativeVisible: true, template: "{mode}", glyphDirectory: " ~/g " } },
			behavior: { ponytail: { defaultMode: "lite" } },
		};
		expect(normalizePonytailRootConfig(root)).toEqual({
			defaultMode: "lite",
			nativeVisible: true,
			display: { visible: false, template: "{mode}", glyphDirectory: "~/g" },
		});
		const bad = { version: 1, display: { ponytail: { visible: "no", nativeVisible: 1, template: "a\nb", glyphDirectory: "  " } }, behavior: {} };
		expect(normalizePonytailRootConfig(bad)).toEqual(DEFAULT_PONYTAIL_CONFIG);
		expect(normalizePonytailRootConfig({ version: 1, display: {} })).toBeUndefined();
		expect(normalizePonytailRootConfig("x")).toBeUndefined();
	});

	it("validates and writes both sections while keeping unrelated keys", () => {
		const directory = tempDirectory();
		const file = path.join(directory, "config.json");
		fs.writeFileSync(file, JSON.stringify({ version: 1, display: { rtk: { visible: true } }, behavior: { caveman: { defaultMode: "caveman" } } }));
		const config = { ...DEFAULT_PONYTAIL_CONFIG, defaultMode: "ultra" as const, nativeVisible: true };
		expect(validatePonytailConfig(config)).toBeUndefined();
		writePonytailConfig(config, file);
		expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
			version: 1,
			display: { rtk: { visible: true }, ponytail: { ...DEFAULT_PONYTAIL_CONFIG.display, nativeVisible: true } },
			behavior: { caveman: { defaultMode: "caveman" }, ponytail: { defaultMode: "ultra" } },
		});
		expect(validatePonytailConfig({ ...config, defaultMode: "review" })).toBeDefined();
		expect(() => writePonytailConfig({ ...config, defaultMode: "review" as never }, file)).toThrow();
		expect(validatePonytailConfig({ ...config, display: { ...config.display, template: "a\nb" } })).toBeDefined();
	});

	it("accepts only a runtime mode from PONYTAIL_DEFAULT_MODE", () => {
		expect(envDefaultMode({ PONYTAIL_DEFAULT_MODE: " ULTRA " })).toBe("ultra");
		expect(envDefaultMode({ PONYTAIL_DEFAULT_MODE: "review" })).toBeNull();
		expect(envDefaultMode({})).toBeNull();
	});
});

describe("Ponytail glyphs", () => {
	it("ships one asset per Mode Level and seeds only the missing ones", async () => {
		for (const mode of PONYTAIL_MODES) expect(fs.existsSync(path.join(PACKAGE_ASSET_DIRECTORY, `${mode}.txt`))).toBe(true);
		const directory = tempDirectory();
		const target = path.join(directory, "glyphs");
		fs.mkdirSync(target);
		fs.writeFileSync(path.join(target, "full.txt"), "mine");
		const created = await seedMissingPonytailGlyphs(target);
		expect(created.map(file => path.basename(file)).sort()).toEqual(["lite.txt", "off.txt", "review.txt", "ultra.txt"]);
		expect(fs.readFileSync(path.join(target, "full.txt"), "utf8")).toBe("mine");
		expect(await seedMissingPonytailGlyphs(target)).toEqual([]);
	});

	it("prefers a valid user glyph, then the packaged one, then a single horse", async () => {
		const directory = tempDirectory();
		const config = { ...DEFAULT_PONYTAIL_CONFIG, display: { ...DEFAULT_PONYTAIL_CONFIG.display, glyphDirectory: directory } };
		expect(await loadPonytailSequence("full", config)).toEqual({ frames: [["🐴⚡"]] });
		fs.writeFileSync(path.join(directory, "full.txt"), "   \n");
		expect(await loadPonytailSequence("full", config)).toEqual({ frames: [["🐴⚡"]] });
		fs.writeFileSync(path.join(directory, "full.txt"), "X\n");
		expect(await loadPonytailSequence("full", config)).toEqual({ frames: [["X"]] });
		expect(await loadPonytailSequence("full", config, { packageAssetDirectory: directory, homeDirectory: directory })).toEqual({ frames: [["X"]] });
		fs.rmSync(path.join(directory, "full.txt"));
		expect(await loadPonytailSequence("full", config, { packageAssetDirectory: directory })).toEqual({ frames: [["🐴"]] });
	});
});
