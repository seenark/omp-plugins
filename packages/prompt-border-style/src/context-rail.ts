export const CONTEXT_RAIL_ROLES = ["speculation", "pointer", "compaction", "maximum"] as const;
export type ContextRailRole = (typeof CONTEXT_RAIL_ROLES)[number];
export type ContextRailMode = "compact" | "full" | "custom";
export type ContextRailMeaningPlacement = "top" | "below" | "beside";

export type ContextRailPlacement = "inside" | "above" | "below";
export type ContextRailVisibility = "always" | "toggle" | "collapse-while-typing";
export type ContextRailPointer = "auto" | "visible" | "hidden";
export type ContextRailLabels = "auto" | "bar-only" | "always";
export type ContextRailLabelPosition = "left" | "center" | "right";

export type ContextRailGlyphSize = {
	width: number;
	height: number;
};

export type ContextRailGlyphAsset = {
	frames: string[];
	fps?: number;
	size?: ContextRailGlyphSize;
};

export type ContextRailRoleConfig = {
	framesFile: string;
	fps?: number;
	meaning: string;
};

export type ContextRailPointerRoleConfig = ContextRailRoleConfig & {
	visibility: ContextRailPointer;
};

export type ContextRailCustomItem = {
	role: ContextRailRole;
	template: string;
};

export type ContextRailCustomConfig = {
	meaningPlacement: ContextRailMeaningPlacement;
	items: ContextRailCustomItem[];
};

export type ContextRailPresentation = {
	mode: ContextRailMode;
	meaningPlacement: ContextRailMeaningPlacement;
	roles: Readonly<
		Record<
			ContextRailRole,
			{
				frame: string;
				meaning: string;
				visible: boolean;
			}
		>
	>;
	customItems: readonly ContextRailCustomItem[];
};

type ContextRailRoleConfigDefaults = {
	speculation: ContextRailRoleConfig;
	pointer: ContextRailPointerRoleConfig;
	compaction: ContextRailRoleConfig;
	maximum: ContextRailRoleConfig;
};

export const DEFAULT_CONTEXT_RAIL_ROLE_CONFIG: ContextRailRoleConfigDefaults = {
	speculation: { framesFile: "speculation.txt", meaning: "spec" },
	pointer: { framesFile: "pointer.txt", visibility: "auto", meaning: "now" },
	compaction: { framesFile: "compaction.txt", meaning: "compact" },
	maximum: { framesFile: "maximum.txt", meaning: "max" },
};

export const DEFAULT_CONTEXT_RAIL_CUSTOM_ITEMS: ContextRailCustomItem[] = [
	{ role: "speculation", template: "{frame} {text-meaning}" },
	{ role: "pointer", template: "{frame} {percent}" },
	{ role: "compaction", template: "{frame} {text-meaning}" },
	{ role: "maximum", template: "{frame} {window} {text-meaning}" },
];

export type ContextRailConfig = {
	enabled: boolean;
	placement: ContextRailPlacement;
	visibility: ContextRailVisibility;
	pointer: ContextRailPointerRoleConfig;
	labels: ContextRailLabels;
	labelPosition: ContextRailLabelPosition;
	showLabelGlyph?: boolean;
	glyphDirectory: string;
	labelGlyph: ContextRailGlyphAsset;
	pointerGlyph: ContextRailGlyphAsset;
	mode: ContextRailMode;
	speculation: ContextRailRoleConfig;
	compaction: ContextRailRoleConfig;
	maximum: ContextRailRoleConfig;
	custom: ContextRailCustomConfig;
};

/**
 * Input shape accepted by config editors and persistence helpers.
 *
 * `normalizeContextRailConfig` also accepts arbitrary JSON at runtime, but
 * this type keeps the legacy pointer scalar and partial role edits type-safe.
 */
export type ContextRailConfigUpdate = Partial<
	Pick<
		ContextRailConfig,
		| "enabled"
		| "placement"
		| "visibility"
		| "labels"
		| "labelPosition"
		| "showLabelGlyph"
		| "glyphDirectory"
		| "mode"
	>
> & {
	pointer?: ContextRailPointer | Partial<ContextRailPointerRoleConfig>;
	speculation?: Partial<ContextRailRoleConfig>;
	compaction?: Partial<ContextRailRoleConfig>;
	maximum?: Partial<ContextRailRoleConfig>;
	custom?: Omit<Partial<ContextRailCustomConfig>, "items"> & {
		items?: readonly unknown[];
	};
};

export const DEFAULT_CONTEXT_RAIL_CONFIG: ContextRailConfig = {
	enabled: true,
	placement: "inside",
	visibility: "always",
	pointer: { ...DEFAULT_CONTEXT_RAIL_ROLE_CONFIG.pointer },
	labels: "auto",
	labelPosition: "center",
	showLabelGlyph: true,
	glyphDirectory: "~/.config/codesook-omp/context-rail",
	labelGlyph: { frames: [], fps: undefined },
	pointerGlyph: { frames: [], fps: undefined },
	mode: "compact",
	speculation: { ...DEFAULT_CONTEXT_RAIL_ROLE_CONFIG.speculation },
	compaction: { ...DEFAULT_CONTEXT_RAIL_ROLE_CONFIG.compaction },
	maximum: { ...DEFAULT_CONTEXT_RAIL_ROLE_CONFIG.maximum },
	custom: {
		meaningPlacement: "beside",
		items: DEFAULT_CONTEXT_RAIL_CUSTOM_ITEMS.map(item => ({ ...item })),
	},
};

export type ContextRailUsage = {
	tokens: number;
	contextWindow: number;
	percent: number;
};

export type ContextRailBoundaries = {
	thresholdPercent?: number | null;
	speculationPercent?: number | null;
};

type ContextRailColor = (value: string) => string;

export type ContextRailPalette = {
	horizontal: string;
	pointer: string;
	speculation: string;
	threshold: string;
	used: ContextRailColor;
	unused: ContextRailColor;
	normal: ContextRailColor;
	warning: ContextRailColor;
	purple: ContextRailColor;
	error: ContextRailColor;
	muted: ContextRailColor;
	label: ContextRailColor;
};

export type ContextRailRenderOptions = {
	compact?: boolean;
	pointer?: ContextRailPointer;
	/** Preloaded pointer glyph frames rendered at the usage marker. */
	pointerGlyphs?: readonly string[];
	/** Current pointer glyph frame; selection wraps like the label frame. */
	pointerFrame?: number;
	/** Fallback pointer glyph when no non-blank frame is available. */
	pointerGlyphFallback?: string;
	labels?: ContextRailLabels;
	labelPosition?: ContextRailLabelPosition;
	showLabelGlyph?: boolean;
	/** Preloaded glyph frames rendered immediately before the percentage label. */
	labelGlyphs?: readonly string[];
	/** Current glyph frame; selection wraps like Headroom's display renderer. */
	labelFrame?: number;
	/** Fallback glyph when no non-blank label frame is available. */
	labelGlyphFallback?: string;
	/** Declared tile dimensions that opt a multiline frame into grid rendering. */
	labelGlyphSize?: ContextRailGlyphSize;
	/** Proportional role snapshot supplied by the plugin runtime. */
	presentation?: ContextRailPresentation;
};

const ANSI_ESCAPE = "\x1b";
const ANSI_RESET = "\x1b[0m";
const DEFAULT_HORIZONTAL = "─";
const EMPTY_CELL = " ";

const PLACEMENTS: readonly ContextRailPlacement[] = ["inside", "above", "below"];
const VISIBILITIES: readonly ContextRailVisibility[] = ["always", "toggle", "collapse-while-typing"];
const POINTERS: readonly ContextRailPointer[] = ["auto", "visible", "hidden"];
const LABELS: readonly ContextRailLabels[] = ["auto", "bar-only", "always"];
const LABEL_POSITIONS: readonly ContextRailLabelPosition[] = ["left", "center", "right"];
const MODES: readonly ContextRailMode[] = ["compact", "full", "custom"];
const MEANING_PLACEMENTS: readonly ContextRailMeaningPlacement[] = ["top", "below", "beside"];

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
	return typeof value === "string" && values.includes(value as T);
}

export function parseContextRailGlyphAsset(source: string): ContextRailGlyphAsset {
	const lines = source.split(/\r?\n/u);
	const firstNonEmptyIndex = lines.findIndex(line => line.trim().length > 0);
	let fps: number | undefined;
	if (firstNonEmptyIndex >= 0) {
		const directive = /^fps=(.*)$/u.exec(lines[firstNonEmptyIndex]!.trim());
		if (directive) {
			const candidate = Number(directive[1]!.trim());
			if (Number.isFinite(candidate) && candidate > 0) fps = candidate;
			lines.splice(firstNonEmptyIndex, 1);
		}
	}

	let size: ContextRailGlyphSize | undefined;
	const sizeIndex = lines.findIndex(line => line.trim().length > 0);
	if (sizeIndex >= 0) {
		const directive = /^size=(.*)$/u.exec(lines[sizeIndex]!.trim());
		if (directive) {
			const dimensions = /^(\d+)x(\d+)$/u.exec(directive[1]!.trim());
			const width = dimensions === null ? Number.NaN : Number(dimensions[1]);
			const height = dimensions === null ? Number.NaN : Number(dimensions[2]);
			if (Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0) {
				size = { width, height };
			}
			lines.splice(sizeIndex, 1);
		}
	}

	const buildAsset = (frames: string[]): ContextRailGlyphAsset => {
		const asset: ContextRailGlyphAsset = { frames, fps };
		if (size !== undefined) asset.size = size;
		return asset;
	};
	const body = lines.join("\n");
	if (!body.trim()) return buildAsset([]);
	const frames = /\r?\n[ \t]*\r?\n/u.test(body)
		? body
				.split(/\r?\n[ \t]*\r?\n/u)
				.map(frame => frame.trim())
				.filter(Boolean)
		: body.trim().split(/\s+/u).filter(Boolean);
	return buildAsset(frames);
}

function normalizeRoleConfig(raw: unknown, defaults: ContextRailRoleConfig): ContextRailRoleConfig {
	const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
	const framesFile =
		typeof source.framesFile === "string" && source.framesFile.trim().length > 0
			? source.framesFile
			: defaults.framesFile;
	const meaning =
		typeof source.meaning === "string" && source.meaning.trim().length > 0 ? source.meaning : defaults.meaning;
	const normalized: ContextRailRoleConfig = { framesFile, meaning };
	if (typeof source.fps === "number" && Number.isFinite(source.fps) && source.fps > 0) normalized.fps = source.fps;
	return normalized;
}

function normalizePointerRoleConfig(raw: unknown): ContextRailPointerRoleConfig {
	if (isOneOf(raw, POINTERS)) {
		return {
			...normalizeRoleConfig(undefined, DEFAULT_CONTEXT_RAIL_ROLE_CONFIG.pointer),
			visibility: raw,
		};
	}
	const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
	const role = normalizeRoleConfig(source, DEFAULT_CONTEXT_RAIL_ROLE_CONFIG.pointer);
	return {
		...role,
		visibility: isOneOf(source.visibility, POINTERS)
			? source.visibility
			: DEFAULT_CONTEXT_RAIL_ROLE_CONFIG.pointer.visibility,
	};
}

function hasExactlyOneFrameToken(template: string): boolean {
	const matches = template.match(/\{frame\}/gu);
	return matches !== null && matches.length === 1;
}

function defaultCustomItem(role: ContextRailRole): ContextRailCustomItem {
	return { ...DEFAULT_CONTEXT_RAIL_CUSTOM_ITEMS.find(item => item.role === role)! };
}

function normalizeCustomItems(raw: unknown): ContextRailCustomItem[] {
	const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
	const candidates = Array.isArray(source.items) ? source.items : [];
	const byRole = new Map<ContextRailRole, ContextRailCustomItem>();
	for (const candidate of candidates) {
		if (typeof candidate !== "object" || candidate === null) continue;
		const item = candidate as Record<string, unknown>;
		if (!isOneOf(item.role, CONTEXT_RAIL_ROLES) || typeof item.template !== "string") continue;
		if (byRole.has(item.role)) continue;
		const template = hasExactlyOneFrameToken(item.template) ? item.template : defaultCustomItem(item.role).template;
		byRole.set(item.role, { role: item.role, template });
	}
	return CONTEXT_RAIL_ROLES.map(role => byRole.get(role) ?? defaultCustomItem(role));
}

export function normalizeContextRailConfig(
	raw: unknown,
	labelGlyphAsset: ContextRailGlyphAsset = { frames: [], fps: undefined },
	pointerGlyphAsset: ContextRailGlyphAsset = { frames: [], fps: undefined },
): ContextRailConfig {
	const config = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
	const customSource = typeof config.custom === "object" && config.custom !== null ? (config.custom as Record<string, unknown>) : {};
	const normalizedCustomPlacement = isOneOf(customSource.meaningPlacement, MEANING_PLACEMENTS)
		? customSource.meaningPlacement
		: DEFAULT_CONTEXT_RAIL_CONFIG.custom.meaningPlacement;
	return {
		enabled: typeof config.enabled === "boolean" ? config.enabled : DEFAULT_CONTEXT_RAIL_CONFIG.enabled,
		placement: isOneOf(config.placement, PLACEMENTS) ? config.placement : DEFAULT_CONTEXT_RAIL_CONFIG.placement,
		visibility: isOneOf(config.visibility, VISIBILITIES) ? config.visibility : DEFAULT_CONTEXT_RAIL_CONFIG.visibility,
		pointer: normalizePointerRoleConfig(config.pointer),
		labels: isOneOf(config.labels, LABELS) ? config.labels : DEFAULT_CONTEXT_RAIL_CONFIG.labels,
		labelPosition: isOneOf(config.labelPosition, LABEL_POSITIONS) ? config.labelPosition : DEFAULT_CONTEXT_RAIL_CONFIG.labelPosition,
		showLabelGlyph: typeof config.showLabelGlyph === "boolean" ? config.showLabelGlyph : DEFAULT_CONTEXT_RAIL_CONFIG.showLabelGlyph,
		glyphDirectory:
			typeof config.glyphDirectory === "string" && config.glyphDirectory.trim().length > 0
				? config.glyphDirectory
				: DEFAULT_CONTEXT_RAIL_CONFIG.glyphDirectory,
		labelGlyph: labelGlyphAsset,
		pointerGlyph: pointerGlyphAsset,
		mode: isOneOf(config.mode, MODES) ? config.mode : DEFAULT_CONTEXT_RAIL_CONFIG.mode,
		speculation: normalizeRoleConfig(config.speculation, DEFAULT_CONTEXT_RAIL_CONFIG.speculation),
		compaction: normalizeRoleConfig(config.compaction, DEFAULT_CONTEXT_RAIL_CONFIG.compaction),
		maximum: normalizeRoleConfig(config.maximum, DEFAULT_CONTEXT_RAIL_CONFIG.maximum),
		custom: {
			meaningPlacement: normalizedCustomPlacement,
			items: normalizeCustomItems(config.custom),
		},
	};
}

function ansiEscapeLength(value: string, start: number): number {
	if (value.charAt(start) !== ANSI_ESCAPE) return 0;
	const next = value.charAt(start + 1);
	if (next === "[") {
		for (let index = start + 2; index < value.length; index++) {
			const code = value.charCodeAt(index);
			if (code >= 0x40 && code <= 0x7e) return index - start + 1;
		}
		return value.length - start;
	}
	if (next === "]" || next === "P" || next === "X" || next === "^" || next === "_") {
		for (let index = start + 2; index < value.length; index++) {
			if (value.charCodeAt(index) === 0x07) return index - start + 1;
			if (value.charAt(index) === ANSI_ESCAPE && value.charAt(index + 1) === "\\") {
				return index - start + 2;
			}
		}
		return value.length - start;
	}
	if (next === "(" || next === ")" || next === "*" || next === "+") return Math.min(3, value.length - start);
	return Math.min(2, value.length - start);
}

const COMBINING_RANGES: readonly (readonly [number, number])[] = [
	[0x0300, 0x036f],
	[0x0483, 0x0489],
	[0x0591, 0x05bd],
	[0x05bf, 0x05c5],
	[0x05c7, 0x05c7],
	[0x0610, 0x061a],
	[0x064b, 0x065f],
	[0x0670, 0x0670],
	[0x06d6, 0x06ed],
	[0x0711, 0x0711],
	[0x0730, 0x074a],
	[0x07a6, 0x07b0],
	[0x0816, 0x0819],
	[0x081b, 0x0823],
	[0x0825, 0x0827],
	[0x0829, 0x082d],
	[0x0859, 0x085f],
	[0x08d3, 0x0903],
	[0x093a, 0x093c],
	[0x093e, 0x094f],
	[0x0951, 0x0957],
	[0x0962, 0x0963],
	[0x0981, 0x0983],
	[0x09bc, 0x09cd],
	[0x0a01, 0x0a03],
	[0x0a3c, 0x0a51],
	[0x0a70, 0x0a71],
	[0x0abc, 0x0abd],
	[0x0abe, 0x0acf],
	[0x0b01, 0x0b03],
	[0x0b3c, 0x0b3c],
	[0x0b3e, 0x0b57],
	[0x0b62, 0x0b63],
	[0x0b82, 0x0b83],
	[0x0bbe, 0x0bce],
	[0x0bd7, 0x0bd7],
	[0x0c00, 0x0c04],
	[0x0c3e, 0x0c56],
	[0x0c62, 0x0c63],
	[0x0c81, 0x0c83],
	[0x0cbc, 0x0cbd],
	[0x0cbe, 0x0cd6],
	[0x0ce2, 0x0ce3],
	[0x0d00, 0x0d03],
	[0x0d3b, 0x0d3c],
	[0x0d3e, 0x0d57],
	[0x0d62, 0x0d63],
	[0x0d82, 0x0d83],
	[0x0e31, 0x0e31],
	[0x0e34, 0x0e3a],
	[0x0e47, 0x0e4e],
	[0x0eb1, 0x0eb1],
	[0x0eb4, 0x0ebc],
	[0x0ec8, 0x0ecd],
	[0x0f18, 0x0f19],
	[0x0f35, 0x0f39],
	[0x0f71, 0x0f84],
	[0x0f86, 0x0f87],
	[0x0f8d, 0x0fbc],
	[0x102b, 0x103e],
	[0x1056, 0x1059],
	[0x105e, 0x106d],
	[0x1071, 0x1074],
	[0x1082, 0x1086],
	[0x108d, 0x109d],
	[0x135d, 0x135f],
	[0x1712, 0x1714],
	[0x1732, 0x1734],
	[0x1752, 0x1753],
	[0x1772, 0x1773],
	[0x17b4, 0x17d3],
	[0x17dd, 0x17dd],
	[0x180b, 0x180f],
	[0x1ab0, 0x1aff],
	[0x1dc0, 0x1dff],
	[0x20d0, 0x20ff],
	[0x2de0, 0x2dff],
	[0x302a, 0x302f],
	[0x3099, 0x309a],
	[0xa66f, 0xa672],
	[0xa674, 0xa67d],
	[0xa69e, 0xa69f],
	[0xa6f0, 0xa6f1],
	[0xfe00, 0xfe0f],
	[0xfe20, 0xfe2f],
	[0xff9e, 0xff9f],
	[0x1f3fb, 0x1f3ff],
	[0xe0100, 0xe01ef],
];
const EMOJI_WIDE_RANGES: readonly (readonly [number, number])[] = [
	[0x231a, 0x231b],
	[0x23e9, 0x23ec],
	[0x23f0, 0x23f0],
	[0x23f3, 0x23f3],
	[0x25fd, 0x25fe],
	[0x2614, 0x2615],
	[0x2630, 0x2637],
	[0x2648, 0x2653],
	[0x267f, 0x267f],
	[0x268a, 0x268f],
	[0x2693, 0x2693],
	[0x26a1, 0x26a1],
	[0x26aa, 0x26ab],
	[0x26bd, 0x26be],
	[0x26c4, 0x26c5],
	[0x26ce, 0x26ce],
	[0x26d4, 0x26d4],
	[0x26ea, 0x26ea],
	[0x26f2, 0x26f3],
	[0x26f5, 0x26f5],
	[0x26fa, 0x26fa],
	[0x26fd, 0x26fd],
	[0x2705, 0x2705],
	[0x270a, 0x270b],
	[0x2728, 0x2728],
	[0x274c, 0x274c],
	[0x274e, 0x274e],
	[0x2753, 0x2755],
	[0x2757, 0x2757],
	[0x2795, 0x2797],
	[0x27b0, 0x27b0],
	[0x27bf, 0x27bf],
	[0x2b1b, 0x2b1c],
	[0x2b50, 0x2b50],
	[0x2b55, 0x2b55],
];

function isWide(codePoint: number): boolean {
	return (
		(codePoint >= 0x1100 && codePoint <= 0x115f) ||
		codePoint === 0x2329 ||
		codePoint === 0x232a ||
		(codePoint >= 0x2e80 && codePoint <= 0x303e) ||
		(codePoint >= 0x3040 && codePoint <= 0xa4cf) ||
		(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
		(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
		(codePoint >= 0xff00 && codePoint <= 0xff60) ||
		(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
		(codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
		(codePoint >= 0x20000 && codePoint <= 0x3fffd) ||
		(codePoint >= 0x2300 && codePoint <= 0x2bff && EMOJI_WIDE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end))
	);
}

function isCombining(codePoint: number): boolean {
	return COMBINING_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}


function codePointWidth(codePoint: number): number {
	if (codePoint === 0 || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
	if (isCombining(codePoint) || codePoint === 0x200b || codePoint === 0x200c || codePoint === 0x200d) return 0;
	return isWide(codePoint) ? 2 : 1;
}

function visibleWidth(value: string): number {
	let width = 0;
	for (let index = 0; index < value.length; ) {
		const escapeLength = ansiEscapeLength(value, index);
		if (escapeLength > 0) {
			index += escapeLength;
			continue;
		}
		const codePoint = value.codePointAt(index) ?? 0;
		width += codePointWidth(codePoint);
		index += codePoint > 0xffff ? 2 : 1;
	}
	return width;
}

function truncateAnsiToWidth(value: string, width: number): string {
	if (width <= 0 || value.length === 0) return "";
	let output = "";
	let used = 0;
	let index = 0;
	let truncated = false;
	while (index < value.length) {
		const escapeLength = ansiEscapeLength(value, index);
		if (escapeLength > 0) {
			output += value.slice(index, index + escapeLength);
			index += escapeLength;
			continue;
		}
		const codePoint = value.codePointAt(index) ?? 0;
		const characterLength = codePoint > 0xffff ? 2 : 1;
		const characterWidth = codePointWidth(codePoint);
		if (used + characterWidth > width) {
			truncated = true;
			break;
		}
		output += value.slice(index, index + characterLength);
		used += characterWidth;
		index += characterLength;
	}
	return truncated ? `${output}${ANSI_RESET}` : output;
}

function fitToWidth(value: string, width: number, fallback = EMPTY_CELL): string {
	if (width <= 0) return "";
	const truncated = truncateAnsiToWidth(value, width);
	const used = visibleWidth(truncated);
	if (used >= width) return truncated;
	if (used === 0 && fallback.length > 0) return fallback.repeat(width);
	return `${truncated}${EMPTY_CELL.repeat(width - used)}`;
}

function safeColor(color: ContextRailColor, value: string): string {
	if (value.length === 0) return value;
	const colored = color(value);
	return typeof colored === "string" ? colored : value;
}

function normalizeWidth(width: number): number {
	if (!Number.isFinite(width)) return 0;
	return Math.max(0, Math.floor(width));
}

function isKnownUsage(value: ContextRailUsage | undefined): value is ContextRailUsage {
	return (
		typeof value === "object" &&
		value !== null &&
		Number.isFinite(value.tokens) &&
		Number.isFinite(value.contextWindow) &&
		value.contextWindow > 0 &&
		Number.isFinite(value.percent)
	);
}

function clampPercent(percent: number): number {
	return Math.min(100, Math.max(0, percent));
}

type UsageRailKind = "used" | "warning" | "purple" | "error";

function reachesUsageThreshold(
	percent: number,
	contextWindow: number,
	percentThreshold: number,
	tokenThreshold: number,
): boolean {
	if (!Number.isFinite(percent) || percent <= 0) return false;
	if (!Number.isFinite(contextWindow) || contextWindow <= 0) return percent >= percentThreshold;
	return percent >= Math.min(percentThreshold, (tokenThreshold / contextWindow) * 100);
}

function usageRailKind(percent: number, contextWindow: number): UsageRailKind {
	if (percent > 100 || reachesUsageThreshold(percent, contextWindow, 90, 500_000)) return "error";
	if (reachesUsageThreshold(percent, contextWindow, 70, 270_000)) return "purple";
	if (reachesUsageThreshold(percent, contextWindow, 50, 150_000)) return "warning";
	return "used";
}

function markerPosition(percent: number, width: number): number {
	if (width <= 1) return 0;
	return Math.round((clampPercent(percent) / 100) * (width - 1));
}

function boundaryPosition(value: number | null | undefined, width: number): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? markerPosition(value, width) : undefined;
}

function formatPercent(percent: number): string {
	const displayPercent = percent < 0 ? 0 : percent;
	return Number.isInteger(displayPercent) ? `${displayPercent}%` : `${Math.round(displayPercent)}%`;
}

function flattenGlyphFrame(frame: string): string {
	return frame.replace(/\r?\n/gu, "");
}

function selectGlyphFrame(
	frames: readonly string[] | undefined,
	frame: number | undefined,
	fallback = "",
	flatten = true,
): string {
	const format = (value: string): string => (flatten ? flattenGlyphFrame(value) : value);
	if (frames === undefined || frames.length === 0) return format(fallback);
	let validFrameCount = 0;
	for (const glyph of frames) {
		if (glyph.trim().length > 0) validFrameCount += 1;
	}
	if (validFrameCount === 0) return format(fallback);
	const frameIndex =
		typeof frame === "number" && Number.isFinite(frame) ? Math.abs(Math.trunc(frame)) % validFrameCount : 0;
	let validFrameIndex = 0;
	for (const glyph of frames) {
		if (glyph.trim().length === 0) continue;
		if (validFrameIndex === frameIndex) return format(glyph);
		validFrameIndex += 1;
	}
	return format(fallback);
}

function shouldRenderLabel(mode: ContextRailLabels, compact: boolean): boolean {
	if (mode === "bar-only") return false;
	return mode === "always" || !compact;
}

function chooseLabelStart(
	width: number,
	labelWidth: number,
	blocked: readonly number[],
	position: ContextRailLabelPosition,
): number | undefined {
	const fits = (start: number): boolean =>
		start >= 0 &&
		start + labelWidth <= width &&
		blocked.every(blockedPosition => blockedPosition < start || blockedPosition >= start + labelWidth);
	if (position === "left") {
		for (let start = 0; start < width; start++) {
			if (fits(start)) return start;
		}
		return undefined;
	}
	if (position === "right") {
		for (let start = width - labelWidth; start >= 0; start--) {
			if (fits(start)) return start;
		}
		return undefined;
	}
	const centered = Math.max(0, Math.floor((width - labelWidth) / 2));
	for (let distance = 0; distance <= width; distance++) {
		const right = centered + distance;
		if (fits(right)) return right;
		if (distance > 0) {
			const left = centered - distance;
			if (fits(left)) return left;
		}
	}
	return undefined;
}

type RailCellKind = "used" | "unused" | "normal" | "warning" | "purple" | "error" | "label";

function renderCell(palette: ContextRailPalette, kind: RailCellKind, value: string): string {
	switch (kind) {
		case "used":
			return safeColor(palette.used, value);
		case "unused":
			return safeColor(palette.unused, value);
		case "normal":
			return safeColor(palette.normal, value);
		case "warning":
			return safeColor(palette.warning, value);
		case "purple":
			return safeColor(palette.purple, value);
		case "error":
			return safeColor(palette.error, value);
		case "label":
			return safeColor(palette.label, value);
	}
}
function writeLabelCells(
	cells: string[],
	kinds: RailCellKind[],
	start: number,
	label: string,
	kind: RailCellKind,
): void {
	let offset = 0;
	let index = 0;
	let lastVisibleCell = start;
	let pendingEscape = "";
	while (index < label.length && start + offset < cells.length) {
		const escapeLength = ansiEscapeLength(label, index);
		if (escapeLength > 0) {
			pendingEscape += label.slice(index, index + escapeLength);
			index += escapeLength;
			continue;
		}
		const codePoint = label.codePointAt(index) ?? 0;
		const characterLength = codePoint > 0xffff ? 2 : 1;
		const character = `${pendingEscape}${label.slice(index, index + characterLength)}`;
		pendingEscape = "";
		const characterWidth = codePointWidth(codePoint);
		if (characterWidth === 0) {
			cells[lastVisibleCell] = `${cells[lastVisibleCell]}${character}`;
			index += characterLength;
			continue;
		}
		const availableWidth = cells.length - start - offset;
		const fittedWidth = Math.min(characterWidth, availableWidth);
		cells[start + offset] = fitToWidth(character, fittedWidth, EMPTY_CELL);
		kinds[start + offset] = kind;
		lastVisibleCell = start + offset;
		for (let continuation = 1; continuation < fittedWidth; continuation += 1) {
			cells[start + offset + continuation] = "";
			kinds[start + offset + continuation] = kind;
		}
		offset += fittedWidth;
		index += characterLength;
		if (fittedWidth < characterWidth) break;
	}
	if (pendingEscape.length > 0 && lastVisibleCell < cells.length) {
		cells[lastVisibleCell] = `${cells[lastVisibleCell]}${pendingEscape}`;
	}
}


function renderUnknownRail(width: number, palette: ContextRailPalette): string {
	const glyph = typeof palette.horizontal === "string" && palette.horizontal.length > 0 ? palette.horizontal : DEFAULT_HORIZONTAL;
	const cells = Array.from({ length: width }, () => fitToWidth(glyph, 1));
	return safeColor(palette.muted, cells.join(""));
}

type MarkerRolePlacement = {
	role: ContextRailRole;
	tile: string;
	meaning: string;
	anchor: number;
	nominalStart: number;
	start: number;
	width: number;
};

type MarkerGrid = {
	cells: string[];
	occupied: boolean[];
	markers: MarkerRolePlacement[];
};

type DisplayUnit = {
	value: string;
	width: number;
};

const MARKER_PRIORITY: readonly ContextRailRole[] = ["maximum", "compaction", "speculation", "pointer"];
const TEMPLATE_TOKEN_PATTERN = /\{(frame|text-meaning|percent|tokens|window|role)\}/gu;
const FRAME_TOKEN_PATTERN = /\{frame\}/gu;

function markerRoleColor(palette: ContextRailPalette, role: ContextRailRole): ContextRailColor {
	switch (role) {
		case "speculation":
			return palette.purple;
		case "pointer":
			return palette.normal;
		case "compaction":
			return palette.warning;
		case "maximum":
			return palette.label;
	}
}

function markerFallback(palette: ContextRailPalette, role: ContextRailRole): string {
	switch (role) {
		case "speculation":
			return palette.speculation;
		case "pointer":
			return palette.pointer;
		case "compaction":
			return palette.threshold;
		case "maximum":
			return "│";
	}
}

function displayUnits(value: string): DisplayUnit[] {
	const units: DisplayUnit[] = [];
	let pendingEscape = "";
	for (let index = 0; index < value.length; ) {
		const escapeLength = ansiEscapeLength(value, index);
		if (escapeLength > 0) {
			pendingEscape += value.slice(index, index + escapeLength);
			index += escapeLength;
			continue;
		}
		const codePoint = value.codePointAt(index) ?? 0;
		const characterLength = codePoint > 0xffff ? 2 : 1;
		const character = value.slice(index, index + characterLength);
		const characterWidth = codePointWidth(codePoint);
		if (characterWidth === 0) {
			if (units.length > 0) {
				units[units.length - 1]!.value += `${pendingEscape}${character}`;
				pendingEscape = "";
			} else {
				pendingEscape += character;
			}
		} else {
			units.push({ value: `${pendingEscape}${character}`, width: characterWidth });
			pendingEscape = "";
		}
		index += characterLength;
	}
	if (pendingEscape.length > 0) {
		if (units.length > 0) units[units.length - 1]!.value += pendingEscape;
		else units.push({ value: pendingEscape, width: 0 });
	}
	return units;
}

function unitsWidth(units: readonly DisplayUnit[]): number {
	let width = 0;
	for (const unit of units) width += unit.width;
	return width;
}

function canWriteUnits(
	occupied: readonly boolean[],
	start: number,
	units: readonly DisplayUnit[],
): boolean {
	if (start < 0) return false;
	let offset = 0;
	for (const unit of units) {
		if (unit.width === 0) continue;
		if (start + offset + unit.width > occupied.length) return false;
		for (let column = 0; column < unit.width; column += 1) {
			if (occupied[start + offset + column]) return false;
		}
		offset += unit.width;
	}
	return true;
}

function writeUnits(
	cells: string[],
	occupied: boolean[],
	start: number,
	units: readonly DisplayUnit[],
): boolean {
	if (!canWriteUnits(occupied, start, units)) return false;
	let offset = 0;
	let lastVisibleCell = start;
	for (const unit of units) {
		if (unit.width === 0) {
			if (lastVisibleCell >= 0 && lastVisibleCell < cells.length) cells[lastVisibleCell] += unit.value;
			continue;
		}
		const target = start + offset;
		cells[target] = unit.value;
		occupied[target] = true;
		lastVisibleCell = target;
		for (let column = 1; column < unit.width; column += 1) {
			cells[target + column] = "";
			occupied[target + column] = true;
		}
		offset += unit.width;
	}
	return true;
}

function candidateStarts(width: number, textWidth: number, preferred: number): number[] {
	const lastStart = width - textWidth;
	if (lastStart < 0) return [];
	const centered = Math.min(lastStart, Math.max(0, Math.trunc(preferred)));
	const starts: number[] = [];
	for (let distance = 0; distance <= lastStart; distance += 1) {
		const left = centered - distance;
		const right = centered + distance;
		if (left >= 0) starts.push(left);
		if (distance > 0 && right <= lastStart) starts.push(right);
	}
	return starts;
}

function preservesMarkerAnchorOrder(
	markers: readonly MarkerRolePlacement[],
	anchor: number,
	start: number,
	width: number,
): boolean {
	for (const marker of markers) {
		if (anchor < marker.anchor && start + width > marker.start) return false;
		if (anchor > marker.anchor && start < marker.start + marker.width) return false;
		if (anchor === marker.anchor && start + width > marker.start) return false;
	}
	return true;
}

function writeMarkerTile(
	cells: string[],
	occupied: boolean[],
	start: number,
	tile: string,
	color: ContextRailColor,
): boolean {
	const styled = safeColor(color, tile);
	const units = displayUnits(styled);
	if (unitsWidth(units) === 0 || !canWriteUnits(occupied, start, units)) return false;
	return writeUnits(cells, occupied, start, units);
}

function placeAnnotation(
	cells: string[],
	occupied: boolean[],
	value: string,
	preferred: number,
	color: ContextRailColor,
	rangeStart = 0,
	rangeEnd = occupied.length,
): boolean {
	const styled = safeColor(color, value);
	const fullUnits = displayUnits(styled);
	const fullWidth = unitsWidth(fullUnits);
	const startLimit = Math.max(0, Math.floor(rangeStart));
	const endLimit = Math.min(occupied.length, Math.floor(rangeEnd));
	if (fullWidth === 0 || endLimit <= startLimit) return false;
	for (const start of candidateStarts(cells.length, fullWidth, preferred)) {
		if (start < startLimit || start + fullWidth > endLimit) continue;
		if (writeUnits(cells, occupied, start, fullUnits)) return true;
	}

	let bestStart: number | undefined;
	let bestWidth = 0;
	let runStart = startLimit;
	while (runStart < endLimit) {
		while (runStart < endLimit && occupied[runStart]) runStart += 1;
		if (runStart >= endLimit) break;
		let runEnd = runStart;
		while (runEnd < endLimit && !occupied[runEnd]) runEnd += 1;
		const available = Math.min(fullWidth, runEnd - runStart);
		const candidate = Math.max(runStart, Math.min(runEnd - available, Math.trunc(preferred)));
		if (
			available > bestWidth ||
			(available === bestWidth &&
				(bestStart === undefined || Math.abs(candidate - preferred) < Math.abs(bestStart - preferred)))
		) {
			bestStart = candidate;
			bestWidth = available;
		}
		runStart = runEnd;
	}
	if (bestStart === undefined || bestWidth <= 0) return false;
	const truncated = truncateAnsiToWidth(styled, bestWidth);
	const truncatedUnits = displayUnits(truncated);
	return writeUnits(cells, occupied, bestStart, truncatedUnits);
}

function markerPercent(percent: number): string {
	if (!Number.isFinite(percent)) return "0%";
	const safePercent = Math.max(0, percent);
	if (safePercent > 0 && safePercent < 1) {
		const fractional = Math.round(safePercent * 10) / 10;
		return `${fractional}%`;
	}
	return `${Math.round(safePercent)}%`;
}

function markerNumber(value: number): string {
	if (!Number.isFinite(value)) return "?";
	if (value < 1_000) return value.toString();
	if (value < 10_000) return `${trimMarkerNumber(value / 1_000)}K`;
	if (value < 1_000_000) return `${Math.round(value / 1_000)}K`;
	if (value < 10_000_000) return `${trimMarkerNumber(value / 1_000_000)}M`;
	if (value < 1_000_000_000) return `${Math.round(value / 1_000_000)}M`;
	if (value < 10_000_000_000) return `${trimMarkerNumber(value / 1_000_000_000)}B`;
	return `${Math.round(value / 1_000_000_000)}B`;
}

function trimMarkerNumber(value: number): string {
	const formatted = value.toFixed(1);
	return formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted;
}

function normalizedPresentationMode(value: ContextRailMode): ContextRailMode {
	return isOneOf(value, MODES) ? value : "compact";
}

function normalizedMeaningPlacement(value: ContextRailMeaningPlacement): ContextRailMeaningPlacement {
	return isOneOf(value, MEANING_PLACEMENTS) ? value : "beside";
}

function templateValue(
	token: string,
	role: ContextRailRole,
	presentationRole: { frame: string; meaning: string; visible: boolean },
	usage: ContextRailUsage,
): string {
	switch (token) {
		case "text-meaning":
			return presentationRole.meaning;
		case "percent":
			return markerPercent(usage.percent);
		case "tokens":
			return markerNumber(usage.tokens);
		case "window":
			return markerNumber(usage.contextWindow);
		case "role":
			return role;
		case "frame":
			return presentationRole.frame;
		default:
			return `{${token}}`;
	}
}

function expandTemplateText(
	template: string,
	role: ContextRailRole,
	presentationRole: { frame: string; meaning: string; visible: boolean },
	usage: ContextRailUsage,
): string {
	return template.replace(TEMPLATE_TOKEN_PATTERN, (_match, token: string) =>
		templateValue(token, role, presentationRole, usage),
	);
}

function customTemplateForRole(presentation: ContextRailPresentation, role: ContextRailRole): string {
	const item = presentation.customItems.find(candidate => candidate.role === role);
	if (item !== undefined && typeof item.template === "string" && hasExactlyOneFrameToken(item.template)) {
		return item.template;
	}
	return defaultCustomItem(role).template;
}

function splitCustomTemplate(
	template: string,
	role: ContextRailRole,
	presentationRole: { frame: string; meaning: string; visible: boolean },
	usage: ContextRailUsage,
): { before: string; after: string; annotation: string } {
	FRAME_TOKEN_PATTERN.lastIndex = 0;
	const frame = FRAME_TOKEN_PATTERN.exec(template);
	if (frame === null) {
		const annotation = expandTemplateText(template, role, presentationRole, usage);
		return { before: "", after: "", annotation };
	}
	const frameEnd = frame.index + frame[0].length;
	const before = expandTemplateText(template.slice(0, frame.index), role, presentationRole, usage);
	const after = expandTemplateText(template.slice(frameEnd), role, presentationRole, usage);
	return { before, after, annotation: `${before}${after}` };
}

function roleAnchor(
	role: ContextRailRole,
	usage: ContextRailUsage,
	boundaries: ContextRailBoundaries | undefined,
): number | undefined {
	switch (role) {
		case "pointer":
			return Number.isFinite(usage.percent) ? clampPercent(usage.percent) : undefined;
		case "speculation": {
			const value = boundaries?.speculationPercent;
			return typeof value === "number" && Number.isFinite(value) ? clampPercent(value) : undefined;
		}
		case "compaction": {
			const value = boundaries?.thresholdPercent;
			return typeof value === "number" && Number.isFinite(value) ? clampPercent(value) : undefined;
		}
		case "maximum":
			return usage.contextWindow > 0 && Number.isFinite(usage.contextWindow) ? 100 : undefined;
	}
}

function placeMarkerRole(
	grid: MarkerGrid,
	placement: MarkerRolePlacement,
	color: ContextRailColor,
): boolean {
	if (!writeMarkerTile(grid.cells, grid.occupied, placement.start, placement.tile, color)) return false;
	grid.markers.push(placement);
	return true;
}

function buildMarkerGrid(
	width: number,
	palette: ContextRailPalette,
	usage: ContextRailUsage,
	boundaries: ContextRailBoundaries | undefined,
	presentation: ContextRailPresentation,
): MarkerGrid {
	const grid: MarkerGrid = {
		cells: Array.from({ length: width }, () => EMPTY_CELL),
		occupied: Array.from({ length: width }, () => false),
		markers: [],
	};
	for (const role of MARKER_PRIORITY) {
		const roleConfig = presentation.roles[role];
		if (roleConfig === undefined || roleConfig.visible !== true) continue;
		const anchor = roleAnchor(role, usage, boundaries);
		if (anchor === undefined) continue;
		const fallback = markerFallback(palette, role);
		const tile = flattenGlyphFrame(roleConfig.frame.trim().length > 0 ? roleConfig.frame : fallback);
		const tileWidth = visibleWidth(tile);
		if (tileWidth <= 0 || tileWidth > width) continue;
		const maxStart = width - tileWidth;
		const nominalStart =
			role === "maximum"
				? maxStart
				: Math.min(maxStart, Math.max(0, markerPosition(anchor, width) - Math.floor(tileWidth / 2)));
		const starts = role === "maximum" ? [nominalStart] : candidateStarts(width, tileWidth, nominalStart);
		let placed = false;
		for (const start of starts) {
			const placement: MarkerRolePlacement = {
				role,
				tile,
				meaning: roleConfig.meaning,
				anchor,
				nominalStart,
				start,
				width: tileWidth,
			};
			if (
				preservesMarkerAnchorOrder(grid.markers, anchor, start, tileWidth) &&
				!grid.occupied.slice(start, start + tileWidth).some(Boolean) &&
				placeMarkerRole(grid, placement, markerRoleColor(palette, role))
			) {
				placed = true;
				break;
			}
		}
		if (!placed) continue;
	}
	return grid;
}

function presentationRole(
	presentation: ContextRailPresentation,
	role: ContextRailRole,
): { frame: string; meaning: string; visible: boolean } {
	const candidate = presentation.roles[role];
	if (candidate !== undefined) return candidate;
	return { frame: "", meaning: "", visible: false };
}

function applyBarBackground(
	grid: MarkerGrid,
	width: number,
	palette: ContextRailPalette,
	usage: ContextRailUsage,
): void {
	const horizontal =
		typeof palette.horizontal === "string" && visibleWidth(palette.horizontal) > 0
			? palette.horizontal
			: DEFAULT_HORIZONTAL;
	const filledCells = Math.round((clampPercent(usage.percent) / 100) * width);
	const usedKind = usageRailKind(usage.percent, usage.contextWindow);
	const cells = Array.from({ length: width }, (_unused, index) =>
		renderCell(palette, index < filledCells ? usedKind : "unused", fitToWidth(horizontal, 1)),
	);
	for (let index = 0; index < width; index += 1) {
		if (grid.occupied[index]) cells[index] = grid.cells[index]!;
	}
	grid.cells = cells;
}

function renderMarkerPresentation(
	width: number,
	palette: ContextRailPalette,
	usage: ContextRailUsage | undefined,
	boundaries: ContextRailBoundaries | undefined,
	presentation: ContextRailPresentation,
): string {
	const mode = normalizedPresentationMode(presentation.mode);
	if (!isKnownUsage(usage)) {
		const blank = EMPTY_CELL.repeat(width);
		const customPlacement = mode === "custom" ? normalizedMeaningPlacement(presentation.meaningPlacement) : "beside";
		return customPlacement === "top" || customPlacement === "below" ? `${blank}\n${blank}` : blank;
	}
	const grid = buildMarkerGrid(width, palette, usage, boundaries, presentation);
	applyBarBackground(grid, width, palette, usage);
	if (mode === "compact") {
		placeAnnotation(grid.cells, grid.occupied, markerPercent(usage.percent), 0, palette.label);
		return grid.cells.join("");
	}
	const percent = markerPercent(usage.percent);
	const window = markerNumber(usage.contextWindow);
	if (mode === "full") {
		placeAnnotation(grid.cells, grid.occupied, percent, 0, palette.label);
		if (Number.isFinite(usage.contextWindow) && usage.contextWindow > 0) {
			placeAnnotation(grid.cells, grid.occupied, window, width - visibleWidth(window), palette.label);
		}
		for (const marker of grid.markers) {
			if (marker.meaning.trim().length === 0) continue;
			const preferred = marker.start + marker.width + 1;
			placeAnnotation(grid.cells, grid.occupied, marker.meaning, preferred, palette.label);
		}
		return grid.cells.join("");
	}

	const placement = normalizedMeaningPlacement(presentation.meaningPlacement);
	const annotationCells = Array.from({ length: width }, () => EMPTY_CELL);
	const annotationOccupied = Array.from({ length: width }, () => false);
	const markersByRole = new Map<ContextRailRole, MarkerRolePlacement>();
	for (const marker of grid.markers) markersByRole.set(marker.role, marker);
	for (const role of CONTEXT_RAIL_ROLES) {
		const marker = markersByRole.get(role);
		if (marker === undefined) continue;
		const roleConfig = presentationRole(presentation, role);
		const template = customTemplateForRole(presentation, role);
		const expanded = splitCustomTemplate(template, role, roleConfig, usage);
		const color = markerRoleColor(palette, role);
		if (placement === "beside") {
			const beforeWidth = visibleWidth(expanded.before);
			const afterWidth = visibleWidth(expanded.after);
			if (beforeWidth > 0) {
				const beforePlaced = placeAnnotation(
					grid.cells,
					grid.occupied,
					expanded.before,
					marker.start - beforeWidth,
					color,
					0,
					marker.start,
				);
				if (!beforePlaced) {
					placeAnnotation(
						grid.cells,
						grid.occupied,
						expanded.before,
						marker.start + marker.width,
						color,
						marker.start + marker.width,
						width,
					);
				}
			}
			if (afterWidth > 0) {
				const afterPlaced = placeAnnotation(
					grid.cells,
					grid.occupied,
					expanded.after,
					marker.start + marker.width,
					color,
					marker.start + marker.width,
					width,
				);
				if (!afterPlaced) {
					placeAnnotation(
						grid.cells,
						grid.occupied,
						expanded.after,
						marker.start - afterWidth,
						color,
						0,
						marker.start,
					);
				}
			}
			continue;
		}
		const annotationWidth = visibleWidth(expanded.annotation);
		if (annotationWidth === 0) continue;
		const preferred = marker.nominalStart + Math.floor(marker.width / 2) - Math.floor(annotationWidth / 2);
		placeAnnotation(annotationCells, annotationOccupied, expanded.annotation, preferred, color);
	}
	if (placement === "beside") return grid.cells.join("");
	const annotationRow = annotationCells.join("");
	return placement === "top" ? `${annotationRow}\n${grid.cells.join("")}` : `${grid.cells.join("")}\n${annotationRow}`;
}

export function renderContextRail(
	width: number,
	palette: ContextRailPalette,
	usage?: ContextRailUsage,
	boundaries?: ContextRailBoundaries,
	options: ContextRailRenderOptions = {},
): string {
	const railWidth = normalizeWidth(width);
	if (railWidth === 0) return "";
	if (options.presentation !== undefined) {
		return renderMarkerPresentation(railWidth, palette, usage, boundaries, options.presentation);
	}
	if (!isKnownUsage(usage)) return renderUnknownRail(railWidth, palette);

	const horizontal = typeof palette.horizontal === "string" && palette.horizontal.length > 0 ? palette.horizontal : DEFAULT_HORIZONTAL;
	const cells = Array.from({ length: railWidth }, () => fitToWidth(horizontal, 1));
	const usedKind = usageRailKind(usage.percent, usage.contextWindow);
	const kinds: RailCellKind[] = Array.from({ length: railWidth }, (_unused, index) =>
		index < Math.round((clampPercent(usage.percent) / 100) * railWidth) ? usedKind : "unused",
	);
	const overLimit = usage.percent > 100;

	const speculation = boundaryPosition(boundaries?.speculationPercent, railWidth);
	const threshold = boundaryPosition(boundaries?.thresholdPercent, railWidth);
	if (speculation !== undefined && palette.speculation.length > 0) {
		cells[speculation] = fitToWidth(palette.speculation, 1);
		kinds[speculation] = "purple";
	}
	if (threshold !== undefined && palette.threshold.length > 0) {
		cells[threshold] = fitToWidth(palette.threshold, 1);
		kinds[threshold] = "warning";
	}

	const pointerMode = isOneOf(options.pointer, POINTERS) ? options.pointer : "auto";
	const pointerHidden = pointerMode === "hidden" || (pointerMode === "auto" && (options.compact === true || railWidth < 8));
	const pointer = pointerHidden ? undefined : markerPosition(usage.percent, railWidth);
	const pointerGlyph = selectGlyphFrame(
		options.pointerGlyphs,
		options.pointerFrame,
		options.pointerGlyphFallback ?? palette.pointer,
	);
	const pointerGlyphWidth = visibleWidth(pointerGlyph);
	const hasPointerGlyph = pointerGlyphWidth > 0 && pointerGlyphWidth <= railWidth;
	const pointerGlyphStart =
		pointer === undefined || !hasPointerGlyph ? undefined : Math.min(pointer, railWidth - pointerGlyphWidth);
	if (pointerGlyphStart !== undefined) {
		writeLabelCells(cells, kinds, pointerGlyphStart, pointerGlyph, usedKind === "used" ? "normal" : usedKind);
	}

	const blockedLabelPositions: number[] = [];
	if (pointerGlyphStart !== undefined) {
		for (let offset = 0; offset < pointerGlyphWidth; offset += 1) {
			blockedLabelPositions.push(pointerGlyphStart + offset);
		}
	}

	if (speculation !== undefined && palette.speculation.length > 0) blockedLabelPositions.push(speculation);
	if (threshold !== undefined && palette.threshold.length > 0) blockedLabelPositions.push(threshold);

	const labelsMode = isOneOf(options.labels, LABELS) ? options.labels : "auto";
	const labelPosition = isOneOf(options.labelPosition, LABEL_POSITIONS) ? options.labelPosition : "center";
	if (shouldRenderLabel(labelsMode, options.compact === true)) {
		const glyph = options.showLabelGlyph === false ? "" : selectGlyphFrame(options.labelGlyphs, options.labelFrame, options.labelGlyphFallback);
		const label = `${glyph}${formatPercent(usage.percent)}`;
		const labelWidth = visibleWidth(label);
		const canFit = railWidth >= labelWidth + 2 || (labelsMode === "always" && railWidth >= labelWidth);
		if (canFit && labelWidth > 0) {
			const start = chooseLabelStart(railWidth, labelWidth, blockedLabelPositions, labelPosition);
			if (start !== undefined) {
				writeLabelCells(cells, kinds, start, label, overLimit ? "error" : "label");
			}
		}
	}

	if (overLimit) {
		for (let index = 0; index < kinds.length; index++) {
			if (kinds[index] === "used") kinds[index] = "error";
		}
	}
	return cells.map((cell, index) => renderCell(palette, kinds[index]!, cell)).join("");
}
const GRID_GAUGE_MIN_WIDTH = 8;

function clearLabelGlyphOptions(options: ContextRailRenderOptions): ContextRailRenderOptions {
	return {
		...options,
		labelGlyphs: [],
		labelFrame: 0,
		labelGlyphFallback: "",
	};
}

function alignGridRow(row: string, width: number, position: ContextRailLabelPosition): string {
	const fitted = fitToWidth(row, width, EMPTY_CELL);
	const rowWidth = visibleWidth(fitted);
	const remaining = Math.max(0, width - rowWidth);
	const leftPadding = position === "right" ? remaining : position === "center" ? Math.floor(remaining / 2) : 0;
	return `${EMPTY_CELL.repeat(leftPadding)}${fitted}${EMPTY_CELL.repeat(remaining - leftPadding)}`;
}

export function renderContextRailRows(
	width: number,
	palette: ContextRailPalette,
	usage?: ContextRailUsage,
	boundaries?: ContextRailBoundaries,
	options: ContextRailRenderOptions = {},
): readonly string[] {
	const railWidth = normalizeWidth(width);
	if (railWidth === 0) return [""];
	if (options.presentation !== undefined) {
		const rendered = renderMarkerPresentation(railWidth, palette, usage, boundaries, options.presentation);
		return rendered.split("\n");
	}
	if (options.showLabelGlyph === false) {
		return [renderContextRail(railWidth, palette, usage, boundaries, options)];
	}
	const selectedFrame = selectGlyphFrame(
		options.labelGlyphs,
		options.labelFrame,
		options.labelGlyphFallback,
		false,
	);
	if (options.labelGlyphSize === undefined || !selectedFrame.includes("\n")) {
		return [renderContextRail(railWidth, palette, usage, boundaries, options)];
	}

	const frameRows = selectedFrame.split(/\r?\n/u);
	const artWidth = Math.max(...frameRows.map(row => visibleWidth(row)), 0);
	const separatorWidth = 1;
	const availableArtWidth = railWidth - separatorWidth - GRID_GAUGE_MIN_WIDTH;
	if (artWidth === 0 || availableArtWidth <= 0) {
		return [renderContextRail(railWidth, palette, usage, boundaries, clearLabelGlyphOptions(options))];
	}

	const panelWidth = Math.min(artWidth, availableArtWidth);
	const gaugeWidth = railWidth - panelWidth - separatorWidth;
	const gauge = renderContextRail(
		gaugeWidth,
		palette,
		usage,
		boundaries,
		clearLabelGlyphOptions(options),
	);
	const labelPosition = isOneOf(options.labelPosition, LABEL_POSITIONS) ? options.labelPosition : "center";
	return frameRows.map((row, index) => {
		const art = safeColor(palette.label, alignGridRow(row, panelWidth, labelPosition));
		const right = index === 0 ? gauge : EMPTY_CELL.repeat(gaugeWidth);
		return `${art}${EMPTY_CELL}${right}`;
	});
}
