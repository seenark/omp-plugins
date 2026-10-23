import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	CODESOOK_OMP_CONFIG_PATH,
	readCodesookOmpConfig,
} from "@codesook/omp-shared-display/config-store";
import {
	parseFrameSequenceAsset,
	type BlockFrame,
	type FrameSequence,
} from "@codesook/omp-shared-display/client";

export type DisplayState = "off" | "remote-blocked" | "starting" | "loading" | "offline" | "unavailable" | "idle" | "online" | "compressed";

export const DISPLAY_STATES: readonly DisplayState[] = [
	"off",
	"remote-blocked",
	"starting",
	"loading",
	"offline",
	"unavailable",
	"idle",
	"online",
	"compressed",
];

/** Compression/Headroom Savings values are per Agent Session; `last*` describe the latest call. */
export interface DisplayValues {
	glyph: string;
	state: DisplayState;
	label: string;
	compressionPercent: number;
	tokensSaved: number;
	tokensBefore: number;
	tokensAfter: number;
	lastPercent: number;
	lastSaved: number;
	proxyStatus: string;
	error: string;
	reason: string;
}

export interface HeadroomDisplayConfig {
	visible: boolean;
	glyphDirectory: string;
	template: string;
	status: Record<DisplayState, string>;
}

const HEADROOM_CONFIG_FILE = CODESOOK_OMP_CONFIG_PATH;
export const GLYPH_DIR = path.join(os.homedir(), ".config", "codesook-omp", "headroom");
export const DEFAULT_GLYPH_DIRECTORY = "~/.config/codesook-omp/headroom";
export const DEFAULT_HEADROOM_SEGMENT_TEMPLATE = "{status}";

export const DEFAULT_TEMPLATES: Record<DisplayState, string> = {
	off: "{glyph} Headroom off",
	"remote-blocked": "{glyph} Headroom remote blocked",
	starting: "{glyph} Headroom starting",
	loading: "{glyph} Headroom loading",
	offline: "{glyph} Headroom not running",
	unavailable: "{glyph} Headroom unavailable ({reason})",
	idle: "{glyph} Headroom idle",
	online: "{glyph} Headroom",
	compressed: "{glyph} Headroom {tokensSaved} saved",
};

export const DEFAULT_GLYPHS: Record<DisplayState, string> = {
	off: "○",
	"remote-blocked": "⚠",
	starting: "⏳",
	loading: "⏳",
	offline: "○",
	unavailable: "⚠",
	idle: "○",
	online: "✓",
	compressed: "✓",
};

export const DEFAULT_DISPLAY_CONFIG: HeadroomDisplayConfig = {
	visible: true,
	glyphDirectory: DEFAULT_GLYPH_DIRECTORY,
	template: DEFAULT_HEADROOM_SEGMENT_TEMPLATE,
	status: { ...DEFAULT_TEMPLATES },
};

export function isDisplayVisible(config: HeadroomDisplayConfig | { display?: HeadroomDisplayConfig }): boolean {
	if ("visible" in config) return config.visible !== false;
	return config.display?.visible !== false;
}

export function resolveThemeGlyph(theme: unknown, state: DisplayState): string {
	const symbol = (theme as { symbol?: unknown } | null)?.symbol;
	if (typeof symbol !== "function") return DEFAULT_GLYPHS[state];
	try {
		const glyph = (symbol as (key: string) => unknown).call(theme, THEME_GLYPH_KEYS[state]);
		return typeof glyph === "string" && glyph.trim() ? glyph : DEFAULT_GLYPHS[state];
	} catch {
		return DEFAULT_GLYPHS[state];
	}
}

export function normalizeDisplayConfig(raw: unknown): HeadroomDisplayConfig {
	const source = asObject(raw);
	const wrapped = asObject(source?.display);
	const root = wrapped ?? source ?? {};
	const legacySegments = asObject(root.segments);
	const legacyHeadroom = asObject(legacySegments?.headroom) ?? asObject(root.headroom) ?? root;
	const rawStatus = asObject(legacyHeadroom.status) ?? asObject(legacyHeadroom.templates) ?? asObject(root.status) ?? {};
	const status = { ...DEFAULT_TEMPLATES };
	for (const state of DISPLAY_STATES) {
		const template = rawStatus[state];
		if (typeof template === "string") status[state] = template.replaceAll("{icon}", "{glyph}");
	}

	const glyphDirectory =
		typeof legacyHeadroom.glyphDirectory === "string" && legacyHeadroom.glyphDirectory.trim()
			? legacyHeadroom.glyphDirectory.trim()
			: DEFAULT_GLYPH_DIRECTORY;
	return {
		visible: typeof legacyHeadroom.visible === "boolean" ? legacyHeadroom.visible : true,
		glyphDirectory,
		template: typeof legacyHeadroom.template === "string" ? legacyHeadroom.template.replaceAll("{icon}", "{glyph}") : DEFAULT_HEADROOM_SEGMENT_TEMPLATE,
		status,
	};
}

export function loadDisplayConfig(configPath = HEADROOM_CONFIG_FILE): HeadroomDisplayConfig {
	if (path.resolve(configPath) === path.resolve(CODESOOK_OMP_CONFIG_PATH)) {
		const destination = readCodesookOmpConfig(configPath);
		return destination.valid ? normalizeDisplayConfig(destination.value.display.headroom) : normalizeDisplayConfig({});
	}
	try {
		return normalizeDisplayConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
	} catch {
		return normalizeDisplayConfig({});
	}
}
export interface GlyphAsset {
	frames: readonly BlockFrame[];
	fps?: number;
}

export function loadGlyphAsset(
	state: DisplayState,
	config: HeadroomDisplayConfig = DEFAULT_DISPLAY_CONFIG,
	fallback = DEFAULT_GLYPHS[state],
): GlyphAsset {
	const userAsset = readGlyphAssetFile(config.glyphDirectory, state);
	if (userAsset) return userAsset;
	return { frames: [[fallback]] };
}

export function loadGlyphFrames(
	state: DisplayState,
	config: HeadroomDisplayConfig = DEFAULT_DISPLAY_CONFIG,
	fallback = DEFAULT_GLYPHS[state],
): readonly BlockFrame[] {
	return loadGlyphAsset(state, config, fallback).frames;
}

export function loadGlyph(
	state: DisplayState,
	config: HeadroomDisplayConfig = DEFAULT_DISPLAY_CONFIG,
	fallback = DEFAULT_GLYPHS[state],
	frame = 0,
): string {
	const frames = loadGlyphFrames(state, config, fallback);
	return frameRows(frames[Math.abs(frame) % frames.length] ?? [fallback]);
}

export function renderDisplay(
	state: DisplayState,
	values: Omit<DisplayValues, "glyph" | "state">,
	config: HeadroomDisplayConfig = DEFAULT_DISPLAY_CONFIG,
	fallbackGlyph = DEFAULT_GLYPHS[state],
	frame = 0,
	glyphFrames?: readonly BlockFrame[] | readonly string[],
): string {
	const frames = glyphFrames === undefined ? loadGlyphFrames(state, config, fallbackGlyph) : coerceFrames(glyphFrames);
	const selected = frames[Math.abs(frame) % frames.length] ?? [fallbackGlyph];
	return renderDisplayFrame(state, values, config, frameRows(selected), fallbackGlyph);
}

/** Build the complete source snapshot; Shared Display, not Headroom, selects frames. */
export function renderDisplayFrames(
	state: DisplayState,
	values: Omit<DisplayValues, "glyph" | "state">,
	config: HeadroomDisplayConfig,
	fallbackGlyph: string,
	asset: GlyphAsset,
): FrameSequence {
	const frames = asset.frames.length > 0 ? asset.frames : [[fallbackGlyph]];
	const rendered = frames.map((frame) => renderDisplayFrame(state, values, config, frameRows(frame), fallbackGlyph).split("\n"));
	return asset.fps === undefined ? { frames: rendered } : { frames: rendered, fps: asset.fps };
}

export interface WidgetStateInput {
	enabled: boolean;
	blocked: boolean;
	starting: boolean;
	online: boolean | null;
	unavailable: boolean;
	checking?: boolean;
	saved: boolean;
}

export function widgetState({ enabled, blocked, starting, online, unavailable, checking = false, saved }: WidgetStateInput): DisplayState {
	if (!enabled) return "off";
	if (blocked) return "remote-blocked";
	if (starting) return "starting";
	if (online === false) return "offline";
	if (unavailable) return "unavailable";
	if (online === null && checking) return "loading";
	if (online === true) return saved ? "compressed" : "online";
	return "idle";
}

const TEMPLATE_KEY = /\{(status|glyph|state|label|compressionPercent|tokensSaved|tokensBefore|tokensAfter|lastPercent|lastSaved|proxyStatus|error|reason)\}/g;

/** Compact count: 950, 1.2k, 3.4M. */
export function formatCompact(value: number): string {
	const n = Math.max(0, Math.round(value));
	const units = [[1e9, "B"], [1e6, "M"], [1e3, "k"]] as const;
	let index = units.findIndex(([size]) => n >= size);
	if (index < 0) return String(n);
	const scale = (i: number) => Math.round((n / units[i][0]) * 10) / 10;
	if (scale(index) >= 1000 && index > 0) index--;
	return `${scale(index)}${units[index][1]}`;
}

function renderDisplayFrame(
	state: DisplayState,
	values: Omit<DisplayValues, "glyph" | "state">,
	config: HeadroomDisplayConfig,
	glyph: string,
	fallbackGlyph: string,
): string {
	const all: DisplayValues & { status?: string } = { ...values, glyph: glyph || fallbackGlyph, state };
	const fill = (template: string): string =>
		template.replace(TEMPLATE_KEY, (match, key: keyof typeof all) => {
			const value = all[key];
			if (value === undefined) return match;
			if (typeof value !== "number") return value;
			return key === "compressionPercent" || key === "lastPercent" ? String(Math.round(value)) : formatCompact(value);
		});
	all.status = fill(config.status[state] ?? DEFAULT_TEMPLATES[state]);
	return fill(config.template);
}

function readGlyphAssetFile(directory: string, state: DisplayState): GlyphAsset | undefined {
	try {
		const parsed = parseFrameSequenceAsset(fs.readFileSync(path.join(expandHome(directory), `${state}.txt`), "utf8"));
		if (!parsed) return undefined;
		return {
			frames: parsed.frames.map((frame) => [...frame]),
			fps: parsed.fps,
		};
	} catch {
		return undefined;
	}
}

function frameRows(frame: BlockFrame): string {
	return frame.join("\n");
}

function coerceFrames(frames: readonly BlockFrame[] | readonly string[]): readonly BlockFrame[] {
	return frames.map((frame) => (typeof frame === "string" ? [frame] : frame));
}

function expandHome(rawPath: string): string {
	if (rawPath === "~") return os.homedir();
	if (rawPath.startsWith("~/")) return path.join(os.homedir(), rawPath.slice(2));
	return rawPath;
}

function asObject(value: unknown): Record<string, any> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, any>) : undefined;
}

const THEME_GLYPH_KEYS: Record<DisplayState, string> = {
	off: "status.disabled",
	"remote-blocked": "status.warning",
	starting: "status.pending",
	loading: "status.pending",
	offline: "status.aborted",
	idle: "status.shadowed",
	online: "status.success",
	compressed: "status.success",
	unavailable: "status.warning",
};

