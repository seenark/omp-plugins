import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import {
	isRecord,
	readCodesookOmpConfig,
	updateCodesookOmpConfig,
	type CodesookOmpConfig,
} from "@codesook/omp-shared-display/config-store";
import {
	DEFAULT_PONYTAIL_CONFIG,
	PACKAGE_ASSET_DIRECTORY,
	PONYTAIL_MODES,
	clonePonytailConfig,
	expandHomePath,
	getCodesookOmpConfigPath,
	isPonytailRuntimeMode,
	normalizeRuntimeMode,
	type PonytailConfig,
} from "./types.ts";

export type PonytailWarning = (message: string) => void;

export interface PonytailConfigLoadOptions {
	configPath?: string;
	homeDirectory?: string;
	onWarning?: PonytailWarning;
}

function singleLineNonempty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0 && !/[\r\n]/.test(value);
}

/** Unparseable config must never silently enable Ponytail: the default mode fails closed to off. */
function failClosedConfig(): PonytailConfig {
	return { ...clonePonytailConfig(DEFAULT_PONYTAIL_CONFIG), defaultMode: "off" };
}

/** Fields come from `behavior.ponytail.defaultMode` and `display.ponytail`; anything else keeps its default. */
export function normalizePonytailConfig(raw: unknown, onWarning?: PonytailWarning): PonytailConfig {
	const source = isRecord(raw) ? raw : {};
	const display = isRecord(source.display) ? source.display : {};
	let defaultMode = DEFAULT_PONYTAIL_CONFIG.defaultMode;
	if (Object.hasOwn(source, "defaultMode")) {
		if (isPonytailRuntimeMode(source.defaultMode)) defaultMode = source.defaultMode;
		else {
			defaultMode = "off";
			onWarning?.("Ponytail config has an invalid defaultMode; using off.");
		}
	}
	return {
		defaultMode,
		nativeVisible: typeof source.nativeVisible === "boolean" ? source.nativeVisible : DEFAULT_PONYTAIL_CONFIG.nativeVisible,
		display: {
			visible: typeof display.visible === "boolean" ? display.visible : DEFAULT_PONYTAIL_CONFIG.display.visible,
			template: singleLineNonempty(display.template) ? display.template : DEFAULT_PONYTAIL_CONFIG.display.template,
			glyphDirectory: singleLineNonempty(display.glyphDirectory)
				? display.glyphDirectory.trim()
				: DEFAULT_PONYTAIL_CONFIG.display.glyphDirectory,
		},
	};
}

/** Read the Ponytail fields out of a root config document; undefined when `raw` is not one (version 1 with display and behavior objects). */
export function normalizePonytailRootConfig(raw: unknown, onWarning?: PonytailWarning): PonytailConfig | undefined {
	if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.display) || !isRecord(raw.behavior)) return undefined;
	const root = raw as CodesookOmpConfig;
	const displayRoot = isRecord(root.display.ponytail) ? root.display.ponytail : {};
	const behaviorRoot = isRecord(root.behavior.ponytail) ? root.behavior.ponytail : {};
	return normalizePonytailConfig(
		{
			...(Object.hasOwn(behaviorRoot, "defaultMode") ? { defaultMode: behaviorRoot.defaultMode } : {}),
			nativeVisible: displayRoot.nativeVisible,
			display: displayRoot,
		},
		onWarning,
	);
}

export function validatePonytailConfig(config: unknown): string | undefined {
	if (!isRecord(config)) return "Ponytail config must be an object.";
	if (!isPonytailRuntimeMode(config.defaultMode)) return "Default mode must be off, lite, full, or ultra.";
	if (typeof config.nativeVisible !== "boolean") return "Native visibility must be on or off.";
	if (!isRecord(config.display)) return "Display config is required.";
	if (typeof config.display.visible !== "boolean") return "Display visibility must be on or off.";
	if (!singleLineNonempty(config.display.template)) return "Display template must be nonempty and single-line.";
	if (!singleLineNonempty(config.display.glyphDirectory)) return "Glyph directory must be nonempty and single-line.";
	return undefined;
}

export function loadPonytailConfig(options: PonytailConfigLoadOptions = {}): { config: PonytailConfig; configPath: string } {
	const configPath = options.configPath ?? getCodesookOmpConfigPath(options.homeDirectory);
	const root = readCodesookOmpConfig(configPath);
	if (root.exists && !root.valid) {
		options.onWarning?.(`Unable to parse Ponytail config at ${configPath}; Ponytail stays off until it is fixed.`);
		return { config: failClosedConfig(), configPath };
	}
	return { config: normalizePonytailRootConfig(root.value, options.onWarning) ?? failClosedConfig(), configPath };
}

/**
 * Upstream documents PONYTAIL_DEFAULT_MODE as the highest-priority default (ponytail-help skill, README).
 * Only a runtime mode counts; anything else falls through to the config.
 */
export function envDefaultMode(env: NodeJS.ProcessEnv = process.env): PonytailConfig["defaultMode"] | null {
	return normalizeRuntimeMode(env.PONYTAIL_DEFAULT_MODE);
}

/** `/ponytail default <mode>`: change only `behavior.ponytail.defaultMode`. Throws on an invalid root file. */
export function writePonytailDefaultMode(mode: PonytailConfig["defaultMode"], configPath = getCodesookOmpConfigPath()): void {
	updateCodesookOmpConfig(root => {
		root.behavior.ponytail = { ...(isRecord(root.behavior.ponytail) ? root.behavior.ponytail : {}), defaultMode: mode };
	}, configPath);
}

/** Write the validated config into the root document, keeping every unrelated key. Throws on an invalid root file. */
export function writePonytailConfig(config: PonytailConfig, configPath = getCodesookOmpConfigPath()): void {
	const error = validatePonytailConfig(config);
	if (error) throw new Error(error);
	updateCodesookOmpConfig(root => {
		root.display.ponytail = { ...config.display, nativeVisible: config.nativeVisible };
		root.behavior.ponytail = { defaultMode: config.defaultMode };
	}, configPath);
}

/** Copy every packaged glyph the user directory lacks; never overwrites. Returns the files created. */
export async function seedMissingPonytailGlyphs(
	glyphDirectory: string,
	packageAssetDirectory = PACKAGE_ASSET_DIRECTORY,
	homeDirectory?: string,
): Promise<string[]> {
	const directory = expandHomePath(glyphDirectory, homeDirectory);
	await mkdir(directory, { recursive: true });
	const created: string[] = [];
	for (const mode of PONYTAIL_MODES) {
		const destination = path.join(directory, `${mode}.txt`);
		try {
			await copyFile(path.join(packageAssetDirectory, `${mode}.txt`), destination, constants.COPYFILE_EXCL);
			created.push(destination);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	return created;
}
