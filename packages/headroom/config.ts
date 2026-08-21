import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HeadroomConfig } from "./types.ts";

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
} satisfies Required<Omit<HeadroomSettings, "url">>;

export const HEADROOM_SETTINGS_DIR = path.join(os.homedir(), ".config", "codesook-omp", "headroom");
export const HEADROOM_SETTINGS_FILE = path.join(HEADROOM_SETTINGS_DIR, "settings.json");
export const LEGACY_HEADROOM_SETTINGS_DIR = path.join(os.homedir(), ".pi", "agent", "headroom");
export const LEGACY_HEADROOM_SETTINGS_FILE = path.join(LEGACY_HEADROOM_SETTINGS_DIR, "settings.json");
export const HEADROOM_SETTINGS_PATHS = [HEADROOM_SETTINGS_FILE, LEGACY_HEADROOM_SETTINGS_FILE] as const;

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
}

export function loadHeadroomSettings(settingsPath: string = HEADROOM_SETTINGS_FILE): HeadroomSettings {
	return readSettingsFile(settingsPath) ?? {};
}

export function loadHeadroomSettingsWithFallback(
	settingsPaths: readonly string[] = HEADROOM_SETTINGS_PATHS,
): HeadroomSettings {
	for (const settingsPath of settingsPaths) {
		const settings = readSettingsFile(settingsPath);
		if (settings) return settings;
	}
	return {};
}

export function loadHeadroomConfig(
	env: NodeJS.ProcessEnv = process.env,
	settings: HeadroomSettings = env === process.env ? loadHeadroomSettingsWithFallback() : {},
): HeadroomConfig {
	const envBaseUrl = firstParsed(
		[env.PI_HEADROOM_URL, env.HEADROOM_URL, env.HEADROOM_BASE_URL],
		parseUrlValue,
	);
	const baseUrl = normalizeBaseUrl(
		envBaseUrl ?? parseUrlValue(settings.baseUrl ?? settings.url) ?? DEFAULT_HEADROOM_SETTINGS.baseUrl,
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
		enabled: envEnabled ?? parseBoolean(settings.enabled, DEFAULT_HEADROOM_SETTINGS.enabled),
		baseUrl,
		allowRemote: envAllowRemote ?? parseBoolean(settings.allowRemote, DEFAULT_HEADROOM_SETTINGS.allowRemote),
		autoStart: envAutoStart ?? parseBoolean(settings.autoStart, DEFAULT_HEADROOM_SETTINGS.autoStart),
		command: envCommand ?? parseString(settings.command, DEFAULT_HEADROOM_SETTINGS.command),
		minContextTokens:
			envMinContextTokens ??
			parseInteger(settings.minContextTokens, DEFAULT_HEADROOM_SETTINGS.minContextTokens, 0),
		minMessageChars:
			envMinMessageChars ?? parseInteger(settings.minMessageChars, DEFAULT_HEADROOM_SETTINGS.minMessageChars, 1),
		timeoutMs: envTimeoutMs ?? parseInteger(settings.timeoutMs, DEFAULT_HEADROOM_SETTINGS.timeoutMs, 100),
	};
}

export function isLocalHeadroomUrl(rawUrl: string): boolean {
	try {
		const url = new URL(rawUrl);
		return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
	} catch {
		return false;
	}
}

export function isRemoteBlocked(config: Pick<HeadroomConfig, "baseUrl" | "allowRemote">): boolean {
	return !config.allowRemote && !isLocalHeadroomUrl(config.baseUrl);
}

function readSettingsFile(settingsPath: string): HeadroomSettings | undefined {
	try {
		const raw = fs.readFileSync(settingsPath, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as HeadroomSettings;
	} catch {
		// Missing or invalid settings.json lets the next candidate/defaults win.
	}
	return undefined;
}


function firstParsed<T>(rawValues: readonly unknown[], parser: (raw: unknown) => T | undefined): T | undefined {
	for (const raw of rawValues) {
		const parsed = parser(raw);
		if (parsed !== undefined) return parsed;
	}
	return undefined;
}

function normalizeBaseUrl(raw: string): string {
	const trimmed = raw.trim() || DEFAULT_HEADROOM_SETTINGS.baseUrl;
	return trimmed.replace(/\/+$/, "");
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
		return value;
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
	const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
	if (!Number.isFinite(parsed) || parsed < min) return undefined;
	return Math.trunc(parsed);
}

function parseInteger(raw: unknown, fallback: number, min: number): number {
	return parseIntegerValue(raw, min) ?? fallback;
}
