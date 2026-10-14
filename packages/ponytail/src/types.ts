import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CODESOOK_OMP_CONFIG_PATH } from "@codesook/omp-shared-display/config-store";

/** Upstream hooks/ponytail-config.js RUNTIME_MODES: what a user can set and what a default can be. */
export const PONYTAIL_RUNTIME_MODES = ["off", "lite", "full", "ultra"] as const;
/** Upstream VALID_MODES: `review` is only ever read back from a session entry, never set or defaulted. */
export const PONYTAIL_MODES = [...PONYTAIL_RUNTIME_MODES, "review"] as const;

export type PonytailRuntimeMode = (typeof PONYTAIL_RUNTIME_MODES)[number];
export type PonytailMode = (typeof PONYTAIL_MODES)[number];

export interface PonytailDisplayConfig {
	visible: boolean;
	template: string;
	glyphDirectory: string;
}

export interface PonytailConfig {
	defaultMode: PonytailRuntimeMode;
	nativeVisible: boolean;
	display: PonytailDisplayConfig;
}

export const DEFAULT_PONYTAIL_GLYPH_DIRECTORY = "~/.config/codesook-omp/ponytail";
export const DEFAULT_PONYTAIL_TEMPLATE = "{activity} {glyph} ponytail: {modeIcon}{mode}";
export const DEFAULT_PONYTAIL_CONFIG: Readonly<PonytailConfig> = {
	defaultMode: "full",
	nativeVisible: false,
	display: {
		visible: true,
		template: DEFAULT_PONYTAIL_TEMPLATE,
		glyphDirectory: DEFAULT_PONYTAIL_GLYPH_DIRECTORY,
	},
};

export const CONFIG_PATH = CODESOOK_OMP_CONFIG_PATH;
export function getCodesookOmpConfigPath(homeDirectory: string = os.homedir()): string {
	return path.join(homeDirectory, ".config", "codesook-omp", "config.json");
}
export const DEFAULT_SKILL_DIRECTORY = fileURLToPath(new URL("../skills", import.meta.url));
export const PACKAGE_ASSET_DIRECTORY = fileURLToPath(new URL("../assets", import.meta.url));

export function isPonytailRuntimeMode(value: unknown): value is PonytailRuntimeMode {
	return typeof value === "string" && (PONYTAIL_RUNTIME_MODES as readonly string[]).includes(value);
}

export function isPonytailMode(value: unknown): value is PonytailMode {
	return typeof value === "string" && (PONYTAIL_MODES as readonly string[]).includes(value);
}

/** Upstream normalizeMode: trimmed, lower-cased runtime mode, else null. */
export function normalizeRuntimeMode(value: unknown): PonytailRuntimeMode | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	return isPonytailRuntimeMode(normalized) ? normalized : null;
}

/** Upstream normalizePersistedMode: a runtime mode, or `review` from an older session entry. */
export function normalizePersistedMode(value: unknown): PonytailMode | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	return isPonytailMode(normalized) ? normalized : null;
}

export function clonePonytailConfig(config: PonytailConfig): PonytailConfig {
	return {
		defaultMode: config.defaultMode,
		nativeVisible: config.nativeVisible,
		display: { ...config.display },
	};
}

export function expandHomePath(rawPath: string, homeDirectory: string = os.homedir()): string {
	if (rawPath === "~") return homeDirectory;
	if (rawPath.startsWith("~/")) return path.join(homeDirectory, rawPath.slice(2));
	return rawPath;
}
