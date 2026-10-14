import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CODESOOK_OMP_CONFIG_PATH } from "@codesook/omp-shared-display/config-store";
export const CAVEMAN_MODES = ["off", "caveman", "ultracave", "megacave"] as const;

export const CAVEMAN_ACTIVE_MODES = CAVEMAN_MODES.filter(mode => mode !== "off") as readonly Exclude<
	CavemanMode,
	"off"
>[];

export type CavemanMode = (typeof CAVEMAN_MODES)[number];
export type CavemanActiveMode = Exclude<CavemanMode, "off">;

export interface CavemanDisplayConfig {
	visible: boolean;
	template: string;
	glyphDirectory: string;
}

export interface CavemanConfig {
	defaultMode: CavemanMode;
	nativeVisible: boolean;
	display: CavemanDisplayConfig;
}

export const DEFAULT_GLYPH_DIRECTORY = "~/.config/codesook-omp/caveman/glyphs";
export const DEFAULT_TEMPLATE = "{activity} {glyph} {mode}";
export const DEFAULT_CAVEMAN_CONFIG: Readonly<CavemanConfig> = {
	defaultMode: "caveman",
	nativeVisible: false,
	display: {
		visible: true,
		template: DEFAULT_TEMPLATE,
		glyphDirectory: DEFAULT_GLYPH_DIRECTORY,
	},
};

export const CONFIG_DIRECTORY = path.join(os.homedir(), ".config", "codesook-omp", "caveman");
export const LEGACY_CONFIG_PATH = path.join(CONFIG_DIRECTORY, "config.json");
export const CONFIG_PATH = CODESOOK_OMP_CONFIG_PATH;
export function getCodesookOmpConfigPath(homeDirectory: string = os.homedir()): string {
	return path.join(homeDirectory, ".config", "codesook-omp", "config.json");
}
export function getLegacyPackageConfigPath(homeDirectory: string = os.homedir()): string {
	return path.join(homeDirectory, ".config", "codesook-omp", "caveman", "config.json");
}
export const DEFAULT_SKILL_DIRECTORY = fileURLToPath(new URL("../skills", import.meta.url));
export const PACKAGE_ASSET_DIRECTORY = fileURLToPath(new URL("../assets", import.meta.url));

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCavemanMode(value: unknown): value is CavemanMode {
	return typeof value === "string" && (CAVEMAN_MODES as readonly string[]).includes(value);
}

export function isCavemanActiveMode(value: unknown): value is CavemanActiveMode {
	return isCavemanMode(value) && value !== "off";
}

export function cloneCavemanConfig(config: CavemanConfig): CavemanConfig {
	return {
		defaultMode: config.defaultMode,
		nativeVisible: config.nativeVisible,
		display: { ...config.display },
	};
}

export function getLegacyConfigPath(
	env: NodeJS.ProcessEnv = process.env,
	homeDirectory: string = os.homedir(),
): string {
	if (env.PI_CODING_AGENT_DIR) return path.join(env.PI_CODING_AGENT_DIR, "caveman.json");
	if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, "pi", "agent", "caveman.json");
	return path.join(homeDirectory, ".pi", "agent", "caveman.json");
}

export function expandHomePath(rawPath: string, homeDirectory: string = os.homedir()): string {
	if (rawPath === "~") return homeDirectory;
	if (rawPath.startsWith("~/")) return path.join(homeDirectory, rawPath.slice(2));
	return rawPath;
}
