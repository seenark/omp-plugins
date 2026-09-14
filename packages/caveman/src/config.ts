import * as fs from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
	CAVEMAN_LEVELS,
	CONFIG_PATH,
	DEFAULT_CAVEMAN_CONFIG,
	DEFAULT_GLYPH_DIRECTORY,
	PACKAGE_ASSET_DIRECTORY,
	cloneCavemanConfig,
	expandHomePath,
	getLegacyConfigPath,
	isCavemanLevel,
	isRecord,
	type CavemanActiveLevel,
	type CavemanConfig,
} from "./types.ts";

export type CavemanWarning = (message: string) => void;

export interface CavemanConfigLoadOptions {
	configPath?: string;
	legacyConfigPath?: string;
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
		const content = await readFile(source, "utf8");
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

export async function loadCavemanConfig(options: CavemanConfigLoadOptions = {}): Promise<CavemanConfigLoadResult> {
	const homeDirectory = options.homeDirectory;
	const configPath = options.configPath ?? CONFIG_PATH;
	const legacyConfigPath = options.legacyConfigPath ?? getLegacyConfigPath(options.env, homeDirectory);
	const onWarning = options.onWarning;
	const destination = await readJsonFile(configPath);
	if (destination.exists) {
		if (destination.error !== undefined || !isRecord(destination.value)) {
			warn(onWarning, `Unable to parse Caveman config at ${configPath}; using defaults.`);
			return {
				config: cloneCavemanConfig(DEFAULT_CAVEMAN_CONFIG),
				configPath,
				legacyConfigPath,
				destinationExists: true,
				migrated: false,
			};
		}
		return {
			config: normalizeCavemanConfig(destination.value, onWarning),
			configPath,
			legacyConfigPath,
			destinationExists: true,
			migrated: false,
		};
	}

	const legacy = await readJsonFile(legacyConfigPath);
	let config: CavemanConfig;
	if (legacy.exists && legacy.error !== undefined) {
		warn(onWarning, `Unable to parse legacy Caveman config at ${legacyConfigPath}; using defaults.`);
		config = cloneCavemanConfig(DEFAULT_CAVEMAN_CONFIG);
	} else if (legacy.exists && !isRecord(legacy.value)) {
		warn(onWarning, `Legacy Caveman config at ${legacyConfigPath} is not an object; using defaults.`);
		config = cloneCavemanConfig(DEFAULT_CAVEMAN_CONFIG);
	} else if (legacy.exists) {
		config = normalizeLegacyCavemanConfig(legacy.value, onWarning);
	} else {
		config = cloneCavemanConfig(DEFAULT_CAVEMAN_CONFIG);
	}

	let migrated = false;
	try {
		await writeCavemanConfigAtomic(config, configPath);
		migrated = true;
		if (options.seedAssets !== false) {
			await seedMissingCavemanGlyphs(config, options);
		}
	} catch (error) {
		warn(onWarning, `Unable to create Caveman config at ${configPath}: ${String(error)}`);
	}
	return { config, configPath, legacyConfigPath, destinationExists: false, migrated };
}
