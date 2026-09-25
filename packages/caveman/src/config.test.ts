import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseFrameSequenceAsset } from "@codesook/omp-shared-display/client";
import {
	CAVEMAN_ACTIVE_LEVELS,
	DEFAULT_CAVEMAN_CONFIG,
	getCodesookOmpConfigPath,
	getLegacyPackageConfigPath,
} from "./types.ts";
import { loadCavemanConfig, seedMissingCavemanGlyphs, writeCavemanConfigAtomic } from "./config.ts";

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
				defaultLevel: "lite",
				nativeVisible: true,
				display: { visible: false, template: "package", glyphDirectory: "glyphs" },
			});
			writeJson(legacyPath, { defaultLevel: "ultra", showStatus: false });

			const loaded = await loadCavemanConfig({ homeDirectory: home, seedAssets: false });

			expect(loaded.config).toEqual({
				defaultLevel: "lite",
				nativeVisible: true,
				display: { visible: false, template: "package", glyphDirectory: "glyphs" },
			});
			expect(JSON.parse(readFileSync(rootPath, "utf8"))).toEqual({
				version: 1,
				display: {
					caveman: { visible: false, template: "package", glyphDirectory: "glyphs", nativeVisible: true },
				},
				behavior: { caveman: { defaultLevel: "lite" } },
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
			writeJson(packagePath, { defaultLevel: "lite" });
			mkdirSync(path.dirname(legacyPath), { recursive: true });
			writeFileSync(legacyPath, "{invalid\n", "utf8");

			const loaded = await loadCavemanConfig({ homeDirectory: home, seedAssets: false });

			expect(loaded.config.defaultLevel).toBe("lite");
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
			writeJson(packagePath, { defaultLevel: "full", nativeVisible: true, display: { visible: false } });
			writeJson(legacyPath, { defaultLevel: "ultra", showStatus: false });

			const loaded = await loadCavemanConfig({ homeDirectory: home, seedAssets: false });
			const root = JSON.parse(readFileSync(rootPath, "utf8"));

			expect(loaded.config.defaultLevel).toBe("full");
			expect(loaded.config.display.visible).toBe(false);
			expect(root.display.other).toEqual({ keep: true });
			expect(root.display.caveman.nativeVisible).toBe(true);
			expect(root.behavior.caveman.defaultLevel).toBe("full");
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
			writeJson(packagePath, { defaultLevel: "lite" });
			writeJson(legacyPath, { defaultLevel: "ultra" });

			const loaded = await loadCavemanConfig({ homeDirectory: home, seedAssets: false });

			expect(loaded.config).toEqual(DEFAULT_CAVEMAN_CONFIG);
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
				{ ...DEFAULT_CAVEMAN_CONFIG, defaultLevel: "ultra" },
				configPath,
			);
			const loaded = await loadCavemanConfig({ configPath, homeDirectory: home, seedAssets: false });
			const persisted = JSON.parse(readFileSync(configPath, "utf8"));

			expect(loaded.config.defaultLevel).toBe("ultra");
			expect(persisted.version).toBeUndefined();
			expect(persisted.defaultLevel).toBe("ultra");
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
			for (const level of CAVEMAN_ACTIVE_LEVELS) {
				writeFileSync(path.join(packageAssetDirectory, `${level}.txt`), "fps=12\nfirst\n\nsecond\n", "utf8");
			}
			mkdirSync(glyphDirectory, { recursive: true });
			const preservedPath = path.join(glyphDirectory, "full.txt");
			writeFileSync(preservedPath, "custom\n", "utf8");
			const config = {
				...DEFAULT_CAVEMAN_CONFIG,
				display: { ...DEFAULT_CAVEMAN_CONFIG.display, glyphDirectory },
			};

			const created = await seedMissingCavemanGlyphs(config, { packageAssetDirectory });

			expect(created).toHaveLength(CAVEMAN_ACTIVE_LEVELS.length - 1);
			expect(readFileSync(preservedPath, "utf8")).toBe("custom\n");
			for (const level of CAVEMAN_ACTIVE_LEVELS) {
				const text = readFileSync(path.join(glyphDirectory, `${level}.txt`), "utf8");
				if (level === "full") {
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
