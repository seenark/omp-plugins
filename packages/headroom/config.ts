import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
	DEFAULT_DISPLAY_CONFIG,
	DEFAULT_TEMPLATES,
	normalizeDisplayConfig,
	type DisplayState,
	type HeadroomDisplayConfig,
} from "./display.ts";
import type { HeadroomConfig as OperationalHeadroomConfig } from "./types.ts";

const DEFAULT_BASE_URL = "http://127.0.0.1:8788";
const DEFAULT_MIN_CONTEXT_TOKENS = 20_000;
const DEFAULT_MIN_MESSAGE_CHARS = 2_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export const DEFAULT_HEADROOM_SETTINGS = {
	enabled: true,
	baseUrl: DEFAULT_BASE_URL,
	allowRemote: false,
	autoStart: true,
	command: "headroom",
	minContextTokens: DEFAULT_MIN_CONTEXT_TOKENS,
	minMessageChars: DEFAULT_MIN_MESSAGE_CHARS,
	timeoutMs: DEFAULT_TIMEOUT_MS,
} satisfies Required<Omit<HeadroomSettings, "url" | "display">>;

export type HeadroomConfig = OperationalHeadroomConfig & {
	display: HeadroomDisplayConfig;
};

export interface HeadroomSettings {
	enabled?: boolean | string;
	baseUrl?: string;
	url?: string;
	allowRemote?: boolean | string;
	autoStart?: boolean | string;
	command?: string;
	minContextTokens?: number | string;
	minMessageChars?: number | string;
	timeoutMs?: number | string;
	display?: unknown;
}

export interface HeadroomConfigLoadOptions {
	env?: NodeJS.ProcessEnv;
	configPath?: string;
	legacySettingsPaths?: readonly string[];
	legacyDisplayPath?: string;
	warn?: (message: string) => void;
}

export const HEADROOM_CONFIG_DIR = path.join(os.homedir(), ".config", "codesook-omp", "headroom");
export const HEADROOM_CONFIG_FILE = path.join(HEADROOM_CONFIG_DIR, "config.json");

/** Legacy operational persistence candidates, ordered by precedence. */
export const HEADROOM_SETTINGS_DIR = HEADROOM_CONFIG_DIR;
export const HEADROOM_SETTINGS_FILE = path.join(HEADROOM_SETTINGS_DIR, "settings.json");
export const LEGACY_HEADROOM_SETTINGS_DIR = path.join(os.homedir(), ".pi", "agent", "headroom");
export const LEGACY_HEADROOM_SETTINGS_FILE = path.join(LEGACY_HEADROOM_SETTINGS_DIR, "settings.json");
export const HEADROOM_SETTINGS_PATHS = [HEADROOM_SETTINGS_FILE, LEGACY_HEADROOM_SETTINGS_FILE] as const;
export const LEGACY_HEADROOM_DISPLAY_FILE = path.join(HEADROOM_CONFIG_DIR, "display-config.json");

export const DEFAULT_HEADROOM_CONFIG: HeadroomConfig = {
	...DEFAULT_HEADROOM_SETTINGS,
	display: cloneDisplayConfig(DEFAULT_DISPLAY_CONFIG),
};

/** Read one legacy settings object without warning; used by migration-aware callers. */
export function loadHeadroomSettings(settingsPath: string = HEADROOM_SETTINGS_FILE): HeadroomSettings {
	return readObjectFile(settingsPath)?.value ?? {};
}

/** Return the first valid object from the configured legacy candidates. */
export function loadHeadroomSettingsWithFallback(
	settingsPaths: readonly string[] = HEADROOM_SETTINGS_PATHS,
): HeadroomSettings {
	for (const settingsPath of settingsPaths) {
		const result = readObjectFile(settingsPath);
		if (result?.value) return result.value as HeadroomSettings;
	}
	return {};
}

/**
 * Load effective runtime configuration. The destination config wins once it
 * exists; environment values are applied after persisted values are normalized.
 * A second-argument settings object remains supported for focused callers that
 * want to bypass filesystem migration.
 */
export function loadHeadroomConfig(
	envOrOptions: NodeJS.ProcessEnv | HeadroomConfigLoadOptions = process.env,
	settings?: HeadroomSettings,
	providedOptions: HeadroomConfigLoadOptions = {},
): HeadroomConfig {
	const options = isLoadOptions(envOrOptions) ? { ...envOrOptions, ...providedOptions } : providedOptions;
	const env = isLoadOptions(envOrOptions) ? options.env ?? process.env : envOrOptions;
	const explicitSettings = settings !== undefined;
	const configPath = options.configPath ?? HEADROOM_CONFIG_FILE;
	let persisted: unknown;

	if (explicitSettings) {
		persisted = settings;
	} else if (fs.existsSync(configPath)) {
		const destination = readObjectFile(configPath);
		if (!destination?.value) {
			options.warn?.(`Headroom config is invalid: ${configPath}`);
			persisted = {};
		} else {
			persisted = destination.value;
		}
	} else {
		persisted = migrateLegacyConfig(options);
		const normalized = normalizeHeadroomConfig(persisted);
		try {
			writeHeadroomConfig(normalized, configPath);
		} catch (error) {
			options.warn?.(
				`Could not create Headroom config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		persisted = normalized;
	}

	return applyEnvironment(normalizeHeadroomConfig(persisted), env);
}

/** Normalize a persisted object without applying environment overrides. */
export function normalizeHeadroomConfig(raw: unknown): HeadroomConfig {
	const source = isRecord(raw) ? raw : {};
	const rawDisplay = isRecord(source.display) ? source.display : source;
	return {
		enabled: parseBoolean(source.enabled, DEFAULT_HEADROOM_SETTINGS.enabled),
		baseUrl: parseUrlValue(source.baseUrl ?? source.url) ?? DEFAULT_HEADROOM_SETTINGS.baseUrl,
		allowRemote: parseBoolean(source.allowRemote, DEFAULT_HEADROOM_SETTINGS.allowRemote),
		autoStart: parseBoolean(source.autoStart, DEFAULT_HEADROOM_SETTINGS.autoStart),
		command: parseString(source.command, DEFAULT_HEADROOM_SETTINGS.command),
		minContextTokens: parseInteger(source.minContextTokens, DEFAULT_HEADROOM_SETTINGS.minContextTokens, 0),
		minMessageChars: parseInteger(source.minMessageChars, DEFAULT_HEADROOM_SETTINGS.minMessageChars, 1),
		timeoutMs: parseInteger(source.timeoutMs, DEFAULT_HEADROOM_SETTINGS.timeoutMs, 100),
		display: normalizeDisplayConfig(rawDisplay),
	};
}

/** Atomically replace the unified destination with canonical normalized JSON. */
export function writeHeadroomConfig(config: unknown, configPath = HEADROOM_CONFIG_FILE): void {
	const normalized = normalizeHeadroomConfig(config);
	const directory = path.dirname(configPath);
	fs.mkdirSync(directory, { recursive: true });
	const temporaryPath = path.join(directory, `.${path.basename(configPath)}.${process.pid}.${randomUUID()}.tmp`);
	try {
		fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
		fs.renameSync(temporaryPath, configPath);
	} catch (error) {
		try {
			fs.unlinkSync(temporaryPath);
		} catch {
			// Preserve the original write error.
		}
		throw error;
	}
}

export function isLocalHeadroomUrl(rawUrl: string): boolean {
	try {
		const url = new URL(rawUrl);
		return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
	} catch {
		return false;
	}
}

export function isRemoteBlocked(config: Pick<OperationalHeadroomConfig, "baseUrl" | "allowRemote">): boolean {
	return !config.allowRemote && !isLocalHeadroomUrl(config.baseUrl);
}

function migrateLegacyConfig(options: HeadroomConfigLoadOptions): HeadroomSettings {
	const settingsPaths = options.legacySettingsPaths ?? HEADROOM_SETTINGS_PATHS;
	let operational: HeadroomSettings = {};
	for (const settingsPath of settingsPaths) {
		const result = readObjectFile(settingsPath);
		if (!result) continue;
		if (!result.value) {
			options.warn?.(`Headroom legacy settings are invalid: ${settingsPath}`);
			continue;
		}
		operational = result.value as HeadroomSettings;
		break;
	}

	const displayPath = options.legacyDisplayPath ?? LEGACY_HEADROOM_DISPLAY_FILE;
	const display = readObjectFile(displayPath);
	if (display && !display.value) options.warn?.(`Headroom legacy display config is invalid: ${displayPath}`);
	if (display?.value) operational = { ...operational, display: display.value };
	return operational;
}

function applyEnvironment(config: HeadroomConfig, env: NodeJS.ProcessEnv): HeadroomConfig {
	const envBaseUrl = firstParsed(
		[env.PI_HEADROOM_URL, env.HEADROOM_URL, env.HEADROOM_BASE_URL],
		parseUrlValue,
	);
	const envEnabled = firstParsed([env.PI_HEADROOM_ENABLED, env.HEADROOM_ENABLED], parseBooleanValue);
	const envAllowRemote = firstParsed(
		[env.PI_HEADROOM_ALLOW_REMOTE, env.HEADROOM_ALLOW_REMOTE],
		parseBooleanValue,
	);
	const envAutoStart = firstParsed([env.PI_HEADROOM_AUTO_START, env.HEADROOM_AUTO_START], parseBooleanValue);
	const envCommand = firstParsed([env.PI_HEADROOM_COMMAND, env.HEADROOM_COMMAND], parseStringValue);
	const envMinContextTokens = firstParsed(
		[env.PI_HEADROOM_MIN_CONTEXT_TOKENS, env.HEADROOM_MIN_CONTEXT_TOKENS],
		(raw) => parseIntegerValue(raw, 0),
	);
	const envMinMessageChars = firstParsed(
		[env.PI_HEADROOM_MIN_MESSAGE_CHARS, env.HEADROOM_MIN_MESSAGE_CHARS],
		(raw) => parseIntegerValue(raw, 1),
	);
	const envTimeoutMs = firstParsed(
		[env.PI_HEADROOM_TIMEOUT_MS, env.HEADROOM_TIMEOUT_MS],
		(raw) => parseIntegerValue(raw, 100),
	);

	return {
		...config,
		enabled: envEnabled ?? config.enabled,
		baseUrl: envBaseUrl ?? config.baseUrl,
		allowRemote: envAllowRemote ?? config.allowRemote,
		autoStart: envAutoStart ?? config.autoStart,
		command: envCommand ?? config.command,
		minContextTokens: envMinContextTokens ?? config.minContextTokens,
		minMessageChars: envMinMessageChars ?? config.minMessageChars,
		timeoutMs: envTimeoutMs ?? config.timeoutMs,
		display: cloneDisplayConfig(config.display),
	};
}

function readObjectFile(filePath: string): { value?: Record<string, unknown> } | undefined {
	try {
		const raw = fs.readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		return isRecord(parsed) ? { value: parsed } : {};
	} catch {
		if (!fs.existsSync(filePath)) return undefined;
		return {};
	}
}

function cloneDisplayConfig(config: HeadroomDisplayConfig): HeadroomDisplayConfig {
	return {
		visible: config.visible,
		glyphDirectory: config.glyphDirectory,
		template: config.template,
		status: Object.fromEntries(
			(Object.keys(DEFAULT_TEMPLATES) as DisplayState[]).map((state) => [state, config.status[state]]),
		) as Record<DisplayState, string>,
	};
}

function isLoadOptions(value: NodeJS.ProcessEnv | HeadroomConfigLoadOptions): value is HeadroomConfigLoadOptions {
	return (
		isRecord(value) &&
		("env" in value || "configPath" in value || "legacySettingsPaths" in value || "legacyDisplayPath" in value || "warn" in value)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstParsed<T>(rawValues: readonly unknown[], parser: (raw: unknown) => T | undefined): T | undefined {
	for (const raw of rawValues) {
		const parsed = parser(raw);
		if (parsed !== undefined) return parsed;
	}
	return undefined;
}

function parseStringValue(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const trimmed = raw.trim();
	return trimmed || undefined;
}

function parseUrlValue(raw: unknown): string | undefined {
	const value = parseStringValue(raw);
	if (!value) return undefined;
	try {
		const parsed = new URL(value);
		if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) return undefined;
		return value.replace(/\/+$/, "");
	} catch {
		return undefined;
	}
}

function parseString(raw: unknown, fallback: string): string {
	return parseStringValue(raw) ?? fallback;
}

function parseBooleanValue(raw: unknown): boolean | undefined {
	if (typeof raw === "boolean") return raw;
	if (typeof raw !== "string") return undefined;
	const normalized = raw.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return undefined;
}

function parseBoolean(raw: unknown, fallback: boolean): boolean {
	return parseBooleanValue(raw) ?? fallback;
}

function parseIntegerValue(raw: unknown, min: number): number | undefined {
	const parsed =
		typeof raw === "number"
			? raw
			: typeof raw === "string" && raw.trim() !== ""
				? Number(raw.trim())
				: Number.NaN;
	if (!Number.isSafeInteger(parsed) || parsed < min) return undefined;
	return parsed;
}

function parseInteger(raw: unknown, fallback: number, min: number): number {
	return parseIntegerValue(raw, min) ?? fallback;
}

export const __test__ = {
	parseUrlValue,
	parseBooleanValue,
	parseIntegerValue,
};
