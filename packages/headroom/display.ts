import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type DisplayState = "off" | "remote-blocked" | "starting" | "offline" | "idle" | "online" | "compressed";
export const DISPLAY_STATES: readonly DisplayState[] = [
	"off",
	"remote-blocked",
	"starting",
	"offline",
	"idle",
	"online",
	"compressed",
];

export interface DisplayValues {
	icon: string;
	state: DisplayState;
	label: string;
	compressionPercent: number;
	tokensSaved: number;
	tokensBefore: number;
	tokensAfter: number;
	proxyStatus: string;
	error: string;
}

export interface DisplayConfig {
	visible?: boolean;
	status?: Partial<Record<DisplayState, string>>;
	templates?: Partial<Record<DisplayState, string>>;
	glyphDirectory?: string;
}

export const DISPLAY_CONFIG_PATH = path.join(
	os.homedir(),
	".config",
	"codesook-omp",
	"headroom",
	"display-config.json",
);
export const GLYPH_DIR = path.join(os.homedir(), ".config", "codesook-omp", "headroom");
export const DEFAULT_GLYPH_DIRECTORY = "~/.config/codesook-omp/headroom";

export const DEFAULT_TEMPLATES: Record<DisplayState, string> = {
	off: "{icon} Headroom off",
	"remote-blocked": "{icon} Headroom remote blocked",
	starting: "{icon} Headroom starting",
	offline: "{icon} Headroom not running",
	idle: "{icon} Headroom idle",
	online: "{icon} Headroom",
	compressed: "{icon} Headroom -{compressionPercent}% ({tokensSaved} saved)",
};
export const DEFAULT_GLYPHS: Record<DisplayState, string> = {
	off: "○",
	"remote-blocked": "⚠",
	starting: "⏳",
	offline: "○",
	idle: "○",
	online: "✓",
	compressed: "✓",
};
export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
	visible: true,
	glyphDirectory: DEFAULT_GLYPH_DIRECTORY,
	status: { ...DEFAULT_TEMPLATES },
};

export function isDisplayVisible(config: DisplayConfig): boolean {
	return config.visible !== false;
}

const THEME_GLYPH_KEYS: Record<DisplayState, string> = {
	off: "status.disabled",
	"remote-blocked": "status.warning",
	starting: "status.pending",
	offline: "status.aborted",
	idle: "status.shadowed",
	online: "status.success",
	compressed: "status.success",
};

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

export function loadDisplayConfig(configPath = DISPLAY_CONFIG_PATH): DisplayConfig {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		if ("headroom" in parsed) {
			const headroom = parsed.headroom;
			return headroom && typeof headroom === "object" && !Array.isArray(headroom)
				? (headroom as DisplayConfig)
				: {};
		}
		return parsed as DisplayConfig;
	} catch {
		return {};
	}
}

export interface GlyphAsset {
	frames: string[];
	fps?: number;
}

export function loadGlyphAsset(state: DisplayState, config: DisplayConfig = {}): GlyphAsset {
	const glyphDirectory = expandHome(config.glyphDirectory ?? GLYPH_DIR);
	try {
		const source = fs.readFileSync(path.join(glyphDirectory, `${state}.txt`), "utf8");
		const lines = source.split(/\r?\n/);
		const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0);
		let fps: number | undefined;
		if (firstNonEmptyIndex >= 0) {
			const directive = /^fps=(.*)$/.exec(lines[firstNonEmptyIndex]!.trim());
			if (directive) {
				const candidate = Number(directive[1]!.trim());
				if (Number.isFinite(candidate) && candidate > 0) fps = candidate;
				lines.splice(firstNonEmptyIndex, 1);
			}
		}

		const body = lines.join("\n");
		if (!body.trim()) return { frames: [], fps: undefined };
		const frames = /\r?\n[ \t]*\r?\n/.test(body)
			? body
					.split(/\r?\n[ \t]*\r?\n/)
					.map((frame) => frame.trim())
					.filter(Boolean)
			: body.trim().split(/\s+/).filter(Boolean);
		return { frames, fps };
	} catch {
		return { frames: [], fps: undefined };
	}
}

export function loadGlyphFrames(state: DisplayState, config: DisplayConfig = {}): string[] {
	return loadGlyphAsset(state, config).frames;
}

export function loadGlyph(
	state: DisplayState,
	config: DisplayConfig = {},
	fallback = DEFAULT_GLYPHS[state],
	frame = 0,
): string {
	const frames = loadGlyphFrames(state, config);
	return frames.length > 0 ? frames[Math.abs(frame) % frames.length]! : fallback;
}

export function renderDisplay(
	state: DisplayState,
	values: Omit<DisplayValues, "icon" | "state">,
	config: DisplayConfig = loadDisplayConfig(),
	fallbackGlyph = DEFAULT_GLYPHS[state],
	frame = 0,
	glyphFrames?: readonly string[],
): string {
	const icon =
		glyphFrames === undefined
			? loadGlyph(state, config, fallbackGlyph, frame)
			: glyphFrames.length > 0
				? glyphFrames[Math.abs(frame) % glyphFrames.length]!
				: fallbackGlyph;
	const all: DisplayValues = { ...values, icon, state };
	const templates = config.status ?? config.templates ?? {};
	const template = templates[state] ?? DEFAULT_TEMPLATES[state];
	return template.replace(
		/\{(icon|state|label|compressionPercent|tokensSaved|tokensBefore|tokensAfter|proxyStatus|error)\}/g,
		(_, key: keyof DisplayValues) => {
			const value = all[key];
			return typeof value === "number" ? value.toLocaleString() : value;
		},
	);
}

function expandHome(rawPath: string): string {
	if (rawPath === "~") return os.homedir();
	if (rawPath.startsWith("~/")) return path.join(os.homedir(), rawPath.slice(2));
	return rawPath;
}

export function widgetState(
	enabled: boolean,
	blocked: boolean,
	starting: boolean,
	online: boolean | null,
	compressed: boolean,
): DisplayState {
	if (!enabled) return "off";
	if (blocked) return "remote-blocked";
	if (starting) return "starting";
	if (online === false) return "offline";
	if (compressed) return "compressed";
	if (online === true) return "online";
	return "idle";
}

export const displayPaths = { DISPLAY_CONFIG_PATH, GLYPH_DIR };
