import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const CODESOOK_OMP_CONFIG_PATH = path.join(os.homedir(), ".config", "codesook-omp", "config.json");
export const CODESOOK_OMP_CONFIG_CHANGED = "codesook/omp-plugin-config/v1";

export type CodesookOmpConfig = {
	version: 1;
	display: Record<string, unknown>;
	behavior: Record<string, unknown>;
};

export type CodesookOmpConfigReadResult = {
	exists: boolean;
	valid: boolean;
	value: CodesookOmpConfig;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function defaultCodesookOmpConfig(): CodesookOmpConfig {
	return { version: 1, display: {}, behavior: {} };
}

function isCodesookOmpConfig(value: unknown): value is CodesookOmpConfig {
	return isRecord(value) && value.version === 1 && isRecord(value.display) && isRecord(value.behavior);
}

function invalidConfigResult(exists: boolean): CodesookOmpConfigReadResult {
	return { exists, valid: !exists, value: defaultCodesookOmpConfig() };
}

function isMissingFileError(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT";
}

export function readCodesookOmpConfig(
	configPath = CODESOOK_OMP_CONFIG_PATH,
): CodesookOmpConfigReadResult {
	let raw: string;
	try {
		raw = readFileSync(configPath, "utf8");
	} catch (error) {
		return invalidConfigResult(!isMissingFileError(error));
	}

	try {
		const parsed: unknown = JSON.parse(raw);
		return isCodesookOmpConfig(parsed)
			? { exists: true, valid: true, value: parsed }
			: invalidConfigResult(true);
	} catch {
		return invalidConfigResult(true);
	}
}

export function writeCodesookOmpConfig(
	config: CodesookOmpConfig,
	configPath = CODESOOK_OMP_CONFIG_PATH,
): void {
	const directory = path.dirname(configPath);
	mkdirSync(directory, { recursive: true });
	const temporaryPath = path.join(directory, `.${path.basename(configPath)}.${process.pid}.${randomUUID()}.tmp`);
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
		renameSync(temporaryPath, configPath);
	} catch (error) {
		try {
			rmSync(temporaryPath, { force: true });
		} catch {
			// Preserve original write/rename error.
		}
		throw error;
	}
}

export function updateCodesookOmpConfig(
	mutator: (config: CodesookOmpConfig) => void,
	configPath = CODESOOK_OMP_CONFIG_PATH,
): CodesookOmpConfig {
	const current = readCodesookOmpConfig(configPath);
	if (current.exists && !current.valid) {
		throw new Error(`Invalid Codesook OMP config: ${configPath}`);
	}
	const next = structuredClone(current.value);
	mutator(next);
	writeCodesookOmpConfig(next, configPath);
	return next;
}
export type CodesookOmpConfigGroup = "display" | "behavior";

export function readCodesookOmpSection<T = unknown>(
	config: CodesookOmpConfig,
	group: CodesookOmpConfigGroup,
	key: string,
): T | undefined {
	return config[group][key] as T | undefined;
}

export function updateCodesookOmpSection(
	group: CodesookOmpConfigGroup,
	key: string,
	value: unknown,
	configPath = CODESOOK_OMP_CONFIG_PATH,
): CodesookOmpConfig {
	return updateCodesookOmpConfig(config => {
		config[group][key] = structuredClone(value);
	}, configPath);
}
