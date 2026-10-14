import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseFrameSequenceAsset } from "@codesook/omp-shared-display/client";
import {
	CAVEMAN_ACTIVE_MODES,
	CAVEMAN_MODES,
	DEFAULT_CAVEMAN_CONFIG,
	getCodesookOmpConfigPath,
	getLegacyPackageConfigPath,
} from "./types.ts";
import { loadCavemanConfig, normalizeCavemanConfig, seedMissingCavemanGlyphs, writeCavemanConfigAtomic } from "./config.ts";

function makeHome(): string {
	return mkdtempSync(path.join(os.tmpdir(), "omp-caveman-config-"));
}

function writeJson(filePath: string, value: unknown): void {
	const directory = path.dirname(filePath);
	mkdirSync(directory, { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

describe("Caveman config", () => {
	it("migrates package config into root envelope and removes both legacy files", async () => {
		const home = makeHome();
		try {
			const rootPath = getCodesookOmpConfigPath(home);
			const packagePath = getLegacyPackageConfigPath(home);
			const legacyPath = path.join(home, ".pi", "agent", "caveman.json");
			writeJson(packagePath, {
				defaultMode: "ultracave",
				nativeVisible: true,
				display: { visible: false, template: "package", glyphDirectory: "glyphs" },
			});
			writeJson(legacyPath, { defaultLevel: "ultra", showStatus: false });

			const loaded = await loadCavemanConfig({ homeDirectory: home, legacyConfigPath: legacyPath, seedAssets: false });

			expect(loaded.config).toEqual({
				defaultMode: "ultracave",
				nativeVisible: true,
				display: { visible: false, template: "package", glyphDirectory: "glyphs" },
			});
			expect(JSON.parse(readFileSync(rootPath, "utf8"))).toEqual({
				version: 1,
				display: {
					caveman: { visible: false, template: "package", glyphDirectory: "glyphs", nativeVisible: true },
				},
				behavior: { caveman: { defaultMode: "ultracave" } },
			});
			expect(existsSync(packagePath)).toBe(false);
			expect(existsSync(legacyPath)).toBe(false);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("preserves invalid legacy sources during successful migration", async () => {
		const home = makeHome();
		try {
			const rootPath = getCodesookOmpConfigPath(home);
			const packagePath = getLegacyPackageConfigPath(home);
			const legacyPath = path.join(home, ".pi", "agent", "caveman.json");
			writeJson(packagePath, { defaultMode: "megacave" });
			mkdirSync(path.dirname(legacyPath), { recursive: true });
			writeFileSync(legacyPath, "{invalid\n", "utf8");

			const loaded = await loadCavemanConfig({ homeDirectory: home, legacyConfigPath: legacyPath, seedAssets: false });

			expect(loaded.config.defaultMode).toBe("megacave");
			expect(existsSync(packagePath)).toBe(false);
			expect(existsSync(legacyPath)).toBe(true);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("fills missing root Caveman sections without replacing other root keys", async () => {
		const home = makeHome();
		try {
			const rootPath = getCodesookOmpConfigPath(home);
			const packagePath = getLegacyPackageConfigPath(home);
			const legacyPath = path.join(home, ".pi", "agent", "caveman.json");
			writeJson(rootPath, { version: 1, display: { other: { keep: true } }, behavior: {} });
			writeJson(packagePath, { defaultMode: "caveman", nativeVisible: true, display: { visible: false } });
			writeJson(legacyPath, { defaultLevel: "ultra", showStatus: false });

			const loaded = await loadCavemanConfig({ homeDirectory: home, legacyConfigPath: legacyPath, seedAssets: false });
			const root = JSON.parse(readFileSync(rootPath, "utf8"));

			expect(loaded.config.defaultMode).toBe("caveman");
			expect(loaded.config.display.visible).toBe(false);
			expect(root.display.other).toEqual({ keep: true });
			expect(root.display.caveman.nativeVisible).toBe(true);
			expect(root.behavior.caveman.defaultMode).toBe("caveman");
			expect(existsSync(packagePath)).toBe(false);
			expect(existsSync(legacyPath)).toBe(false);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("lets invalid root config win over legacy files", async () => {
		const home = makeHome();
		try {
			const rootPath = getCodesookOmpConfigPath(home);
			mkdirSync(path.dirname(rootPath), { recursive: true });
			const packagePath = getLegacyPackageConfigPath(home);
			const legacyPath = path.join(home, ".pi", "agent", "caveman.json");
			writeFileSync(rootPath, "{invalid\n", "utf8");
			writeJson(packagePath, { defaultMode: "megacave" });
			writeJson(legacyPath, { defaultLevel: "ultra" });

			const loaded = await loadCavemanConfig({ homeDirectory: home, seedAssets: false });

			expect(loaded.config).toEqual({ ...DEFAULT_CAVEMAN_CONFIG, defaultMode: "off" });
			expect(readFileSync(rootPath, "utf8")).toBe("{invalid\n");
			expect(existsSync(packagePath)).toBe(true);
			expect(existsSync(legacyPath)).toBe(true);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("keeps explicit non-root config paths in standalone format", async () => {
		const home = makeHome();
		try {
			const configPath = path.join(home, "config.json");
			await writeCavemanConfigAtomic(
				{ ...DEFAULT_CAVEMAN_CONFIG, defaultMode: "ultracave" },
				configPath,
			);
			const loaded = await loadCavemanConfig({ configPath, homeDirectory: home, seedAssets: false });
			const persisted = JSON.parse(readFileSync(configPath, "utf8"));

			expect(loaded.config.defaultMode).toBe("ultracave");
			expect(persisted.version).toBeUndefined();
			expect(persisted.defaultMode).toBe("ultracave");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("fails closed to off for removed or unknown default values", () => {
		for (const raw of [
			{ defaultMode: "full" },
			{ defaultMode: "wenyan-full" },
			{ defaultMode: "ultra" },
			{ defaultLevel: "full" },
			{ defaultLevel: "caveman" },
		]) {
			const warnings: string[] = [];
			expect(normalizeCavemanConfig(raw, message => warnings.push(message)).defaultMode).toBe("off");
			expect(warnings).toHaveLength(1);
		}
		for (const mode of CAVEMAN_MODES) {
			expect(normalizeCavemanConfig({ defaultMode: mode }).defaultMode).toBe(mode);
		}
		expect(normalizeCavemanConfig({}).defaultMode).toBe("caveman");
	});

	it("fails closed to off when a root document still uses defaultLevel", async () => {
		const home = makeHome();
		try {
			writeJson(getCodesookOmpConfigPath(home), {
				version: 1,
				display: { caveman: { visible: true } },
				behavior: { caveman: { defaultLevel: "ultra" } },
			});
			const warnings: string[] = [];
			const loaded = await loadCavemanConfig({ homeDirectory: home, seedAssets: false, onWarning: message => warnings.push(message) });
			expect(loaded.config.defaultMode).toBe("off");
			expect(warnings).toHaveLength(1);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("seeds one static packaged frame and preserves existing glyph files", async () => {
		const home = makeHome();
		try {
			const packageAssetDirectory = path.join(home, "package-assets");
			const glyphDirectory = path.join(home, "glyphs");
			mkdirSync(packageAssetDirectory, { recursive: true });
			for (const mode of CAVEMAN_ACTIVE_MODES) {
				writeFileSync(path.join(packageAssetDirectory, `${mode}.txt`), "fps=12\nfirst\n\nsecond\n", "utf8");
			}
			mkdirSync(glyphDirectory, { recursive: true });
			const preservedPath = path.join(glyphDirectory, "caveman.txt");
			writeFileSync(preservedPath, "custom\n", "utf8");
			const config = {
				...DEFAULT_CAVEMAN_CONFIG,
				display: { ...DEFAULT_CAVEMAN_CONFIG.display, glyphDirectory },
			};

			const created = await seedMissingCavemanGlyphs(config, { packageAssetDirectory });

			expect(created).toHaveLength(CAVEMAN_ACTIVE_MODES.length - 1);
			expect(readFileSync(preservedPath, "utf8")).toBe("custom\n");
			for (const mode of CAVEMAN_ACTIVE_MODES) {
				const text = readFileSync(path.join(glyphDirectory, `${mode}.txt`), "utf8");
				if (mode === "caveman") {
					expect(text).toBe("custom\n");
					continue;
				}
				expect(text).toBe("first\n");
				const sequence = parseFrameSequenceAsset(text);
				expect(sequence?.frames).toEqual([["first"]]);
				expect(sequence?.fps).toBeUndefined();
			}
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
