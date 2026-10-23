import { CODESOOK_OMP_CONFIG_PATH, isRecord, readCodesookOmpConfig } from "@codesook/omp-shared-display/config-store";

export const DEFAULT_RTK_TEMPLATE = "{glyph} rtk {tokensSaved} saved · {commands} cmds";
export const DEFAULT_RTK_GLYPH_DIRECTORY = "~/.config/codesook-omp/rtk";

export type RtkConfig = {
	enabled: boolean;
	retentionDays: number;
	display: { visible: boolean; glyphDirectory: string; template: string };
};

export function defaultRtkConfig(): RtkConfig {
	return {
		enabled: true,
		retentionDays: 7,
		display: { visible: true, glyphDirectory: DEFAULT_RTK_GLYPH_DIRECTORY, template: DEFAULT_RTK_TEMPLATE },
	};
}

const nonEmpty = (value: unknown, fallback: string): string =>
	typeof value === "string" && value.trim() ? value.trim() : fallback;

/** Read `behavior.rtk` and `display.rtk` from a whole root document; invalid fields fall back to defaults. */
export function normalizeRtkConfig(root: unknown): RtkConfig {
	const document = isRecord(root) ? root : {};
	const behavior = isRecord(document.behavior) && isRecord(document.behavior.rtk) ? document.behavior.rtk : {};
	const display = isRecord(document.display) && isRecord(document.display.rtk) ? document.display.rtk : {};
	const defaults = defaultRtkConfig();
	return {
		enabled: typeof behavior.enabled === "boolean" ? behavior.enabled : defaults.enabled,
		retentionDays:
			typeof behavior.retentionDays === "number" && Number.isSafeInteger(behavior.retentionDays) && behavior.retentionDays >= 1
				? behavior.retentionDays
				: defaults.retentionDays,
		display: {
			visible: typeof display.visible === "boolean" ? display.visible : defaults.display.visible,
			glyphDirectory: nonEmpty(display.glyphDirectory, defaults.display.glyphDirectory),
			template: nonEmpty(display.template, defaults.display.template),
		},
	};
}

export function loadRtkConfig(configPath = CODESOOK_OMP_CONFIG_PATH): RtkConfig {
	const root = readCodesookOmpConfig(configPath);
	return normalizeRtkConfig(root.valid ? root.value : {});
}
