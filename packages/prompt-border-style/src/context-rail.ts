export type ContextRailPlacement = "inside" | "above" | "below";
export type ContextRailVisibility = "always" | "toggle" | "collapse-while-typing";
export type ContextRailPointer = "auto" | "visible" | "hidden";
export type ContextRailLabels = "auto" | "bar-only" | "always";
export type ContextRailLabelPosition = "left" | "center" | "right";

export type ContextRailConfig = {
	enabled: boolean;
	placement: ContextRailPlacement;
	visibility: ContextRailVisibility;
	pointer: ContextRailPointer;
	labels: ContextRailLabels;
	labelPosition: ContextRailLabelPosition;
};

export const DEFAULT_CONTEXT_RAIL_CONFIG: ContextRailConfig = {
	enabled: true,
	placement: "inside",
	visibility: "always",
	pointer: "auto",
	labels: "auto",
	labelPosition: "center",
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
	labels?: ContextRailLabels;
	labelPosition?: ContextRailLabelPosition;
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

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
	return typeof value === "string" && values.includes(value as T);
}

export function normalizeContextRailConfig(raw: unknown): ContextRailConfig {
	if (typeof raw !== "object" || raw === null) return { ...DEFAULT_CONTEXT_RAIL_CONFIG };
	const config = raw as Record<string, unknown>;
	return {
		enabled: typeof config.enabled === "boolean" ? config.enabled : DEFAULT_CONTEXT_RAIL_CONFIG.enabled,
		placement: isOneOf(config.placement, PLACEMENTS) ? config.placement : DEFAULT_CONTEXT_RAIL_CONFIG.placement,
		visibility: isOneOf(config.visibility, VISIBILITIES) ? config.visibility : DEFAULT_CONTEXT_RAIL_CONFIG.visibility,
		pointer: isOneOf(config.pointer, POINTERS) ? config.pointer : DEFAULT_CONTEXT_RAIL_CONFIG.pointer,
		labels: isOneOf(config.labels, LABELS) ? config.labels : DEFAULT_CONTEXT_RAIL_CONFIG.labels,
		labelPosition: isOneOf(config.labelPosition, LABEL_POSITIONS) ? config.labelPosition : DEFAULT_CONTEXT_RAIL_CONFIG.labelPosition,
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

function isCombining(codePoint: number): boolean {
	return COMBINING_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

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
		(codePoint >= 0x20000 && codePoint <= 0x3fffd)
	);
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
	return typeof value === "object" && value !== null && Number.isFinite(value.percent);
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

function renderUnknownRail(width: number, palette: ContextRailPalette): string {
	const glyph = typeof palette.horizontal === "string" && palette.horizontal.length > 0 ? palette.horizontal : DEFAULT_HORIZONTAL;
	const cells = Array.from({ length: width }, () => fitToWidth(glyph, 1));
	return safeColor(palette.muted, cells.join(""));
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
	if (pointer !== undefined && palette.pointer.length > 0) {
		cells[pointer] = fitToWidth(palette.pointer, 1);
		kinds[pointer] = usedKind === "used" ? "normal" : usedKind;
	}

	const blockedLabelPositions: number[] = [];
	if (pointer !== undefined && palette.pointer.length > 0) blockedLabelPositions.push(pointer);
	if (speculation !== undefined && palette.speculation.length > 0) blockedLabelPositions.push(speculation);
	if (threshold !== undefined && palette.threshold.length > 0) blockedLabelPositions.push(threshold);

	const labelsMode = isOneOf(options.labels, LABELS) ? options.labels : "auto";
	const labelPosition = isOneOf(options.labelPosition, LABEL_POSITIONS) ? options.labelPosition : "center";
	if (shouldRenderLabel(labelsMode, options.compact === true)) {
		const label = formatPercent(usage.percent);
		const labelWidth = visibleWidth(label);
		const canFit = railWidth >= labelWidth + 2 || (labelsMode === "always" && railWidth >= labelWidth);
		if (canFit && labelWidth > 0) {
			const start = chooseLabelStart(railWidth, labelWidth, blockedLabelPositions, labelPosition);
			if (start !== undefined) {
				let offset = 0;
				for (const character of label) {
					const characterWidth = visibleWidth(character);
					cells[start + offset] = fitToWidth(character, Math.min(characterWidth, railWidth - start - offset));
					kinds[start + offset] = overLimit ? "error" : "label";
					offset += characterWidth;
				}
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
