import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	DEFAULT_PROMPT_BORDER_CONFIG,
	ensurePromptBorderConfigFile,
	getPromptBorderArgumentCompletions,
	isBorderLayoutName,
	isBorderStyleName,
	normalizePromptBorderConfig,
	parsePromptBorderArgs,
	readPromptBorderConfig,
	writePromptBorderConfig,
	writePromptBorderConfigSelection,
} from "./main.ts";

describe("Prompt Border destination config", () => {
	it("normalizes and atomically round-trips the package-owned schema", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-prompt-border-config-"));
		const configPath = path.join(root, "prompt-border", "config.json");
		try {
			const config = normalizePromptBorderConfig({ promptBorder: { style: "round", layout: "sides" } });
			await writePromptBorderConfig(config, configPath);
			const saved = await readPromptBorderConfig(configPath);
			expect(saved.style).toBe("round");
			expect(saved.layout).toBe("sides");
			expect(fs.existsSync(configPath)).toBe(true);
			expect(isBorderStyleName(saved.style)).toBe(true);
			expect(isBorderLayoutName(saved.layout)).toBe(true);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("migrates legacy inline config and adjacent asset bytes only when destination is missing", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-prompt-border-migration-"));
		const legacyConfigPath = path.join(root, "legacy", "config.json");
		const legacyAssetDirectory = path.dirname(legacyConfigPath);
		const destinationPath = path.join(root, "prompt-border", "config.json");
		const leftAssetPath = path.join(legacyAssetDirectory, "prompt-border-left-glyphs.txt");
		const legacyBytes = "LEGACY\n";
		try {
			fs.mkdirSync(legacyAssetDirectory, { recursive: true });
			fs.writeFileSync(legacyConfigPath, JSON.stringify({ promptBorder: { style: "round", layout: "bottom", leftGlyph: { glyphs: "INLINE" } } }));
			fs.writeFileSync(leftAssetPath, legacyBytes);
			const migrated = await ensurePromptBorderConfigFile({ destinationPath, legacyConfigPath, legacyAssetDirectory });
			expect(migrated.style).toBe("round");
			expect(migrated.layout).toBe("bottom");
			expect(migrated.leftGlyph.frames).toEqual(["LEGACY"]);
			expect(fs.readFileSync(path.join(path.dirname(destinationPath), "prompt-border-left-glyphs.txt"), "utf8")).toBe(legacyBytes);
			expect(fs.readFileSync(legacyConfigPath, "utf8")).toContain("INLINE");
			fs.writeFileSync(legacyConfigPath, JSON.stringify({ promptBorder: { style: "ascii" } }));
			const second = await ensurePromptBorderConfigFile({ destinationPath, legacyConfigPath, legacyAssetDirectory });
			expect(second.style).toBe("round");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps behavior command grammar and rejects removed config ownership", () => {
		expect(parsePromptBorderArgs("config", DEFAULT_PROMPT_BORDER_CONFIG)).toEqual({ kind: "invalid" });
		expect(parsePromptBorderArgs("round bottom", DEFAULT_PROMPT_BORDER_CONFIG)).toEqual({ kind: "apply", state: { style: "round", layout: "bottom" } });
		expect(parsePromptBorderArgs("layout nope", DEFAULT_PROMPT_BORDER_CONFIG)).toEqual({ kind: "invalid" });
		expect(getPromptBorderArgumentCompletions("layout ")?.map(item => item.value)).toContain("layout full");
		expect(getPromptBorderArgumentCompletions("unknown")).toEqual([]);
		expect(getPromptBorderArgumentCompletions("")?.map(item => item.value)).not.toContain("config");
	});

	it("writes only the selected persisted border fields", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-prompt-border-selection-"));
		const configPath = path.join(root, "config.json");
		try {
			await writePromptBorderConfig(DEFAULT_PROMPT_BORDER_CONFIG, configPath);
			await writePromptBorderConfigSelection({ style: "sharp", layout: "top-bottom" }, configPath);
			const saved = await readPromptBorderConfig(configPath);
			expect(saved.style).toBe("sharp");
			expect(saved.layout).toBe("top-bottom");
			expect(saved.contextRail.enabled).toBe(DEFAULT_PROMPT_BORDER_CONFIG.contextRail.enabled);
			expect(saved.contextRail.placement).toBe(DEFAULT_PROMPT_BORDER_CONFIG.contextRail.placement);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
