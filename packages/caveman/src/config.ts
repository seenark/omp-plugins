import * as fs from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
	readCodesookOmpConfig,
	updateCodesookOmpConfig,
} from "@codesook/omp-shared-display/config-store";
import { parseFrameSequenceAsset } from "@codesook/omp-shared-display/client";
import {
	CAVEMAN_LEVELS,
	CONFIG_PATH,
	DEFAULT_CAVEMAN_CONFIG,
	DEFAULT_GLYPH_DIRECTORY,
	PACKAGE_ASSET_DIRECTORY,
	cloneCavemanConfig,
	expandHomePath,
	getCodesookOmpConfigPath,
	getLegacyConfigPath,
	getLegacyPackageConfigPath,
	isCavemanLevel,
	isRecord,
	type CavemanActiveLevel,
	type CavemanConfig,
} from "./types.ts";

export type CavemanWarning = (message: string) => void;

export interface CavemanConfigLoadOptions {
	configPath?: string;
	legacyConfigPath?: string;
	legacyPackageConfigPath?: string;
	env?: NodeJS.ProcessEnv;
	homeDirectory?: string;
	packageAssetDirectory?: string;
	onWarning?: CavemanWarning;
	seedAssets?: boolean;
}

export interface CavemanConfigLoadResult {
	config: CavemanConfig;
	configPath: string;
	legacyConfigPath: string;
	destinationExists: boolean;
	migrated: boolean;
}

const ACTIVE_LEVELS = CAVEMAN_LEVELS.filter(level => level !== "off") as readonly CavemanActiveLevel[];

function hasOwn(record: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(record, key);
}

function validSingleLineNonempty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0 && !/[\r\n]/.test(value);
}

function warn(onWarning: CavemanWarning | undefined, message: string): void {
	onWarning?.(message);
}

function isRootConfigPath(configPath: string, options: CavemanConfigLoadOptions = {}): boolean {
	const injectedRoot = getCodesookOmpConfigPath(options.homeDirectory);
	return (
		options.configPath === undefined ||
		path.resolve(configPath) === path.resolve(injectedRoot) ||
		path.resolve(configPath) === path.resolve(CONFIG_PATH)
	);
}

function isRootWritePath(configPath: string): boolean {
	return (
		path.resolve(configPath) === path.resolve(CONFIG_PATH) ||
		path.normalize(configPath).endsWith(`${path.sep}.config${path.sep}codesook-omp${path.sep}config.json`)
	);
}

function isCodesookOmpConfig(value: unknown): value is { version: 1; display: Record<string, unknown>; behavior: Record<string, unknown> } {
	return isRecord(value) && value.version === 1 && isRecord(value.display) && isRecord(value.behavior);
}

function normalizeRootCavemanConfig(raw: unknown, onWarning?: CavemanWarning): CavemanConfig {
	const source = isCodesookOmpConfig(raw) ? raw : undefined;
	const displayRoot = source && isRecord(source.display.caveman) ? source.display.caveman : {};
	const displayConfig = isRecord(displayRoot.display) ? displayRoot.display : displayRoot;
	const behaviorRoot = source && isRecord(source.behavior.caveman) ? source.behavior.caveman : {};
	const standalone: Record<string, unknown> = {
		nativeVisible: displayRoot.nativeVisible,
		display: displayConfig,
	};
	if (hasOwn(behaviorRoot, "defaultLevel")) standalone.defaultLevel = behaviorRoot.defaultLevel;
	return normalizeCavemanConfig(standalone, onWarning);
}

function rootCavemanSections(config: CavemanConfig): {
	display: Record<string, unknown>;
	behavior: Record<string, unknown>;
} {
	return {
		display: {
			...config.display,
			nativeVisible: config.nativeVisible,
		},
		behavior: { defaultLevel: config.defaultLevel },
	};
}

export function normalizeCavemanConfig(raw: unknown, onWarning?: CavemanWarning): CavemanConfig {
	const source = isRecord(raw) ? raw : {};
	let defaultLevel: CavemanConfig["defaultLevel"] = "full";
	if (hasOwn(source, "defaultLevel")) {
		if (isCavemanLevel(source.defaultLevel)) defaultLevel = source.defaultLevel;
		else {
			defaultLevel = "off";
			warn(onWarning, "Caveman config has a noncanonical defaultLevel; using off.");
		}
	}

	const displaySource = isRecord(source.display) ? source.display : {};
	return {
		defaultLevel,
		nativeVisible: typeof source.nativeVisible === "boolean" ? source.nativeVisible : false,
		display: {
			visible: typeof displaySource.visible === "boolean" ? displaySource.visible : true,
			template: validSingleLineNonempty(displaySource.template)
				? displaySource.template
				: DEFAULT_CAVEMAN_CONFIG.display.template,
			glyphDirectory: validSingleLineNonempty(displaySource.glyphDirectory)
				? displaySource.glyphDirectory.trim()
				: DEFAULT_GLYPH_DIRECTORY,
		},
	};
}

export function normalizeLegacyCavemanConfig(raw: unknown, onWarning?: CavemanWarning): CavemanConfig {
	const source = isRecord(raw) ? raw : {};
	let defaultLevel: CavemanConfig["defaultLevel"] = "full";
	if (hasOwn(source, "defaultLevel") && typeof source.defaultLevel === "string") {
		if (source.defaultLevel === "wenyan") defaultLevel = "wenyan-full";
		else if (isCavemanLevel(source.defaultLevel)) defaultLevel = source.defaultLevel;
		else {
			defaultLevel = "off";
			warn(onWarning, "Legacy Caveman config has a noncanonical defaultLevel; using off.");
		}
	}
	const nativeVisible = typeof source.showStatus === "boolean" ? source.showStatus : true;
	return {
		...cloneCavemanConfig(DEFAULT_CAVEMAN_CONFIG),
		defaultLevel,
		nativeVisible,
	};
}

export function validateCavemanConfig(config: unknown): string | undefined {
	if (!isRecord(config)) return "Caveman config must be an object.";
	if (!isCavemanLevel(config.defaultLevel)) return "Default level must be canonical Caveman level or off.";
	if (typeof config.nativeVisible !== "boolean") return "Native visibility must be on or off.";
	if (!isRecord(config.display)) return "Display config is required.";
	if (typeof config.display.visible !== "boolean") return "Display visibility must be on or off.";
	if (!validSingleLineNonempty(config.display.template)) return "Display template must be nonempty and single-line.";
	if (!validSingleLineNonempty(config.display.glyphDirectory)) return "Glyph directory must be nonempty and single-line.";
	return undefined;
}

export function serializeCavemanConfig(config: CavemanConfig): string {
	return `${JSON.stringify(cloneCavemanConfig(config), null, 2)}\n`;
}

export async function writeCavemanConfigAtomic(config: CavemanConfig, configPath = CONFIG_PATH): Promise<void> {
	const error = validateCavemanConfig(config);
	if (error) throw new Error(error);
	if (isRootWritePath(configPath)) {
		const sections = rootCavemanSections(config);
		updateCodesookOmpConfig(current => {
			current.display.caveman = sections.display;
			current.behavior.caveman = sections.behavior;
		}, configPath);
		return;
	}
	const directory = path.dirname(configPath);
	const temporaryPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
	await mkdir(directory, { recursive: true });
	try {
		await writeFile(temporaryPath, serializeCavemanConfig(config), { encoding: "utf8", flag: "wx" });
		await rename(temporaryPath, configPath);
	} catch (error) {
		try {
			await unlink(temporaryPath);
		} catch {
			// Best effort cleanup. Preserve original write/rename error.
		}
		throw error;
	}
}

async function readJsonFile(filePath: string): Promise<{ exists: boolean; value?: unknown; error?: unknown }> {
	try {
		const text = await readFile(filePath, "utf8");
		try {
			return { exists: true, value: JSON.parse(text) };
		} catch (error) {
			return { exists: true, error };
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
		return { exists: true, error };
	}
}

export async function seedMissingCavemanGlyphs(
	config: CavemanConfig,
	options: Pick<CavemanConfigLoadOptions, "homeDirectory" | "packageAssetDirectory"> = {},
): Promise<string[]> {
	const homeDirectory = options.homeDirectory;
	const glyphDirectory = expandHomePath(config.display.glyphDirectory, homeDirectory);
	const packageDirectory = options.packageAssetDirectory ?? PACKAGE_ASSET_DIRECTORY;
	const created: string[] = [];
	for (const level of ACTIVE_LEVELS) {
		const destination = path.join(glyphDirectory, `${level}.txt`);
		if (fs.existsSync(destination)) continue;
		const source = path.join(packageDirectory, `${level}.txt`);
		const sequence = parseFrameSequenceAsset(await readFile(source, "utf8"));
		const firstFrame = sequence?.frames[0];
		if (firstFrame === undefined) throw new Error(`Invalid packaged Caveman glyph asset: ${source}`);
		const content = `${firstFrame.join("\n")}\n`;
		await mkdir(path.dirname(destination), { recursive: true });
		try {
			await writeFile(destination, content, { encoding: "utf8", flag: "wx" });
			created.push(destination);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	return created;
}

async function deleteImportedConfigs(paths: readonly string[], onWarning?: CavemanWarning): Promise<void> {
	for (const filePath of new Set(paths)) {
		try {
			await unlink(filePath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				warn(onWarning, `Unable to remove imported Caveman config at ${filePath}: ${String(error)}`);
			}
		}
	}
}

function hasRootCavemanSection(
	root: { display: Record<string, unknown>; behavior: Record<string, unknown> },
	group: "display" | "behavior",
): boolean {
	return isRecord(root[group].caveman);
}

interface LegacyCavemanDiscovery {
	config?: CavemanConfig;
	imported: boolean;
	paths: readonly string[];
}

async function discoverLegacyCavemanConfig(
	options: CavemanConfigLoadOptions,
	legacyConfigPath: string,
): Promise<LegacyCavemanDiscovery> {
	const packageConfigPath = options.legacyPackageConfigPath ?? getLegacyPackageConfigPath(options.homeDirectory);
	const packageConfig = await readJsonFile(packageConfigPath);
	const legacy = await readJsonFile(legacyConfigPath);
	const importedPaths: string[] = [];
	let config: CavemanConfig | undefined;
	if (packageConfig.exists && packageConfig.error === undefined && isRecord(packageConfig.value)) {
		config = normalizeCavemanConfig(packageConfig.value, options.onWarning);
		importedPaths.push(packageConfigPath);
	} else if (packageConfig.exists) {
		warn(
			options.onWarning,
			packageConfig.error !== undefined
				? `Unable to parse legacy Caveman config at ${packageConfigPath}; trying next legacy path.`
				: `Legacy Caveman config at ${packageConfigPath} is not an object; trying next legacy path.`,
		);
	}
	if (legacy.exists && legacy.error === undefined && isRecord(legacy.value)) {
		if (config === undefined) config = normalizeLegacyCavemanConfig(legacy.value, options.onWarning);
		importedPaths.push(legacyConfigPath);
	} else if (config === undefined && legacy.exists) {
		warn(
			options.onWarning,
			legacy.error !== undefined
				? `Unable to parse legacy Caveman config at ${legacyConfigPath}; using defaults.`
				: `Legacy Caveman config at ${legacyConfigPath} is not an object; using defaults.`,
		);
	}
	return {
		config,
		imported: config !== undefined,
		paths: importedPaths,
	};
}

async function loadRootCavemanConfig(
	options: CavemanConfigLoadOptions,
	configPath: string,
	legacyConfigPath: string,
): Promise<CavemanConfigLoadResult> {
	const destination = readCodesookOmpConfig(configPath);
	if (destination.exists && !destination.valid) {
		warn(options.onWarning, `Unable to parse Caveman config at ${configPath}; using defaults.`);
		return {
			config: cloneCavemanConfig(DEFAULT_CAVEMAN_CONFIG),
			configPath,
			legacyConfigPath,
			destinationExists: true,
			migrated: false,
		};
	}
	if (destination.exists && hasRootCavemanSection(destination.value, "display") && hasRootCavemanSection(destination.value, "behavior")) {
		return {
			config: normalizeRootCavemanConfig(destination.value, options.onWarning),
			configPath,
			legacyConfigPath,
			destinationExists: true,
			migrated: false,
		};
	}

	const legacy = await discoverLegacyCavemanConfig(options, legacyConfigPath);
	if (destination.exists) {
		const root = destination.value;
		const missingDisplay = !hasRootCavemanSection(root, "display");
		const missingBehavior = !hasRootCavemanSection(root, "behavior");
		if (!legacy.imported || (!missingDisplay && !missingBehavior)) {
			return {
				config: normalizeRootCavemanConfig(root, options.onWarning),
				configPath,
				legacyConfigPath,
				destinationExists: true,
				migrated: false,
			};
		}

		const sections = rootCavemanSections(legacy.config!);
		const merged = structuredClone(root);
		if (missingDisplay) merged.display.caveman = sections.display;
		if (missingBehavior) merged.behavior.caveman = sections.behavior;
		const config = normalizeRootCavemanConfig(merged, options.onWarning);
		try {
			updateCodesookOmpConfig(current => {
				if (missingDisplay) current.display.caveman = sections.display;
				if (missingBehavior) current.behavior.caveman = sections.behavior;
			}, configPath);
			await deleteImportedConfigs(legacy.paths, options.onWarning);
			if (options.seedAssets !== false) await seedMissingCavemanGlyphs(config, options);
			return { config, configPath, legacyConfigPath, destinationExists: true, migrated: true };
		} catch (error) {
			warn(options.onWarning, `Unable to update Caveman config at ${configPath}: ${String(error)}`);
			return { config, configPath, legacyConfigPath, destinationExists: true, migrated: false };
		}
	}

	const config = legacy.config ?? cloneCavemanConfig(DEFAULT_CAVEMAN_CONFIG);
	let migrated = false;
	try {
		const sections = rootCavemanSections(config);
		updateCodesookOmpConfig(current => {
			current.display.caveman = sections.display;
			current.behavior.caveman = sections.behavior;
		}, configPath);
		migrated = true;
		if (legacy.imported) await deleteImportedConfigs(legacy.paths, options.onWarning);
		if (options.seedAssets !== false) await seedMissingCavemanGlyphs(config, options);
	} catch (error) {
		warn(options.onWarning, `Unable to create Caveman config at ${configPath}: ${String(error)}`);
	}
	return { config, configPath, legacyConfigPath, destinationExists: false, migrated };
}

export async function loadCavemanConfig(options: CavemanConfigLoadOptions = {}): Promise<CavemanConfigLoadResult> {
	const configPath = options.configPath ?? getCodesookOmpConfigPath(options.homeDirectory);
	const legacyConfigPath = options.legacyConfigPath ?? getLegacyConfigPath(options.env, options.homeDirectory);
	if (isRootConfigPath(configPath, options)) return loadRootCavemanConfig(options, configPath, legacyConfigPath);

	const destination = await readJsonFile(configPath);
	if (destination.exists) {
		if (destination.error !== undefined || !isRecord(destination.value)) {
			warn(options.onWarning, `Unable to parse Caveman config at ${configPath}; using defaults.`);
			return {
				config: cloneCavemanConfig(DEFAULT_CAVEMAN_CONFIG),
				configPath,
				legacyConfigPath,
				destinationExists: true,
				migrated: false,
			};
		}
		return {
			config: normalizeCavemanConfig(destination.value, options.onWarning),
			configPath,
			legacyConfigPath,
			destinationExists: true,
			migrated: false,
		};
	}

	const legacy = await readJsonFile(legacyConfigPath);
	let config: CavemanConfig;
	if (legacy.exists && legacy.error !== undefined) {
		warn(options.onWarning, `Unable to parse legacy Caveman config at ${legacyConfigPath}; using defaults.`);
		config = cloneCavemanConfig(DEFAULT_CAVEMAN_CONFIG);
	} else if (legacy.exists && !isRecord(legacy.value)) {
		warn(options.onWarning, `Legacy Caveman config at ${legacyConfigPath} is not an object; using defaults.`);
		config = cloneCavemanConfig(DEFAULT_CAVEMAN_CONFIG);
	} else if (legacy.exists) {
		config = normalizeLegacyCavemanConfig(legacy.value, options.onWarning);
	} else {
		config = cloneCavemanConfig(DEFAULT_CAVEMAN_CONFIG);
	}

	let migrated = false;
	try {
		await writeCavemanConfigAtomic(config, configPath);
		migrated = true;
		if (options.seedAssets !== false) await seedMissingCavemanGlyphs(config, options);
	} catch (error) {
		warn(options.onWarning, `Unable to create Caveman config at ${configPath}: ${String(error)}`);
	}
	return { config, configPath, legacyConfigPath, destinationExists: false, migrated };
}

export function normalizeCavemanRootConfig(raw: unknown, onWarning?: CavemanWarning): CavemanConfig | undefined {
	return isCodesookOmpConfig(raw) ? normalizeRootCavemanConfig(raw, onWarning) : undefined;
}
