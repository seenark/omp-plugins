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

export type PonytailMode = "off" | "lite" | "full" | "ultra" | "review";
export type StatusSegmentName = "ponytail" | "headroom";

export interface PonytailStatus {
	active: boolean;
	mode: PonytailMode;
}

export interface DisplayValues {
	glyph: string;
	state: DisplayState;
	label: string;
	compressionPercent: number;
	tokensSaved: number;
	tokensBefore: number;
	tokensAfter: number;
	proxyStatus: string;
	error: string;
}

export interface HeadroomDisplayConfig {
	visible?: boolean;
	glyphDirectory?: string;
	template?: string;
	status?: Partial<Record<DisplayState, string>>;
}

export interface PonytailDisplayConfig {
	visible?: boolean;
	nativeVisible?: boolean;
	glyphDirectory?: string;
	template?: string;
}

export interface DisplayConfig {
	order?: StatusSegmentName[];
	separator?: string;
	segments?: {
		headroom?: HeadroomDisplayConfig;
		ponytail?: PonytailDisplayConfig;
	};
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
export const DEFAULT_PONYTAIL_GLYPH_DIRECTORY = "~/.config/codesook-omp/ponytail";
export const DEFAULT_PONYTAIL_TEMPLATE = "{activity} {glyph} ponytail: {modeIcon}{mode}";
export const DEFAULT_HEADROOM_SEGMENT_TEMPLATE = "{status}";

export const DEFAULT_TEMPLATES: Record<DisplayState, string> = {
	off: "{glyph} Headroom off",
	"remote-blocked": "{glyph} Headroom remote blocked",
	starting: "{glyph} Headroom starting",
	offline: "{glyph} Headroom not running",
	idle: "{glyph} Headroom idle",
	online: "{glyph} Headroom",
	compressed: "{glyph} Headroom -{compressionPercent}% ({tokensSaved} saved)",
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
	order: ["ponytail", "headroom"],
	separator: "  ",
	segments: {
		ponytail: {
			visible: true,
			nativeVisible: false,
			glyphDirectory: DEFAULT_PONYTAIL_GLYPH_DIRECTORY,
			template: DEFAULT_PONYTAIL_TEMPLATE,
		},
		headroom: {
			visible: true,
			glyphDirectory: DEFAULT_GLYPH_DIRECTORY,
			template: DEFAULT_HEADROOM_SEGMENT_TEMPLATE,
			status: { ...DEFAULT_TEMPLATES },
		},
	},
};

export function isDisplayVisible(config: DisplayConfig): boolean {
	return config.segments?.headroom?.visible !== false;
}

export function isPonytailDisplayVisible(config: DisplayConfig): boolean {
	return config.segments?.ponytail?.visible !== false;
}

export function isPonytailNativeVisible(config: DisplayConfig): boolean {
	return config.segments?.ponytail?.nativeVisible === true;
}

export function isStatusSegmentEnabled(config: DisplayConfig, segment: StatusSegmentName): boolean {
	const order = config.order ?? DEFAULT_DISPLAY_CONFIG.order!;
	const visible =
		segment === "headroom" ? isDisplayVisible(config) : isPonytailDisplayVisible(config);
	return visible && order.includes(segment);
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

export function normalizeDisplayConfig(raw: unknown): DisplayConfig {
	const parsed =
		typeof raw === "object" && raw !== null && !Array.isArray(raw)
			? (raw as Record<string, unknown>)
			: {};
	const wrappedHeadroom = parsed.headroom;
	const root =
		!("segments" in parsed) &&
		typeof wrappedHeadroom === "object" &&
		wrappedHeadroom !== null &&
		!Array.isArray(wrappedHeadroom)
			? (wrappedHeadroom as Record<string, unknown>)
			: parsed;
	const rawSegments = root.segments;
	const segments =
		typeof rawSegments === "object" && rawSegments !== null && !Array.isArray(rawSegments)
			? (rawSegments as Record<string, unknown>)
			: undefined;
	const rawHeadroom = segments?.headroom;
	const headroom =
		typeof rawHeadroom === "object" && rawHeadroom !== null && !Array.isArray(rawHeadroom)
			? (rawHeadroom as Record<string, unknown>)
			: root;
	const rawPonytail = segments?.ponytail ?? root.ponytail;
	const ponytail =
		typeof rawPonytail === "object" && rawPonytail !== null && !Array.isArray(rawPonytail)
			? (rawPonytail as Record<string, unknown>)
			: {};
	const candidateStatus = headroom.status ?? headroom.templates;
	const rawStatus =
		typeof candidateStatus === "object" && candidateStatus !== null && !Array.isArray(candidateStatus)
			? (candidateStatus as Record<string, unknown>)
			: {};
	const status = { ...DEFAULT_TEMPLATES };
	for (const state of DISPLAY_STATES) {
		const template = rawStatus[state];
		if (typeof template === "string") status[state] = template.replaceAll("{icon}", "{glyph}");
	}
	const order = Array.isArray(root.order)
		? [...new Set(root.order.filter((item): item is StatusSegmentName => item === "ponytail" || item === "headroom"))]
		: [...DEFAULT_DISPLAY_CONFIG.order!];
	const legacySeparator = typeof ponytail.separator === "string" ? ponytail.separator : undefined;

	return {
		order,
		separator: typeof root.separator === "string" ? root.separator : legacySeparator ?? "  ",
		segments: {
			ponytail: {
				visible: typeof ponytail.visible === "boolean" ? ponytail.visible : true,
				nativeVisible: ponytail.nativeVisible === true,
				glyphDirectory:
					typeof ponytail.glyphDirectory === "string"
						? ponytail.glyphDirectory
						: DEFAULT_PONYTAIL_GLYPH_DIRECTORY,
				template:
					typeof ponytail.template === "string"
						? ponytail.template.replaceAll("{icon}", "{glyph}")
						: DEFAULT_PONYTAIL_TEMPLATE,
			},
			headroom: {
				visible: typeof headroom.visible === "boolean" ? headroom.visible : true,
				glyphDirectory:
					typeof headroom.glyphDirectory === "string"
						? headroom.glyphDirectory
						: DEFAULT_GLYPH_DIRECTORY,
				template:
					typeof headroom.template === "string"
						? headroom.template.replaceAll("{icon}", "{glyph}")
						: DEFAULT_HEADROOM_SEGMENT_TEMPLATE,
				status,
			},
		},
	};
}

export function loadDisplayConfig(configPath = DISPLAY_CONFIG_PATH): DisplayConfig {
	try {
		return normalizeDisplayConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
	} catch {
		return normalizeDisplayConfig({});
	}
}

export function writeDisplaySegmentVisibility(
	segment: StatusSegmentName,
	visible: boolean,
	configPath = DISPLAY_CONFIG_PATH,
): DisplayConfig {
	const config = loadDisplayConfig(configPath);
	if (segment === "headroom") config.segments!.headroom!.visible = visible;
	else config.segments!.ponytail!.visible = visible;
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
	return config;
}

export function writePonytailNativeVisibility(
	visible: boolean,
	configPath = DISPLAY_CONFIG_PATH,
): DisplayConfig {
	const config = loadDisplayConfig(configPath);
	config.segments!.ponytail!.nativeVisible = visible;
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
	return config;
}

export interface GlyphAsset {
	frames: string[];
	fps?: number;
}

function loadGlyphAssetFile(glyphDirectory: string, name: string): GlyphAsset {
	try {
		const source = fs.readFileSync(path.join(expandHome(glyphDirectory), `${name}.txt`), "utf8");
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

export function loadGlyphAsset(state: DisplayState, config: DisplayConfig = DEFAULT_DISPLAY_CONFIG): GlyphAsset {
	return loadGlyphAssetFile(config.segments?.headroom?.glyphDirectory ?? DEFAULT_GLYPH_DIRECTORY, state);
}

export function loadGlyphFrames(state: DisplayState, config: DisplayConfig = {}): string[] {
	return loadGlyphAsset(state, config).frames;
}

export function loadGlyph(
	state: DisplayState,
	config: DisplayConfig = DEFAULT_DISPLAY_CONFIG,
	fallback = DEFAULT_GLYPHS[state],
	frame = 0,
): string {
	const frames = loadGlyphFrames(state, config);
	return frames.length > 0 ? frames[Math.abs(frame) % frames.length]! : fallback;
}

export function renderDisplay(
	state: DisplayState,
	values: Omit<DisplayValues, "glyph" | "state">,
	config: DisplayConfig = loadDisplayConfig(),
	fallbackGlyph = DEFAULT_GLYPHS[state],
	frame = 0,
	glyphFrames?: readonly string[],
): string {
	const glyph =
		glyphFrames === undefined
			? loadGlyph(state, config, fallbackGlyph, frame)
			: glyphFrames.length > 0
				? glyphFrames[Math.abs(frame) % glyphFrames.length]!
				: fallbackGlyph;
	const all: DisplayValues = { ...values, glyph, state };
	const segment = config.segments?.headroom;
	const statusTemplate = segment?.status?.[state] ?? DEFAULT_TEMPLATES[state];
	const status = statusTemplate.replace(
		/\{(glyph|state|label|compressionPercent|tokensSaved|tokensBefore|tokensAfter|proxyStatus|error)\}/g,
		(_, key: keyof DisplayValues) => {
			const value = all[key];
			return typeof value === "number" ? value.toLocaleString() : value;
		},
	);
	return (segment?.template ?? DEFAULT_HEADROOM_SEGMENT_TEMPLATE).replace(
		/\{(status|glyph|state|label|compressionPercent|tokensSaved|tokensBefore|tokensAfter|proxyStatus|error)\}/g,
		(_, key: "status" | keyof DisplayValues) => {
			if (key === "status") return status;
			const value = all[key];
			return typeof value === "number" ? value.toLocaleString() : value;
		},
	);
}

const PONYTAIL_MODE_ICONS: Record<PonytailMode, string> = {
	off: "",
	lite: "🌿 ",
	full: "⚡ ",
	ultra: "🔥 ",
	review: "",
};

export function parsePonytailStatus(text: string | undefined): PonytailStatus | undefined {
	if (text === undefined) return undefined;
	if (text.length === 0) return { active: false, mode: "off" };
	const plain = text.replace(/\x1b\[[0-9;:]*m/gu, "");
	const match = /([○●])?.*\b(off|lite|full|ultra|review)\s*$/iu.exec(plain);
	if (!match) return undefined;
	return {
		active: match[1] === "●",
		mode: match[2]!.toLowerCase() as PonytailMode,
	};
}

export function resolvePonytailSessionStatus(entries: readonly unknown[]): PonytailStatus | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index] as { type?: unknown; customType?: unknown; data?: { mode?: unknown } } | undefined;
		if (entry?.type !== "custom" || entry.customType !== "ponytail-mode" || typeof entry.data?.mode !== "string") continue;
		const mode = entry.data.mode.trim().toLowerCase();
		if (mode === "off" || mode === "lite" || mode === "full" || mode === "ultra" || mode === "review") {
			return { active: false, mode };
		}
	}
	return undefined;
}

export function loadPonytailGlyphAsset(status: PonytailStatus, config: DisplayConfig): GlyphAsset {
	return loadGlyphAssetFile(
		config.segments?.ponytail?.glyphDirectory ?? DEFAULT_PONYTAIL_GLYPH_DIRECTORY,
		status.mode,
	);
}

export function renderPonytailDisplay(
	status: PonytailStatus,
	config: DisplayConfig,
	frame = 0,
	glyphFrames?: readonly string[],
): string {
	if (status.mode === "off" || !isPonytailDisplayVisible(config)) return "";
	const frames = glyphFrames ?? loadPonytailGlyphAsset(status, config).frames;
	const values = {
		activity: status.active ? "●" : "○",
		glyph: frames.length > 0 ? frames[Math.abs(frame) % frames.length]! : "🐴",
		mode: status.mode.toUpperCase(),
		modeIcon: PONYTAIL_MODE_ICONS[status.mode],
	};
	return (config.segments?.ponytail?.template ?? DEFAULT_PONYTAIL_TEMPLATE).replace(
		/\{(activity|glyph|mode|modeIcon)\}/g,
		(_, key: keyof typeof values) => values[key],
	);
}

export function renderStatusSegments(headroom: string, ponytail: string, config: DisplayConfig): string {
	const text: Record<StatusSegmentName, string> = { headroom, ponytail };
	return (config.order ?? DEFAULT_DISPLAY_CONFIG.order!)
		.filter((segment) => isStatusSegmentEnabled(config, segment) && text[segment])
		.map((segment) => text[segment])
		.join(config.separator ?? "  ");
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
