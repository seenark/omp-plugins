import { CustomEditor, type ExtensionAPI, type ExtensionUIContext, type SpinnerType, type Theme } from "@oh-my-pi/pi-coding-agent";
import { AttachmentChipsBand } from "@oh-my-pi/pi-coding-agent/modes/components/attachment-chips";
import { getSelectListTheme, getSettingsListTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { computeCompactionBoundaries } from "@oh-my-pi/pi-coding-agent/modes/utils/context-usage";
import { mkdir, rename, unlink } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	Box,
	CURSOR_MARKER,
	Input,
	Loader,
	SelectList,
	SettingsList,
	Spacer,
	Text,
	sliceByColumn,
	truncateToWidth,
	visibleWidth,
	type AutocompleteItem,
	type Component,
	type EditorBorderStyle,
	type EditorTheme,
	type EditorTopBorder,
	type SelectItem,
	type SettingItem,
} from "@oh-my-pi/pi-tui";
import {
	CONTEXT_RAIL_ROLES,
	DEFAULT_CONTEXT_RAIL_CONFIG,
	parseContextRailGlyphAsset,
	type ContextRailBoundaries,
	type ContextRailGlyphAsset,
	type ContextRailConfig,
	type ContextRailConfigUpdate,
	type ContextRailMeaningPlacement,
	type ContextRailLabels,
	type ContextRailLabelPosition,
	type ContextRailPalette,
	type ContextRailPlacement,
	type ContextRailPointer,
	type ContextRailRenderOptions,
	type ContextRailRole,
	type ContextRailMode,
	type ContextRailUsage,
	type ContextRailVisibility,
	renderContextRailRows,
	normalizeContextRailConfig,
} from "./context-rail";
export { DEFAULT_CONTEXT_RAIL_CONFIG } from "./context-rail";
export type BorderStyleName =
	| "round"
	| "sharp"
	| "heavy"
	| "dashed"
	| "heavy-dashed"
	| "heavy-top"
	| "double"
	| "double-top"
	| "double-side"
	| "ascii"
	| "block"
	| "vertical"
	| "double-vertical"
	| "horizontal"
	| "double-horizontal";

export type BorderLayoutName = "full" | "bottom" | "sides" | "top-bottom" | "default";

export type PromptBorderState = {
	style: BorderStyleName;
	layout: BorderLayoutName;
};

export type PromptBorderGlyphConfig = {
	frameMs: number;
	glyphs: string;
	frames: string[];
};

export type PromptBorderGlyphSide = "left" | "right";
type PromptBorderSpinnerGlyphSlot = SpinnerType;
type PromptBorderGlyphSlot = PromptBorderGlyphSide | PromptBorderSpinnerGlyphSlot;
type PromptBorderSpinnerGlyphConfig = Record<PromptBorderSpinnerGlyphSlot, PromptBorderGlyphConfig>;

export type PromptBorderConfig = {
	style: BorderStyleName;
	layout: BorderLayoutName;
	leftGlyph: PromptBorderGlyphConfig;
	rightGlyph: PromptBorderGlyphConfig;
	spinnerGlyphs: PromptBorderSpinnerGlyphConfig;
	contextRail: ContextRailConfig;
};

export type PromptBorderConfigInput = Omit<PromptBorderConfig, "contextRail"> & {
	contextRail?: ContextRailConfig;
};
export type PromptBorderConfigPathOptions = {
	configPath?: string;
	destinationPath?: string;
	destination?: string;
	legacyConfigPath?: string;
	legacyPath?: string;
	legacy?: string;
	legacyAssetDirectory?: string;
};

type PromptBorderConfigPathInput = string | PromptBorderConfigPathOptions | undefined;

type ContextRailRoleAssets = Record<ContextRailRole, ContextRailGlyphAsset>;
type ContextRailRoleFrames = Record<ContextRailRole, number>;
type ContextRailRoleTimers = Record<ContextRailRole, Timer | undefined>;
type ContextRailRoleFallbacks = Record<ContextRailRole, string>;

type ContextRailRuntime = {
	config: ContextRailConfig;
	usage: ContextRailUsage | undefined;
	boundaries: ContextRailBoundaries | undefined;
	toggledVisible: boolean;
	compactUntil: number;
	compactTimer: Timer | undefined;
	roleAssets: ContextRailRoleAssets;
	roleFrames: ContextRailRoleFrames;
	roleTimers: ContextRailRoleTimers;
	roleFallbacks: ContextRailRoleFallbacks;
	/** Legacy label state retained for existing callers and persisted files. */
	labelGlyphFrame: number;
	labelGlyphTimer: Timer | undefined;
	labelGlyphFallback: string;
	/** Legacy pointer state retained for existing callers and persisted files. */
	pointerGlyphFrame: number;
	pointerGlyphTimer: Timer | undefined;
	pointerGlyphFallback: string;
	requestRender: (() => void) | undefined;
	palette: (horizontal: string) => ContextRailPalette;
};

const CONTEXT_RAIL_WIDGET_KEY = "prompt-context-rail";
const PROMPT_ATTACHMENT_WIDGET_KEY = "prompt-border-attachments";

const CONTEXT_RAIL_COMPACT_IDLE_MS = 650;

function emptyContextRailRoleAssets(): ContextRailRoleAssets {
	return Object.fromEntries(
		CONTEXT_RAIL_ROLES.map(role => [role, { frames: [], fps: undefined } satisfies ContextRailGlyphAsset]),
	) as unknown as ContextRailRoleAssets;
}

function emptyContextRailRoleFrames(): ContextRailRoleFrames {
	return Object.fromEntries(CONTEXT_RAIL_ROLES.map(role => [role, 0])) as ContextRailRoleFrames;
}

function emptyContextRailRoleTimers(): ContextRailRoleTimers {
	return Object.fromEntries(CONTEXT_RAIL_ROLES.map(role => [role, undefined])) as ContextRailRoleTimers;
}

function contextRailRoleFrameCount(runtime: ContextRailRuntime, role: ContextRailRole): number {
	return runtime.roleAssets[role].frames.filter(frame => frame.trim().length > 0).length;
}

function contextRailRoleFps(runtime: ContextRailRuntime, role: ContextRailRole): number | undefined {
	const configured = runtime.config[role].fps;
	if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) return configured;
	const assetFps = runtime.roleAssets[role].fps;
	return typeof assetFps === "number" && Number.isFinite(assetFps) && assetFps > 0 ? assetFps : undefined;
}

function createContextRailRuntime(
	config: ContextRailConfig,
	palette: (horizontal: string) => ContextRailPalette,
	labelGlyphFallback: string,
	pointerGlyphFallback: string,
	roleAssets: ContextRailRoleAssets = emptyContextRailRoleAssets(),
	roleFallbacks: ContextRailRoleFallbacks = emptyContextRailRoleFallbacks(),
): ContextRailRuntime {
	return {
		config,
		usage: undefined,
		boundaries: undefined,
		toggledVisible: true,
		compactUntil: 0,
		compactTimer: undefined,
		roleAssets,
		roleFrames: emptyContextRailRoleFrames(),
		roleTimers: emptyContextRailRoleTimers(),
		roleFallbacks,
		labelGlyphFrame: 0,
		labelGlyphTimer: undefined,
		labelGlyphFallback,
		pointerGlyphFrame: 0,
		pointerGlyphTimer: undefined,
		pointerGlyphFallback,
		requestRender: undefined,
		palette,
	};
}

function contextRailVisible(runtime: ContextRailRuntime): boolean {
	return runtime.config.enabled && (runtime.config.visibility !== "toggle" || runtime.toggledVisible);
}

function contextRailCompact(runtime: ContextRailRuntime, now = Date.now()): boolean {
	return runtime.config.visibility === "collapse-while-typing" && runtime.compactUntil > now;
}

function contextRailBoundariesEqual(
	previous: ContextRailBoundaries | undefined,
	next: ContextRailBoundaries | undefined,
): boolean {
	return (
		previous?.thresholdPercent === next?.thresholdPercent &&
		previous?.speculationPercent === next?.speculationPercent
	);
}

type ContextRailModel = Parameters<typeof computeCompactionBoundaries>[2];

function updateContextRailState(
	runtime: ContextRailRuntime,
	usage: ContextRailUsage | undefined,
	model?: ContextRailModel,
): boolean {
	const previousUsage = runtime.usage;
	const usageChanged =
		previousUsage?.tokens !== usage?.tokens ||
		previousUsage?.contextWindow !== usage?.contextWindow ||
		previousUsage?.percent !== usage?.percent;
	let boundaries: ContextRailBoundaries | undefined;
	if (
		usage !== undefined &&
		Number.isFinite(usage.contextWindow) &&
		usage.contextWindow > 0 &&
		Number.isFinite(usage.percent)
	) {
		try {
			boundaries = computeCompactionBoundaries(settings, usage.contextWindow, model) ?? undefined;
		} catch {
			boundaries = undefined;
		}
	}
	const boundariesChanged = !contextRailBoundariesEqual(runtime.boundaries, boundaries);
	if (!usageChanged && !boundariesChanged) return false;
	runtime.usage = usage;
	runtime.boundaries = boundaries;
	runtime.requestRender?.();
	return true;
}

function markContextRailDraftActivity(runtime: ContextRailRuntime, text: string): void {
	if (runtime.config.visibility !== "collapse-while-typing") return;
	clearTimeout(runtime.compactTimer);
	runtime.compactTimer = undefined;
	if (text.length === 0) {
		runtime.compactUntil = 0;
		runtime.requestRender?.();
		return;
	}
	runtime.compactUntil = Date.now() + CONTEXT_RAIL_COMPACT_IDLE_MS;
	runtime.compactTimer = setTimeout(() => {
		runtime.compactTimer = undefined;
		runtime.compactUntil = 0;
		runtime.requestRender?.();
	}, CONTEXT_RAIL_COMPACT_IDLE_MS);
	runtime.compactTimer.unref?.();
}

function resolveThemeSymbol(theme: unknown, name: string, fallback: string): string {
	try {
		const symbol = isRecord(theme) ? theme.symbol : undefined;
		if (typeof symbol !== "function") return fallback;
		const value = symbol.call(theme, name);
		return typeof value === "string" && value.trim().length > 0 ? value : fallback;
	} catch {
		return fallback;
	}
}

function resolveContextRailFallback(theme: unknown): string {
	return resolveThemeSymbol(theme, "status.success", "✓");
}

function resolveContextRailPointerFallback(theme: unknown): string {
	return resolveThemeSymbol(theme, "context.pointer", "●");
}

function emptyContextRailRoleFallbacks(): ContextRailRoleFallbacks {
	return Object.fromEntries(CONTEXT_RAIL_ROLES.map(role => [role, ""])) as ContextRailRoleFallbacks;
}

function resolveContextRailRoleFallbacks(theme: unknown): ContextRailRoleFallbacks {
	return {
		speculation: resolveThemeSymbol(theme, "context.speculation", "╎"),
		pointer: resolveThemeSymbol(theme, "context.pointer", "●"),
		compaction: resolveThemeSymbol(theme, "context.compaction", "┃"),
		maximum: resolveThemeSymbol(theme, "boxRound.vertical", "│"),
	};
}

function clearContextRailRoleTimers(runtime: ContextRailRuntime): void {
	for (const role of CONTEXT_RAIL_ROLES) {
		const timer = runtime.roleTimers[role];
		if (timer !== undefined) clearTimeout(timer);
		runtime.roleTimers[role] = undefined;
	}
	if (runtime.labelGlyphTimer !== undefined) clearTimeout(runtime.labelGlyphTimer);
	if (runtime.pointerGlyphTimer !== undefined) clearTimeout(runtime.pointerGlyphTimer);
	runtime.labelGlyphTimer = undefined;
	runtime.pointerGlyphTimer = undefined;
}

function contextRailRoleCanAnimate(runtime: ContextRailRuntime, role: ContextRailRole): boolean {
	if (!contextRailVisible(runtime)) return false;
	if (role === "pointer" && runtime.config.pointer.visibility === "hidden") return false;
	if (role === "speculation" && runtime.boundaries?.speculationPercent == null) return false;
	if (role === "compaction" && runtime.boundaries?.thresholdPercent == null) return false;
	if (
		role === "maximum" &&
		(runtime.usage === undefined ||
			!Number.isFinite(runtime.usage.contextWindow) ||
			runtime.usage.contextWindow <= 0 ||
			!Number.isFinite(runtime.usage.percent))
	) {
		return false;
	}
	return true;
}

function syncLegacyPointerState(runtime: ContextRailRuntime): void {
	runtime.pointerGlyphFrame = runtime.roleFrames.pointer;
	runtime.pointerGlyphTimer = runtime.roleTimers.pointer;
}

function scheduleContextRailRoleFrame(runtime: ContextRailRuntime, role: ContextRailRole): void {
	const timer = runtime.roleTimers[role];
	const frameCount = contextRailRoleFrameCount(runtime, role);
	const fps = contextRailRoleFps(runtime, role);
	if (
		!contextRailRoleCanAnimate(runtime, role) ||
		frameCount < 2 ||
		fps === undefined ||
		runtime.requestRender === undefined
	) {
		if (timer !== undefined) {
			clearTimeout(timer);
			runtime.roleTimers[role] = undefined;
			if (role === "pointer") syncLegacyPointerState(runtime);
		}
		return;
	}
	if (timer !== undefined) return;
	const frameDelay = Math.max(1, Math.round(1000 / fps));
	const scheduledTimer = setTimeout(() => {
		runtime.roleTimers[role] = undefined;
		if (!contextRailRoleCanAnimate(runtime, role)) {
			if (role === "pointer") syncLegacyPointerState(runtime);
			return;
		}
		const currentFrameCount = contextRailRoleFrameCount(runtime, role);
		if (currentFrameCount < 2) {
			if (role === "pointer") syncLegacyPointerState(runtime);
			return;
		}
		runtime.roleFrames[role] = (runtime.roleFrames[role] + 1) % currentFrameCount;
		if (role === "pointer") syncLegacyPointerState(runtime);
		runtime.requestRender?.();
	}, frameDelay);
	scheduledTimer.unref?.();
	runtime.roleTimers[role] = scheduledTimer;
	if (role === "pointer") syncLegacyPointerState(runtime);
}

function scheduleContextRailRoleFrames(runtime: ContextRailRuntime): void {
	for (const role of CONTEXT_RAIL_ROLES) scheduleContextRailRoleFrame(runtime, role);
}

function replaceContextRailConfig(
	runtime: ContextRailRuntime,
	config: ContextRailConfig,
	roleAssets?: ContextRailRoleAssets,
): void {
	clearContextRailRoleTimers(runtime);
	runtime.roleFrames = emptyContextRailRoleFrames();
	runtime.config = config;
	if (roleAssets !== undefined) runtime.roleAssets = roleAssets;
	runtime.labelGlyphFrame = 0;
	runtime.pointerGlyphFrame = 0;
	runtime.requestRender?.();
}



function createContextRailPalette(theme: Theme, horizontal: string): ContextRailPalette {
	const speculation = resolveThemeSymbol(theme, "context.speculation", "╎");
	const threshold = resolveThemeSymbol(theme, "context.compaction", "┃");
	return {
		horizontal,
		pointer: resolveContextRailPointerFallback(theme),
		speculation,
		threshold,
		used: value => theme.fg("statusLineContext", value),
		unused: value => theme.fg("border", value),
		normal: value => theme.fg("statusLineContext", value),
		warning: value => theme.fg("warning", value),
		purple: value => theme.fg("thinkingHigh", value),
		error: value => theme.fg("error", value),
		muted: value => theme.fg("muted", value),
		label: value => theme.fg("statusLineContext", value),
	};
}

export type PromptBorderGlyphs = Pick<
	EditorTheme["symbols"]["boxRound"],
	"topLeft" | "topRight" | "bottomLeft" | "bottomRight" | "horizontal" | "vertical"
>;

export const borderStyles: Record<BorderStyleName, PromptBorderGlyphs> = {
	round: { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯", horizontal: "─", vertical: "│" },
	sharp: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: "─", vertical: "│" },
	heavy: { topLeft: "┏", topRight: "┓", bottomLeft: "┗", bottomRight: "┛", horizontal: "━", vertical: "┃" },
	dashed: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: "╌", vertical: "╎" },
	"heavy-dashed": { topLeft: "┏", topRight: "┓", bottomLeft: "┗", bottomRight: "┛", horizontal: "╍", vertical: "╏" },
	"heavy-top": { topLeft: "┍", topRight: "┑", bottomLeft: "┕", bottomRight: "┙", horizontal: "━", vertical: "│" },
	double: { topLeft: "╔", topRight: "╗", bottomLeft: "╚", bottomRight: "╝", horizontal: "═", vertical: "║" },
	"double-top": { topLeft: "╒", topRight: "╕", bottomLeft: "╘", bottomRight: "╛", horizontal: "═", vertical: "│" },
	"double-side": { topLeft: "╓", topRight: "╖", bottomLeft: "╙", bottomRight: "╜", horizontal: "─", vertical: "║" },
	ascii: { topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+", horizontal: "-", vertical: "|" },
	block: { topLeft: "▲", topRight: "▲", bottomLeft: "▼", bottomRight: "▼", horizontal: " ", vertical: "█" },
	vertical: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: " ", vertical: "│" },
	"double-vertical": { topLeft: "╓", topRight: "╖", bottomLeft: "╙", bottomRight: "╜", horizontal: " ", vertical: "║" },
	horizontal: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: "─", vertical: " " },
	"double-horizontal": { topLeft: "╒", topRight: "╕", bottomLeft: "╘", bottomRight: "╛", horizontal: "═", vertical: " " },
};

const STYLE_NAMES = Object.keys(borderStyles) as BorderStyleName[];
const LAYOUT_NAMES = ["full", "bottom", "sides", "top-bottom", "default"] as const;
const PRIMARY_COMMAND_OPTIONS = [...STYLE_NAMES, "config", "status", "layout", "reset", "rail", "glyphs"] as const;
const CONTEXT_RAIL_PLACEMENTS = ["inside", "above", "below"] as const satisfies readonly ContextRailPlacement[];
const CONTEXT_RAIL_VISIBILITIES = ["always", "toggle", "collapse-while-typing"] as const satisfies readonly ContextRailVisibility[];
const CONTEXT_RAIL_POINTERS = ["auto", "visible", "hidden"] as const satisfies readonly ContextRailPointer[];
const CONTEXT_RAIL_LABELS = ["auto", "bar-only", "always"] as const satisfies readonly ContextRailLabels[];
const CONTEXT_RAIL_POSITIONS = ["left", "center", "right"] as const satisfies readonly ContextRailLabelPosition[];
const CONTEXT_RAIL_LABEL_GLYPH_VISIBILITIES = ["on", "off"] as const;
const CONTEXT_RAIL_MODES = ["compact", "full", "custom"] as const;
const CONTEXT_RAIL_MEANING_PLACEMENTS = ["top", "below", "beside"] as const;
const GLYPH_TEXT_FILE_NAMES = {
	left: "prompt-border-left-glyphs.txt",
	right: "prompt-border-right-glyphs.txt",
	status: "prompt-border-status-spinner-glyphs.txt",
	activity: "prompt-border-activity-spinner-glyphs.txt",
} as const;
const CONTEXT_RAIL_LABEL_FILE_NAME = "label.txt";
const CONTEXT_RAIL_POINTER_FILE_NAME = "pointer.txt";
const CONTEXT_RAIL_USAGE =
	"Usage: /context-rail [on|off|toggle|status|init [glyphs]] | placement <inside|above|below> | visibility <always|toggle|collapse-while-typing> | pointer <auto|visible|hidden> | labels <auto|bar-only|always> | label-glyph <on|off> | position <left|center|right>";
const USAGE =
	"Usage: /prompt-border [config|status|<style> [layout]|layout <layout>|reset|rail toggle|glyphs debug [frames|demo|on|off]]";
const DEFAULT_GLYPH_FRAME_MS = 70;
const DEFAULT_SPINNER_GLYPH_FRAME_MS = 80;
const HOST_SPINNER_FRAME_MS = 80;
const LOADING_GLYPH_DEBUG_ROOT_OPTIONS = ["debug"] as const;
const LOADING_GLYPH_DEBUG_ACTIONS = ["frames", "demo", "on", "off"] as const;
const SPINNER_GLYPH_SLOTS = ["status", "activity"] as const satisfies readonly SpinnerType[];
const CONFIG_DIRECTORY = path.join(os.homedir(), ".config", "codesook-omp", "prompt-border");
export const CONFIG_PATH = path.join(CONFIG_DIRECTORY, "config.json");
export const LEGACY_CONFIG_PATH = path.join(os.homedir(), ".config", "codesook-omp", "config.json");

export const DEFAULT_LEFT_GLYPH_TEXT_PATH = path.join(CONFIG_DIRECTORY, GLYPH_TEXT_FILE_NAMES.left);
export const DEFAULT_RIGHT_GLYPH_TEXT_PATH = path.join(CONFIG_DIRECTORY, GLYPH_TEXT_FILE_NAMES.right);
export const DEFAULT_STATUS_SPINNER_GLYPH_TEXT_PATH = path.join(CONFIG_DIRECTORY, GLYPH_TEXT_FILE_NAMES.status);
export const DEFAULT_ACTIVITY_SPINNER_GLYPH_TEXT_PATH = path.join(CONFIG_DIRECTORY, GLYPH_TEXT_FILE_NAMES.activity);
export const DEFAULT_LEFT_GLYPH_TEXT =
	"􁦘􁦙  􁦚􁦛  􁦜􁦝  􁦞􁦟  􁦠􁦡  􁦢􁦣  􁦤􁦥  􁦦􁦧  􁦨􁦩  􁦪􁦫  􁦬􁦭  􁦮􁦯  􁦰􁦱  􁦲􁦳  􁦴􁦵  􁦶􁦷  􁦸􁦹  􁦺􁦻  􁦼􁦽  􁦾􁦿  􁧀􁧁  􁧂􁧃  􁧄􁧅  􁧆􁧇  􁧈􁧉  􁧊􁧋  􁧌􁧍  􁧎􁧏  􁧐􁧑  􁧒􁧓  􁧔􁧕  􁧖􁧗  􁧘􁧙  􁧚􁧛  􁧜􁧝  􁧞􁧟  􁧠􁧡  􁧢􁧣  􁧤􁧥  􁧦􁧧  􁧨􁧩  􁧪􁧫  􁧬􁧭  􁧮􁧯  􁧰􁧱  􁧲􁧳  􁧴􁧵  􁧶􁧷  􁧸􁧹  􁧺􁧻  􁧼􁧽  􁧾􁧿  􁨀􁨁  􁨂􁨃  􁨄􁨅  􁨆􁨇  􁨈􁨉  􁨊􁨋  􁨌􁨍  􁨎􁨏  􁨐􁨑  􁨒􁨓  􁨔􁨕  􁨖􁨗  􁨘􁨙  􁨚􁨛  􁨜􁨝  􁨞􁨟  􁨠􁨡  􁨢􁨣  􁨤􁨥  􁨦􁨧  􁨨􁨩";

export function parseGlyphFrames(glyphs: string): string[] {
	return glyphs.trim().split(/\s+/u).filter(Boolean);
}

export function buildTimedSpinnerFrames(
	frames: readonly string[],
	frameMs: number,
	hostFrameMs = HOST_SPINNER_FRAME_MS,
): string[] {
	if (frames.length === 0) return [];
	const safeHostFrameMs = Number.isFinite(hostFrameMs) && hostFrameMs > 0 ? hostFrameMs : HOST_SPINNER_FRAME_MS;
	const safeFrameMs =
		Number.isFinite(frameMs) && frameMs >= 16 && frameMs <= 1000 ? frameMs : DEFAULT_SPINNER_GLYPH_FRAME_MS;
	const hostFrameCount = Math.max(1, Math.round((frames.length * safeFrameMs) / safeHostFrameMs));
	return Array.from({ length: hostFrameCount }, (_unused, hostFrameIndex) => {
		const sourceFrameIndex = Math.floor((hostFrameIndex * safeHostFrameMs) / safeFrameMs) % frames.length;
		return frames[sourceFrameIndex];
	});
}

export type PromptLoadingGlyphDebugAction =
	| { kind: "frames" }
	| { kind: "demo" }
	| { kind: "on" }
	| { kind: "off" }
	| { kind: "invalid" };

export type SpinnerFrameDebugMode = "empty" | "unchanged" | "repeated" | "skipped";

export type SpinnerFrameDebugReport = {
	type: SpinnerType;
	frameMs: number;
	sourceFrames: readonly string[];
	visibleFrames: readonly string[];
	mode: SpinnerFrameDebugMode;
};

export function createSpinnerFrameDebugReport(type: SpinnerType, config: SpinnerGlyphFrameOverride): SpinnerFrameDebugReport {
	const visibleFrames = buildTimedSpinnerFrames(config.frames, config.frameMs);
	const mode: SpinnerFrameDebugMode =
		config.frames.length === 0
			? "empty"
			: visibleFrames.length === 0 || (visibleFrames.length === config.frames.length && visibleFrames.every((frame, index) => frame === config.frames[index]))
				? "unchanged"
				: visibleFrames.length > config.frames.length
					? "repeated"
					: "skipped";
	return {
		type,
		frameMs: config.frameMs,
		sourceFrames: Array.from(config.frames),
		visibleFrames,
		mode,
	};
}

export function formatSpinnerFrameDebugReport(report: SpinnerFrameDebugReport): string {
	const modeLine =
		report.mode === "repeated"
			? "mode: repeats frames to match 80ms host tick"
			: report.mode === "skipped"
				? "mode: skips source frames to match 80ms host tick"
				: report.mode === "empty"
					? "mode: no configured frames; host defaults will render"
					: "mode: keeps frames unchanged at 80ms host tick";
	const note =
		report.mode === "skipped"
			? "note: smooth looping must hold on the visible subsequence, not only the full source list"
			: undefined;
	return [
		`Prompt loading glyphs: ${report.type}`,
		`frameMs: ${report.frameMs}`,
		`source (${report.sourceFrames.length}): ${report.sourceFrames.join(" ") || "<empty>"}`,
		`visible (${report.visibleFrames.length}): ${report.visibleFrames.join(" ") || "<host defaults>"}`,
		modeLine,
		note,
	]
		.filter(Boolean)
		.join("\n");
}

function formatAllSpinnerFrameDebugReports(config: PromptBorderConfig): string {
	return [
		formatSpinnerFrameDebugReport(createSpinnerFrameDebugReport("status", config.spinnerGlyphs.status)),
		formatSpinnerFrameDebugReport(createSpinnerFrameDebugReport("activity", config.spinnerGlyphs.activity)),
	].join("\n\n");
}

export function formatPromptLoadingGlyphDemoSummary(config: PromptBorderConfigInput): string {
	return [
		"Prompt loading glyphs demo",
		...SPINNER_GLYPH_SLOTS.map(slot => {
			const report = createSpinnerFrameDebugReport(slot, config.spinnerGlyphs[slot]);
			return `${slot} loading — visible (${report.visibleFrames.length}): ${report.visibleFrames.join(" ") || "<host defaults>"}`;
		}),
	].join("\n");
}

const emptySpinnerGlyphConfig = (): PromptBorderSpinnerGlyphConfig => ({
	status: { frameMs: DEFAULT_SPINNER_GLYPH_FRAME_MS, glyphs: "", frames: [] },
	activity: { frameMs: DEFAULT_SPINNER_GLYPH_FRAME_MS, glyphs: "", frames: [] },
});

export const DEFAULT_PROMPT_BORDER_CONFIG: PromptBorderConfig = {
	style: "double",
	layout: "full",
	leftGlyph: { frameMs: DEFAULT_GLYPH_FRAME_MS, glyphs: "", frames: [] },
	rightGlyph: { frameMs: DEFAULT_GLYPH_FRAME_MS, glyphs: "", frames: [] },
	spinnerGlyphs: emptySpinnerGlyphConfig(),
	contextRail: { ...DEFAULT_CONTEXT_RAIL_CONFIG },
};

export const EXAMPLE_PROMPT_BORDER_CONFIG: PromptBorderConfig = {
	style: "double",
	layout: "full",
	leftGlyph: {
		frameMs: DEFAULT_GLYPH_FRAME_MS,
		glyphs: DEFAULT_LEFT_GLYPH_TEXT,
		frames: parseGlyphFrames(DEFAULT_LEFT_GLYPH_TEXT),
	},
	rightGlyph: {
		frameMs: DEFAULT_GLYPH_FRAME_MS,
		glyphs: "",
		frames: [],
	},
	spinnerGlyphs: emptySpinnerGlyphConfig(),
	contextRail: { ...DEFAULT_CONTEXT_RAIL_CONFIG },
};

export type PromptBorderAction =
	| { kind: "config" }
	| { kind: "status" }
	| { kind: "reset" }
	| { kind: "apply"; state: PromptBorderState }
	| { kind: "rail-toggle" }
	| { kind: "glyph-debug"; action: (typeof LOADING_GLYPH_DEBUG_ACTIONS)[number] }
	| { kind: "invalid" };

let activeBorder: PromptBorderState = { style: "double", layout: "full" };
let activeConfig: PromptBorderConfig = DEFAULT_PROMPT_BORDER_CONFIG;
let activeContextRailRuntime: ContextRailRuntime | undefined;
let activePromptBorderEditor: CustomEditor | undefined;
let sessionStyleOverride: BorderStyleName | undefined;
let sessionLayoutOverride: BorderLayoutName | undefined;
let sessionRailEnabledOverride: boolean | undefined;
let builtInEditorOverride = false;
let didReadInvalidConfig = false;
let didNotifyInvalidConfig = false;
let lastInvalidConfigPath = CONFIG_PATH;
const promptLoadingGlyphDebugEnabledSessions = new WeakSet<ExtensionUIContext["setWorkingMessage"]>();
const promptLoadingGlyphDebugMountedSessions = new WeakSet<ExtensionUIContext["setWidget"]>();

function notifyInvalidConfig(ctx: { ui: { notify: (message: string, level?: "info" | "warning" | "error") => void } }): void {
	if (!didReadInvalidConfig || didNotifyInvalidConfig) return;
	didNotifyInvalidConfig = true;
	ctx.ui.notify(
		`Prompt border config at ${lastInvalidConfigPath} is invalid JSON; using defaults without overwriting the file.`,
		"warning",
	);
}
function buildPromptLoadingGlyphDebugMessage(config: PromptBorderConfig): string {
	const statusReport = createSpinnerFrameDebugReport("status", config.spinnerGlyphs.status);
	const activityReport = createSpinnerFrameDebugReport("activity", config.spinnerGlyphs.activity);
	return `[status ${statusReport.visibleFrames.length}/${statusReport.sourceFrames.length}] [activity ${activityReport.visibleFrames.length}/${activityReport.sourceFrames.length}] Working…`;
}

function clearPromptLoadingGlyphDebugUi(ctx: { ui: Pick<ExtensionUIContext, "setWidget" | "setWorkingMessage"> }): void {
	const { setWidget, setWorkingMessage } = ctx.ui;
	if (promptLoadingGlyphDebugMountedSessions.has(setWidget)) {
		setWidget("prompt-loading-glyphs-debug", undefined);
		promptLoadingGlyphDebugMountedSessions.delete(setWidget);
	}
	if (promptLoadingGlyphDebugEnabledSessions.has(setWorkingMessage)) {
		setWorkingMessage();
		promptLoadingGlyphDebugEnabledSessions.delete(setWorkingMessage);
	}
}

function contextRailRoleFrame(runtime: ContextRailRuntime, role: ContextRailRole): string {
	const asset = runtime.roleAssets[role];
	const frames = asset.frames.filter(frame => frame.trim().length > 0);
	if (frames.length === 0) return runtime.roleFallbacks[role];
	return frames[Math.abs(Math.trunc(runtime.roleFrames[role])) % frames.length] ?? runtime.roleFallbacks[role];
}

function contextRailRenderOptions(runtime: ContextRailRuntime): ContextRailRenderOptions {
	const presentationMode = runtime.config.mode;
	return {
		compact: contextRailCompact(runtime),
		pointer: runtime.config.pointer.visibility,
		labels: runtime.config.labels,
		labelPosition: runtime.config.labelPosition,
		showLabelGlyph: runtime.config.showLabelGlyph,
		labelGlyphs: runtime.config.labelGlyph.frames,
		labelFrame: runtime.labelGlyphFrame,
		labelGlyphFallback: runtime.labelGlyphFallback,
		labelGlyphSize: runtime.config.labelGlyph.size,
		pointerGlyphs: runtime.config.pointerGlyph.frames,
		pointerFrame: runtime.pointerGlyphFrame,
		pointerGlyphFallback: runtime.pointerGlyphFallback,
		presentation: {
			mode: presentationMode,
			meaningPlacement: presentationMode === "full" ? "beside" : runtime.config.custom.meaningPlacement,
			roles: {
				speculation: {
					frame: contextRailRoleFrame(runtime, "speculation"),
					meaning: runtime.config.speculation.meaning,
					visible: runtime.boundaries?.speculationPercent != null,
				},
				pointer: {
					frame: contextRailRoleFrame(runtime, "pointer"),
					meaning: runtime.config.pointer.meaning,
					visible: runtime.config.pointer.visibility !== "hidden",
				},
				compaction: {
					frame: contextRailRoleFrame(runtime, "compaction"),
					meaning: runtime.config.compaction.meaning,
					visible: runtime.boundaries?.thresholdPercent != null,
				},
				maximum: {
					frame: contextRailRoleFrame(runtime, "maximum"),
					meaning: runtime.config.maximum.meaning,
					visible: true,
				},
			},
			customItems: runtime.config.custom.items,
		},
	};
}


/**
 * The host's attachment band keeps the editor instance it was created with, while
 * setEditorComponent replaces that instance. Delegate rendering to OMP's native band
 * while rebinding it to the active border editor.
 */
function mountPromptAttachmentWidget(ctx: {
	hasUI: boolean;
	ui: { setWidget?: ExtensionUIContext["setWidget"] };
}): void {
	if (!ctx.hasUI || ctx.ui.setWidget === undefined) return;
	ctx.ui.setWidget(
		PROMPT_ATTACHMENT_WIDGET_KEY,
		tui => {
			let editor: CustomEditor | undefined;
			let band: AttachmentChipsBand | undefined;
			return {
				render(width: number): readonly string[] {
					const activeEditor = activePromptBorderEditor;
					if (activeEditor === undefined) return [];
					if (activeEditor !== editor) {
						editor = activeEditor;
						band = new AttachmentChipsBand(activeEditor, tui.imageBudget, () => tui.requestRender());
					}
					return band?.render(width) ?? [];
				},
				invalidate(): void {},
				dispose(): void {
					editor = undefined;
					band = undefined;
				},
			};
		},
		{ placement: "aboveEditor" },
	);
}

function mountContextRailWidget(ctx: { hasUI: boolean; ui: { setWidget?: ExtensionUIContext["setWidget"] } }): void {
	const runtime = activeContextRailRuntime;
	if (runtime !== undefined && !contextRailVisible(runtime)) clearContextRailRoleTimers(runtime);
	if (
		!ctx.hasUI ||
		ctx.ui.setWidget === undefined ||
		runtime === undefined ||
		!contextRailVisible(runtime) ||
		runtime.config.placement === "inside"
	) {
		ctx.ui.setWidget?.(CONTEXT_RAIL_WIDGET_KEY, undefined);
		return;
	}
	const placement = runtime.config.placement === "above" ? "aboveEditor" : "belowEditor";
	ctx.ui.setWidget(
		CONTEXT_RAIL_WIDGET_KEY,
		(_tui, theme) => ({
			render(width: number): readonly string[] {
				if (!contextRailVisible(runtime)) return [];
				scheduleContextRailRoleFrames(runtime);
				const horizontal = theme.boxRound.horizontal;
				return renderContextRailRows(
					width,
					createContextRailPalette(theme, horizontal),
					runtime.usage,
					runtime.boundaries,
					contextRailRenderOptions(runtime),
				);
			},
			invalidate(): void {},
			dispose(): void {},
		}),
		{ placement },
	);
}

function mountPromptLoadingGlyphDebugWidget(
	ctx: { ui: Pick<ExtensionUIContext, "setWidget"> },
	config: PromptBorderConfig,
): void {
	const { setWidget } = ctx.ui;
	setWidget("prompt-loading-glyphs-debug", (tui: unknown) => {
		const box = new Box(1, 0);
		const loaders: Loader[] = [];
		const tuiInstance = tui as ConstructorParameters<typeof Loader>[0];
		box.addChild(new Text(formatPromptLoadingGlyphDemoSummary(config), 0, 0));
		for (const slot of SPINNER_GLYPH_SLOTS) {
			const glyphConfig = config.spinnerGlyphs[slot];
			const loader = new Loader(
				tuiInstance,
				value => value,
				value => value,
				`${slot} loading`,
				buildTimedSpinnerFrames(glyphConfig.frames, glyphConfig.frameMs),
			);
			loaders.push(loader);
			box.addChild(loader);
		}
		return {
			render(width: number): readonly string[] {
				return box.render(width);
			},
			invalidate(): void {
				box.invalidate();
			},
			dispose(): void {
				for (const loader of loaders) loader.dispose();
			},
		};
	});
	promptLoadingGlyphDebugMountedSessions.add(setWidget);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getGlyphTextPath(configPath: string, slot: PromptBorderGlyphSlot): string {
	return path.join(path.dirname(configPath), GLYPH_TEXT_FILE_NAMES[slot]);
}
function expandHome(rawPath: string): string {
	if (rawPath === "~") return os.homedir();
	if (rawPath.startsWith("~/")) return path.join(os.homedir(), rawPath.slice(2));
	return rawPath;
}

function getContextRailLabelPath(config: ContextRailConfig): string {
	return path.join(expandHome(config.glyphDirectory), CONTEXT_RAIL_LABEL_FILE_NAME);
}

async function readContextRailLabelText(config: ContextRailConfig): Promise<string | undefined> {
	try {
		const file = Bun.file(getContextRailLabelPath(config));
		if (!(await file.exists())) return undefined;
		return await file.text();
	} catch {
		return undefined;
	}
}
function getContextRailPointerPath(config: ContextRailConfig): string {
	return path.join(expandHome(config.glyphDirectory), CONTEXT_RAIL_POINTER_FILE_NAME);
}

async function readContextRailPointerText(config: ContextRailConfig): Promise<string | undefined> {
	try {
		const file = Bun.file(getContextRailPointerPath(config));
		if (!(await file.exists())) return undefined;
		return await file.text();
	} catch {
		return undefined;
	}
}

function getContextRailRolePath(config: ContextRailConfig, role: ContextRailRole): string {
	return path.join(expandHome(config.glyphDirectory), config[role].framesFile);
}

async function readContextRailRoleAsset(
	config: ContextRailConfig,
	role: ContextRailRole,
): Promise<ContextRailGlyphAsset> {
	try {
		const file = Bun.file(getContextRailRolePath(config, role));
		if (!(await file.exists())) return { frames: [], fps: undefined };
		return parseContextRailGlyphAsset(await file.text());
	} catch {
		return { frames: [], fps: undefined };
	}
}

async function loadContextRailRoleAssets(config: ContextRailConfig): Promise<ContextRailRoleAssets> {
	const entries = await Promise.all(
		CONTEXT_RAIL_ROLES.map(async role => [role, await readContextRailRoleAsset(config, role)] as const),
	);
	return Object.fromEntries(entries) as ContextRailRoleAssets;
}

function toPromptBorderJson(config: PromptBorderConfig): Record<string, unknown> {
	return {
		style: config.style,
		layout: config.layout,
		leftGlyph: {
			frameMs: config.leftGlyph.frameMs,
		},
		rightGlyph: {
			frameMs: config.rightGlyph.frameMs,
		},
		spinnerGlyphs: {
			status: {
				frameMs: config.spinnerGlyphs.status.frameMs,
			},
			activity: {
				frameMs: config.spinnerGlyphs.activity.frameMs,
			},
		},
	};
}

function toContextRailJson(config: ContextRailConfig): Record<string, unknown> {
	const serializeRole = (role: ContextRailRole): Record<string, unknown> => {
		const roleConfig = config[role];
		const serialized: Record<string, unknown> = {
			framesFile: roleConfig.framesFile,
			meaning: roleConfig.meaning,
		};
		if (roleConfig.fps !== undefined) serialized.fps = roleConfig.fps;
		if (role === "pointer") serialized.visibility = config.pointer.visibility;
		return serialized;
	};
	return {
		enabled: config.enabled,
		placement: config.placement,
		visibility: config.visibility,
		mode: config.mode,
		speculation: serializeRole("speculation"),
		pointer: serializeRole("pointer"),
		compaction: serializeRole("compaction"),
		maximum: serializeRole("maximum"),
		custom: {
			meaningPlacement: config.custom.meaningPlacement,
			items: config.custom.items.map(item => ({ role: item.role, template: item.template })),
		},
		labels: config.labels,
		labelPosition: config.labelPosition,
		showLabelGlyph: config.showLabelGlyph !== false,
		glyphDirectory: config.glyphDirectory,
	};
}


type ResolvedPromptBorderConfigPaths = {
	configPath: string;
	legacyConfigPath?: string;
	legacyAssetDirectory?: string;
};

function resolveConfigPaths(input: PromptBorderConfigPathInput = CONFIG_PATH): ResolvedPromptBorderConfigPaths {
	if (typeof input === "string") {
		const configPath = input;
		const legacyConfigPath =
			configPath === CONFIG_PATH
				? LEGACY_CONFIG_PATH
				: path.basename(path.dirname(configPath)) === "prompt-border"
					? path.join(path.dirname(path.dirname(configPath)), "config.json")
					: undefined;
		return {
			configPath,
			legacyConfigPath,
			legacyAssetDirectory: legacyConfigPath ? path.dirname(legacyConfigPath) : undefined,
		};
	}
	const configPath = input?.destinationPath ?? input?.destination ?? input?.configPath ?? CONFIG_PATH;
	const legacyConfigPath = input?.legacyConfigPath ?? input?.legacyPath ?? input?.legacy;
	return {
		configPath,
		legacyConfigPath,
		legacyAssetDirectory: input?.legacyAssetDirectory ?? (legacyConfigPath ? path.dirname(legacyConfigPath) : undefined),
	};
}

function persistedConfigJson(config: PromptBorderConfig): Record<string, unknown> {
	return {
		promptBorder: toPromptBorderJson(config),
		contextRail: toContextRailJson(config.contextRail),
	};
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	const temporaryPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
	);
	try {
		await Bun.write(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
		await rename(temporaryPath, filePath);
	} catch (error) {
		await unlink(temporaryPath).catch(() => {});
		throw error;
	}
}

function legacyInlineGlyphSeed(
	rawPromptBorder: Record<string, unknown>,
	slot: PromptBorderGlyphSlot,
	fallback: string,
): string {
	const key = slot === "left" || slot === "right" ? `${slot}Glyph` : "spinnerGlyphs";
	const value = slot === "left" || slot === "right" ? rawPromptBorder[key] : isRecord(rawPromptBorder[key]) ? rawPromptBorder[key][slot] : undefined;
	const glyphConfig = isRecord(value) ? value : {};
	if (typeof glyphConfig.glyphs === "string" && glyphConfig.glyphs.trim().length > 0) return glyphConfig.glyphs;
	if (
		Array.isArray(glyphConfig.frames) &&
		glyphConfig.frames.length > 0 &&
		glyphConfig.frames.every(frame => typeof frame === "string")
	) {
		const frames = glyphConfig.frames as string[];
		const joined = frames.join(" ");
		if (joined.trim().length > 0) return joined;
	}
	return fallback;
}

async function readGlyphTextFile(configPath: string, slot: PromptBorderGlyphSlot): Promise<string | undefined> {
	const file = Bun.file(getGlyphTextPath(configPath, slot));
	if (!(await file.exists())) return undefined;
	return await file.text();
}

async function ensureGlyphTextFile(configPath: string, slot: PromptBorderGlyphSlot, seedText: string): Promise<string> {
	const glyphPath = getGlyphTextPath(configPath, slot);
	await mkdir(path.dirname(glyphPath), { recursive: true });
	const file = Bun.file(glyphPath);
	if (await file.exists()) return await file.text();
	const contents = seedText.length > 0 && !seedText.endsWith("\n") ? `${seedText}\n` : seedText;
	await Bun.write(glyphPath, contents);
	return contents;
}

async function ensureMigratedGlyphTextFile(
	paths: ResolvedPromptBorderConfigPaths,
	slot: PromptBorderGlyphSlot,
	seedText: string,
): Promise<string> {
	const destinationPath = getGlyphTextPath(paths.configPath, slot);
	await mkdir(path.dirname(destinationPath), { recursive: true });
	const destination = Bun.file(destinationPath);
	if (await destination.exists()) return await destination.text();
	if (paths.legacyAssetDirectory !== undefined) {
		const legacyPath = path.join(paths.legacyAssetDirectory, GLYPH_TEXT_FILE_NAMES[slot]);
		const legacy = Bun.file(legacyPath);
		if (await legacy.exists()) {
			const bytes = await legacy.arrayBuffer();
			await Bun.write(destinationPath, bytes);
			return await destination.text();
		}
	}
	return ensureGlyphTextFile(paths.configPath, slot, seedText);
}

function parsePromptBorderConfigJson(rawText: string): { json: unknown; invalid: boolean } {
	try {
		return { json: JSON.parse(rawText), invalid: false };
	} catch {
		return { json: null, invalid: true };
	}
}

export function normalizePromptBorderConfig(
	raw: unknown,
	glyphTexts: Partial<Record<PromptBorderGlyphSlot, string>> = {},
	contextRailGlyphAsset: ContextRailGlyphAsset = { frames: [], fps: undefined },
	contextRailPointerGlyphAsset: ContextRailGlyphAsset = { frames: [], fps: undefined },
): PromptBorderConfig {
	const promptBorder = isRecord(raw) && isRecord(raw.promptBorder) ? raw.promptBorder : {};
	const contextRail = isRecord(raw) && isRecord(raw.contextRail) ? raw.contextRail : {};
	const leftGlyph = isRecord(promptBorder.leftGlyph) ? promptBorder.leftGlyph : {};
	const rightGlyph = isRecord(promptBorder.rightGlyph) ? promptBorder.rightGlyph : {};
	const spinnerGlyphs = isRecord(promptBorder.spinnerGlyphs) ? promptBorder.spinnerGlyphs : {};
	const style =
		typeof promptBorder.style === "string" && isBorderStyleName(promptBorder.style)
			? promptBorder.style
			: DEFAULT_PROMPT_BORDER_CONFIG.style;
	const layout =
		typeof promptBorder.layout === "string" && isBorderLayoutName(promptBorder.layout)
			? promptBorder.layout
			: DEFAULT_PROMPT_BORDER_CONFIG.layout;
	const normalizeGlyph = (
		glyph: Record<string, unknown>,
		slot: PromptBorderGlyphSlot,
		defaultFrameMs: number,
	): PromptBorderGlyphConfig => {
		const frameMs =
			typeof glyph.frameMs === "number" &&
			Number.isFinite(glyph.frameMs) &&
			glyph.frameMs >= 16 &&
			glyph.frameMs <= 1000
				? glyph.frameMs
				: defaultFrameMs;
		const glyphText =
			typeof glyphTexts[slot] === "string"
				? glyphTexts[slot]
				: typeof glyph.glyphs === "string"
					? glyph.glyphs
					: "";
		const frames = glyphText.trim().length > 0 ? parseGlyphFrames(glyphText) : [];
		return {
			frameMs,
			glyphs: frames.length > 0 ? glyphText : "",
			frames,
		};
	};
	return {
		style,
		layout,
		leftGlyph: normalizeGlyph(leftGlyph, "left", DEFAULT_GLYPH_FRAME_MS),
		rightGlyph: normalizeGlyph(rightGlyph, "right", DEFAULT_GLYPH_FRAME_MS),
		spinnerGlyphs: {
			status: normalizeGlyph(
				isRecord(spinnerGlyphs.status) ? spinnerGlyphs.status : {},
				"status",
				DEFAULT_SPINNER_GLYPH_FRAME_MS,
			),
			activity: normalizeGlyph(
				isRecord(spinnerGlyphs.activity) ? spinnerGlyphs.activity : {},
				"activity",
				DEFAULT_SPINNER_GLYPH_FRAME_MS,
			),
		},
		contextRail: normalizeContextRailConfig(contextRail, contextRailGlyphAsset, contextRailPointerGlyphAsset),
	};
}

type PersistedPromptBorderConfig = {
	merged: Record<string, unknown>;
	glyphTexts: Record<PromptBorderGlyphSlot, string>;
	contextRailLabelText?: string;
	contextRailPointerText?: string;
	config: PromptBorderConfig;
};

async function buildPersistedPromptBorderConfig(
	paths: ResolvedPromptBorderConfigPaths,
	raw: unknown,
	glyphTexts: Record<PromptBorderGlyphSlot, string>,
): Promise<PersistedPromptBorderConfig> {
	const contextRail = normalizeContextRailConfig(isRecord(raw) ? raw.contextRail : undefined);
	const [contextRailLabelText, contextRailPointerText] = await Promise.all([
		readContextRailLabelText(contextRail),
		readContextRailPointerText(contextRail),
	]);
	const config = normalizePromptBorderConfig(
		raw,
		glyphTexts,
		parseContextRailGlyphAsset(contextRailLabelText ?? ""),
		parseContextRailGlyphAsset(contextRailPointerText ?? ""),
	);
	return {
		merged: persistedConfigJson(config),
		glyphTexts,
		contextRailLabelText,
		contextRailPointerText,
		config,
	};
}

async function ensurePersistedPromptBorderConfig(
	input: PromptBorderConfigPathInput = CONFIG_PATH,
): Promise<PersistedPromptBorderConfig | undefined> {
	const paths = resolveConfigPaths(input);
	await mkdir(path.dirname(paths.configPath), { recursive: true });
	const file = Bun.file(paths.configPath);
	if (await file.exists()) {
		const parsed = parsePromptBorderConfigJson(await file.text());
		if (parsed.invalid || !isRecord(parsed.json)) return undefined;
		const promptBorder = isRecord(parsed.json.promptBorder) ? parsed.json.promptBorder : {};
		const glyphTexts = {
			left: await ensureGlyphTextFile(
				paths.configPath,
				"left",
				legacyInlineGlyphSeed(promptBorder, "left", DEFAULT_LEFT_GLYPH_TEXT),
			),
			right: await ensureGlyphTextFile(paths.configPath, "right", legacyInlineGlyphSeed(promptBorder, "right", "")),
			status: await ensureGlyphTextFile(paths.configPath, "status", legacyInlineGlyphSeed(promptBorder, "status", "")),
			activity: await ensureGlyphTextFile(paths.configPath, "activity", legacyInlineGlyphSeed(promptBorder, "activity", "")),
		};
		const persisted = await buildPersistedPromptBorderConfig(paths, parsed.json, glyphTexts);
		await writeJsonAtomically(paths.configPath, persisted.merged);
		return persisted;
	}

	let legacyRaw: unknown = {};
	if (paths.legacyConfigPath !== undefined) {
		const legacyFile = Bun.file(paths.legacyConfigPath);
		if (await legacyFile.exists()) {
			const parsed = parsePromptBorderConfigJson(await legacyFile.text());
			if (!parsed.invalid && isRecord(parsed.json)) legacyRaw = parsed.json;
		}
	}
	const legacyPromptBorder = isRecord(legacyRaw) && isRecord(legacyRaw.promptBorder) ? legacyRaw.promptBorder : {};
	const glyphTexts = {
		left: await ensureMigratedGlyphTextFile(
			paths,
			"left",
			legacyInlineGlyphSeed(legacyPromptBorder, "left", DEFAULT_LEFT_GLYPH_TEXT),
		),
		right: await ensureMigratedGlyphTextFile(
			paths,
			"right",
			legacyInlineGlyphSeed(legacyPromptBorder, "right", ""),
		),
		status: await ensureMigratedGlyphTextFile(
			paths,
			"status",
			legacyInlineGlyphSeed(legacyPromptBorder, "status", ""),
		),
		activity: await ensureMigratedGlyphTextFile(
			paths,
			"activity",
			legacyInlineGlyphSeed(legacyPromptBorder, "activity", ""),
		),
	};
	const persisted = await buildPersistedPromptBorderConfig(paths, legacyRaw, glyphTexts);
	await writeJsonAtomically(paths.configPath, persisted.merged);
	return persisted;
}

export async function readPromptBorderConfig(input: PromptBorderConfigPathInput = CONFIG_PATH): Promise<PromptBorderConfig> {
	const paths = resolveConfigPaths(input);
	const file = Bun.file(paths.configPath);
	if (!(await file.exists())) {
		didReadInvalidConfig = false;
		return DEFAULT_PROMPT_BORDER_CONFIG;
	}
	const parsed = parsePromptBorderConfigJson(await file.text());
	if (parsed.invalid || !isRecord(parsed.json)) {
		didReadInvalidConfig = true;
		lastInvalidConfigPath = paths.configPath;
		return DEFAULT_PROMPT_BORDER_CONFIG;
	}
	const [leftText, rightText, statusText, activityText] = await Promise.all([
		readGlyphTextFile(paths.configPath, "left"),
		readGlyphTextFile(paths.configPath, "right"),
		readGlyphTextFile(paths.configPath, "status"),
		readGlyphTextFile(paths.configPath, "activity"),
	]);
	const glyphTexts: Partial<Record<PromptBorderGlyphSlot, string>> = {};
	if (leftText !== undefined) glyphTexts.left = leftText;
	if (rightText !== undefined) glyphTexts.right = rightText;
	if (statusText !== undefined) glyphTexts.status = statusText;
	if (activityText !== undefined) glyphTexts.activity = activityText;
	const contextRail = normalizeContextRailConfig(parsed.json.contextRail);
	const [contextRailLabelText, contextRailPointerText] = await Promise.all([
		readContextRailLabelText(contextRail),
		readContextRailPointerText(contextRail),
	]);
	didReadInvalidConfig = false;
	return normalizePromptBorderConfig(
		parsed.json,
		glyphTexts,
		parseContextRailGlyphAsset(contextRailLabelText ?? ""),
		parseContextRailGlyphAsset(contextRailPointerText ?? ""),
	);
}

export async function ensurePromptBorderConfigFile(input: PromptBorderConfigPathInput = CONFIG_PATH): Promise<PromptBorderConfig> {
	const persisted = await ensurePersistedPromptBorderConfig(input);
	if (persisted === undefined) {
		didReadInvalidConfig = true;
		lastInvalidConfigPath = resolveConfigPaths(input).configPath;
		return DEFAULT_PROMPT_BORDER_CONFIG;
	}
	didReadInvalidConfig = false;
	return readPromptBorderConfig(input);
}

export async function writePromptBorderConfig(
	config: PromptBorderConfig,
	input: PromptBorderConfigPathInput = CONFIG_PATH,
): Promise<PromptBorderConfig> {
	const persisted = await ensurePersistedPromptBorderConfig(input);
	if (persisted === undefined) {
		didReadInvalidConfig = true;
		lastInvalidConfigPath = resolveConfigPaths(input).configPath;
		return DEFAULT_PROMPT_BORDER_CONFIG;
	}
	const next = normalizePromptBorderConfig(
		{
			promptBorder: toPromptBorderJson(config),
			contextRail: toContextRailJson(config.contextRail),
		},
		persisted.glyphTexts,
		parseContextRailGlyphAsset(persisted.contextRailLabelText ?? ""),
		parseContextRailGlyphAsset(persisted.contextRailPointerText ?? ""),
	);
	await writeJsonAtomically(resolveConfigPaths(input).configPath, persistedConfigJson(next));
	didReadInvalidConfig = false;
	return next;
}

export async function writePromptBorderConfigSelection(
	state: PromptBorderState,
	input: PromptBorderConfigPathInput = CONFIG_PATH,
): Promise<PromptBorderConfig> {
	const current = await ensurePromptBorderConfigFile(input);
	return writePromptBorderConfig(
		{
			...current,
			style: state.style,
			layout: state.layout,
		},
		input,
	);
}

function mergeContextRailConfigUpdate(
	current: ContextRailConfig,
	update: ContextRailConfigUpdate,
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...current };
	for (const [key, value] of Object.entries(update)) {
		if (key === "pointer" && typeof value === "string" && isRecord(merged.pointer)) {
			merged.pointer = { ...(merged.pointer as Record<string, unknown>), visibility: value };
		} else if (
			((CONTEXT_RAIL_ROLES as readonly string[]).includes(key) || key === "custom") &&
			isRecord(value) &&
			isRecord(merged[key])
		) {
			merged[key] = { ...(merged[key] as Record<string, unknown>), ...value };
		} else {
			merged[key] = value;
		}
	}
	return merged;
}

export async function writeContextRailConfigSelection(
	update: ContextRailConfigUpdate,
	input: PromptBorderConfigPathInput = CONFIG_PATH,
): Promise<PromptBorderConfig> {
	const current = await ensurePromptBorderConfigFile(input);
	const nextContextRail = normalizeContextRailConfig(mergeContextRailConfigUpdate(current.contextRail, update));
	return writePromptBorderConfig({ ...current, contextRail: nextContextRail }, input);
}

export type SpinnerGlyphFrameOverride = {
	frames: readonly string[];
	frameMs: number;
};
export type SpinnerGlyphFrameOverrides = Partial<Record<SpinnerType, SpinnerGlyphFrameOverride>>;

export function installSpinnerGlyphFrames(
	themeInstance: Pick<Theme, "getSpinnerFrames">,
	frameOverrides: SpinnerGlyphFrameOverrides,
): (() => void) | undefined {
	const statusFrames =
		frameOverrides.status === undefined
			? undefined
			: buildTimedSpinnerFrames(frameOverrides.status.frames, frameOverrides.status.frameMs);
	const activityFrames =
		frameOverrides.activity === undefined
			? undefined
			: buildTimedSpinnerFrames(frameOverrides.activity.frames, frameOverrides.activity.frameMs);
	const overrideFrames = (type: SpinnerType): readonly string[] | undefined => {
		if (type === "status") {
			return statusFrames !== undefined && statusFrames.length > 0 ? statusFrames : undefined;
		}
		return activityFrames !== undefined && activityFrames.length > 0 ? activityFrames : undefined;
	};
	if (overrideFrames("status") === undefined && overrideFrames("activity") === undefined) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(themeInstance, "getSpinnerFrames");
	const original = themeInstance.getSpinnerFrames.bind(themeInstance);
	Object.defineProperty(themeInstance, "getSpinnerFrames", {
		configurable: true,
		value(type: SpinnerType = "status"): string[] {
			const frames = overrideFrames(type);
			return frames === undefined ? original(type) : Array.from(frames);
		},
	});
	return () => {
		if (descriptor) {
			Object.defineProperty(themeInstance, "getSpinnerFrames", descriptor);
			return;
		}
		Reflect.deleteProperty(themeInstance, "getSpinnerFrames");
	};
}

export function isBorderStyleName(value: string): value is BorderStyleName {
	return (STYLE_NAMES as readonly string[]).includes(value);
}

export function isBorderLayoutName(value: string): value is BorderLayoutName {
	return (LAYOUT_NAMES as readonly string[]).includes(value);
}

const spinnerGlyphFrameRestores = new WeakMap<Pick<Theme, "getSpinnerFrames">, () => void>();

function restoreSpinnerGlyphFrames(themeInstance: Pick<Theme, "getSpinnerFrames"> | undefined): void {
	if (themeInstance === undefined) return;
	const restore = spinnerGlyphFrameRestores.get(themeInstance);
	if (restore === undefined) return;
	spinnerGlyphFrameRestores.delete(themeInstance);
	restore();
}

function applySpinnerGlyphFrames(
	themeInstance: Pick<Theme, "getSpinnerFrames"> | undefined,
	config: PromptBorderConfig,
): void {
	restoreSpinnerGlyphFrames(themeInstance);
	if (themeInstance === undefined) return;
	const restore = installSpinnerGlyphFrames(themeInstance, {
		status: config.spinnerGlyphs.status,
		activity: config.spinnerGlyphs.activity,
	});
	if (restore === undefined) {
		spinnerGlyphFrameRestores.delete(themeInstance);
		return;
	}
	spinnerGlyphFrameRestores.set(themeInstance, restore);
}

export function getPromptBorderArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
	const normalized = argumentPrefix.toLowerCase();
	const hasTrailingSpace = /\s$/u.test(normalized);
	const parts = normalized.trim().split(/\s+/u).filter(Boolean);
	const tokenPrefix = hasTrailingSpace ? "" : (parts.at(-1) ?? "");
	const complete = (value: string): AutocompleteItem => ({ value, label: value });
	if (parts.length === 0) return PRIMARY_COMMAND_OPTIONS.map(complete);
	if (parts.length === 1 && !hasTrailingSpace) {
		return PRIMARY_COMMAND_OPTIONS.filter(option => option.startsWith(tokenPrefix)).map(complete);
	}
	const first = parts[0]!;
	if (first === "layout" && parts.length <= 2) {
		return LAYOUT_NAMES.filter(layout => layout.startsWith(tokenPrefix)).map(layout => ({
			value: `layout ${layout}`,
			label: layout,
		}));
	}
	if (isBorderStyleName(first) && parts.length <= 2) {
		return LAYOUT_NAMES.filter(layout => layout.startsWith(tokenPrefix)).map(layout => ({
			value: `${first} ${layout}`,
			label: layout,
		}));
	}
	if (first === "rail" && parts.length <= 2) {
		return ["toggle"].filter(value => value.startsWith(tokenPrefix)).map(value => ({ value: `rail ${value}`, label: value }));
	}
	if (first === "glyphs" && parts.length <= 3) {
		if (parts.length === 1) return [{ value: "glyphs debug", label: "debug" }];
		if (parts.length === 2 && parts[1] !== "debug") {
			if ("debug".startsWith(tokenPrefix)) return [{ value: "glyphs debug", label: "debug" }];
			return [];
		}
		if (parts.length === 2) {
			return LOADING_GLYPH_DEBUG_ACTIONS.map(action => ({
				value: `glyphs debug ${action}`,
				label: action,
			}));
		}
		return LOADING_GLYPH_DEBUG_ACTIONS.filter(action => action.startsWith(tokenPrefix)).map(action => ({
			value: `glyphs debug ${action}`,
			label: action,
		}));
	}
	return null;
}

export type ContextRailAction =
	| { kind: "status" }
	| { kind: "toggle" }
	| { kind: "set"; update: ContextRailConfigUpdate }
	| { kind: "init"; target: "glyphs" }
	| { kind: "invalid" };

const CONTEXT_RAIL_ROOT_OPTIONS = ["on", "off", "toggle", "status", "init", "placement", "visibility", "pointer", "labels", "label-glyph", "position"] as const;

function isContextRailPlacement(value: string): value is ContextRailPlacement {
	return (CONTEXT_RAIL_PLACEMENTS as readonly string[]).includes(value);
}

function isContextRailVisibility(value: string): value is ContextRailVisibility {
	return (CONTEXT_RAIL_VISIBILITIES as readonly string[]).includes(value);
}

function isContextRailPointer(value: string): value is ContextRailPointer {
	return (CONTEXT_RAIL_POINTERS as readonly string[]).includes(value);
}

function isContextRailLabels(value: string): value is ContextRailLabels {
	return (CONTEXT_RAIL_LABELS as readonly string[]).includes(value);
}

function isContextRailLabelPosition(value: string): value is ContextRailLabelPosition {
	return (CONTEXT_RAIL_POSITIONS as readonly string[]).includes(value);
}
function isContextRailLabelGlyphVisibility(value: string): value is (typeof CONTEXT_RAIL_LABEL_GLYPH_VISIBILITIES)[number] {
	return (CONTEXT_RAIL_LABEL_GLYPH_VISIBILITIES as readonly string[]).includes(value);
}

export function getContextRailArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
	const normalized = argumentPrefix.toLowerCase();
	const hasTrailingSpace = /\s$/u.test(normalized);
	const parts = normalized.trim().split(/\s+/u).filter(Boolean);
	const tokenPrefix = hasTrailingSpace ? "" : (parts.at(-1) ?? "");
	const complete = (value: string): AutocompleteItem => ({ value, label: value });
	if (parts.length === 0) return CONTEXT_RAIL_ROOT_OPTIONS.map(complete);
	if (parts.length === 1 && !hasTrailingSpace) {
		return CONTEXT_RAIL_ROOT_OPTIONS.filter(option => option.startsWith(tokenPrefix)).map(complete);
	}
	if (parts.length === 1 || (parts.length === 2 && !hasTrailingSpace)) {
		const options =
			parts[0] === "placement"
				? CONTEXT_RAIL_PLACEMENTS
				: parts[0] === "visibility"
					? CONTEXT_RAIL_VISIBILITIES
					: parts[0] === "pointer"
						? CONTEXT_RAIL_POINTERS
						: parts[0] === "labels"
							? CONTEXT_RAIL_LABELS
							: parts[0] === "label-glyph"
								? CONTEXT_RAIL_LABEL_GLYPH_VISIBILITIES
								: parts[0] === "position"
									? CONTEXT_RAIL_POSITIONS
									: parts[0] === "init"
										? ["glyphs"]
										: [];
		return options
			.filter(option => option.startsWith(tokenPrefix))
			.map(option => ({ value: `${parts[0]} ${option}`, label: option }));
	}
	return null;
}

export function parseContextRailArgs(args: string): ContextRailAction {
	const parts = args.trim().toLowerCase().split(/\s+/u).filter(Boolean);
	if (parts.length === 0 || (parts.length === 1 && parts[0] === "status")) return { kind: "status" };
	if (parts.length === 1 && parts[0] === "toggle") return { kind: "toggle" };
	if (parts.length === 1 && parts[0] === "on") return { kind: "set", update: { enabled: true } };
	if (parts.length === 1 && parts[0] === "off") return { kind: "set", update: { enabled: false } };
	if (parts.length === 1 && parts[0] === "init") return { kind: "init", target: "glyphs" };
	if (parts.length === 2 && parts[0] === "init" && parts[1] === "glyphs") return { kind: "init", target: "glyphs" };
	if (parts.length !== 2) return { kind: "invalid" };
	const value = parts[1]!;
	if (parts[0] === "placement" && isContextRailPlacement(value)) return { kind: "set", update: { placement: value } };
	if (parts[0] === "visibility" && isContextRailVisibility(value)) return { kind: "set", update: { visibility: value } };
	if (parts[0] === "pointer" && isContextRailPointer(value)) return { kind: "set", update: { pointer: value } };
	if (parts[0] === "labels" && isContextRailLabels(value)) return { kind: "set", update: { labels: value } };
	if (parts[0] === "position" && isContextRailLabelPosition(value)) return { kind: "set", update: { labelPosition: value } };
	if (parts[0] === "label-glyph" && isContextRailLabelGlyphVisibility(value)) {
		return { kind: "set", update: { showLabelGlyph: value === "on" } };
	}
	return { kind: "invalid" };
}

export function getPromptLoadingGlyphArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
	const normalized = argumentPrefix.toLowerCase();
	const hasTrailingSpace = /\s$/.test(normalized);
	const parts = normalized.trim().split(/\s+/u).filter(Boolean);
	const tokenPrefix = hasTrailingSpace ? "" : (parts.at(-1) ?? "");
	if (parts.length === 0) return [{ value: "debug", label: "debug" }];
	if (parts.length === 1) {
		if (parts[0] === "debug") {
			return LOADING_GLYPH_DEBUG_ACTIONS.map(action => ({ value: `debug ${action}`, label: action }));
		}
		if (!hasTrailingSpace) {
			return LOADING_GLYPH_DEBUG_ROOT_OPTIONS
				.filter(option => option.startsWith(tokenPrefix))
				.map(option => ({ value: option, label: option }));
		}
	}
	if (parts[0] === "debug" && parts.length === 2 && !hasTrailingSpace) {
		return LOADING_GLYPH_DEBUG_ACTIONS
			.filter(action => action.startsWith(tokenPrefix))
			.map(action => ({ value: `debug ${action}`, label: action }));
	}
	return null;
}

export function parsePromptLoadingGlyphArgs(args: string): PromptLoadingGlyphDebugAction {
	const parts = args.trim().toLowerCase().split(/\s+/u).filter(Boolean);
	if (parts.length === 2 && parts[0] === "debug" && parts[1] === "frames") return { kind: "frames" };
	if (parts.length === 2 && parts[0] === "debug" && parts[1] === "demo") return { kind: "demo" };
	if (parts.length === 2 && parts[0] === "debug" && parts[1] === "on") return { kind: "on" };
	if (parts.length === 2 && parts[0] === "debug" && parts[1] === "off") return { kind: "off" };
	return { kind: "invalid" };
}
export function parsePromptBorderArgs(args: string, current: PromptBorderState): PromptBorderAction {
	const parts = args.trim().toLowerCase().split(/\s+/u).filter(Boolean);
	if (parts.length === 0 || (parts.length === 1 && parts[0] === "config")) return { kind: "config" };
	if (parts.length === 1 && parts[0] === "status") return { kind: "status" };
	if (parts.length === 1 && parts[0] === "reset") return { kind: "reset" };
	if (parts.length === 2 && parts[0] === "rail" && parts[1] === "toggle") return { kind: "rail-toggle" };
	if (parts.length === 3 && parts[0] === "glyphs" && parts[1] === "debug") {
		const action = parts[2];
		if ((LOADING_GLYPH_DEBUG_ACTIONS as readonly string[]).includes(action!)) {
			return { kind: "glyph-debug", action: action as (typeof LOADING_GLYPH_DEBUG_ACTIONS)[number] };
		}
		return { kind: "invalid" };
	}
	if (parts[0] === "layout") {
		if (parts.length !== 2 || !isBorderLayoutName(parts[1]!)) return { kind: "invalid" };
		return { kind: "apply", state: { ...current, layout: parts[1]! } };
	}
	if (!isBorderStyleName(parts[0]!)) return { kind: "invalid" };
	if (parts.length === 1) return { kind: "apply", state: { ...current, style: parts[0]! } };
	if (parts.length === 2 && isBorderLayoutName(parts[1]!)) {
		return { kind: "apply", state: { style: parts[0]!, layout: parts[1]! } };
	}
	return { kind: "invalid" };
}

export function withPromptBorder(theme: EditorTheme, state: PromptBorderState, glyphOverride?: PromptBorderGlyphs): EditorTheme {
	return {
		...theme,
		symbols: {
			...theme.symbols,
			boxRound: {
				...theme.symbols.boxRound,
				...(glyphOverride ?? borderStyles[state.style]),
			},
		},
	};
}


function withSeparateBottomGlyphs(glyphs: PromptBorderGlyphs): PromptBorderGlyphs {
	return {
		...glyphs,
		bottomLeft: glyphs.vertical,
		bottomRight: glyphs.vertical,
	};
}

const ANSI_SGR_PATTERN = /\x1b\[[0-9;:]*m/g;
function isUpstreamBottomBorderRow(line: string, width: number, glyphs: PromptBorderGlyphs): boolean {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	return (
		plain === renderBottomBorderLine(width, glyphs, value => value) ||
		plain === renderBottomBorderLine(width, withSeparateBottomGlyphs(glyphs), value => value)
	);
}

function isUpstreamMergedBottomBodyRow(line: string, glyphs: PromptBorderGlyphs): boolean {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const chars = [...plain];
	return (
		chars.length >= 4 &&
		chars[0] === glyphs.bottomLeft &&
		chars[1] === glyphs.horizontal &&
		chars.at(-2) === glyphs.horizontal &&
		chars.at(-1) === glyphs.bottomRight
	);
}

function isImeSafeCursorTailRow(line: string, glyphs: PromptBorderGlyphs): boolean {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	return line.includes(CURSOR_MARKER) && plain.startsWith(glyphs.vertical) && !plain.endsWith(glyphs.vertical);
}

function isBodyOrUpstreamBottomBorderRow(line: string, width: number, glyphs: PromptBorderGlyphs): boolean {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const hasBothSideBorders = plain.startsWith(glyphs.vertical) && plain.endsWith(glyphs.vertical);
	return (
		hasBothSideBorders ||
		isImeSafeCursorTailRow(line, glyphs) ||
		isUpstreamBottomBorderRow(line, width, glyphs) ||
		isUpstreamMergedBottomBodyRow(line, glyphs)
	);
}

function normalizeUpstreamMergedBottomBodyRow(line: string, glyphs: PromptBorderGlyphs): string {
	if (!isUpstreamMergedBottomBodyRow(line, glyphs)) return line;
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const lastIndex = [...plain].length - 1;
	let visibleIndex = 0;
	return line.replace(/\x1b\[[0-9;:]*m|./gu, token => {
		if (token.startsWith("\x1b[")) return token;
		const replacement =
			visibleIndex === 0 || visibleIndex === lastIndex
				? glyphs.vertical
				: visibleIndex === 1 || visibleIndex === lastIndex - 1
					? " "
					: token;
		visibleIndex += 1;
		return replacement;
	});
}

function hideSideBorderGlyphs(line: string, glyphs: PromptBorderGlyphs): string {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const chars = [...plain];
	const hasLeftBorder = chars[0] === glyphs.vertical;
	const hasRightBorder = chars.at(-1) === glyphs.vertical;
	if ((!hasLeftBorder && !hasRightBorder) || chars.length < 2) return line;
	const leftPaddingIndex = hasLeftBorder ? 1 : -1;
	const rightPaddingIndex = hasRightBorder ? chars.length - 2 : -1;
	let visibleIndex = 0;
	return line.replace(/\x1b\[[0-9;:]*m|./gu, token => {
		if (token.startsWith("\x1b[")) return token;
		const shouldReplace =
			(token === glyphs.vertical &&
				((hasLeftBorder && visibleIndex === 0) || (hasRightBorder && visibleIndex === chars.length - 1))) ||
			(token === glyphs.horizontal &&
				(visibleIndex === leftPaddingIndex || visibleIndex === rightPaddingIndex));
		visibleIndex += 1;
		return shouldReplace ? " " : token;
	});
}

function stripSideRowHorizontalPadding(line: string, glyphs: PromptBorderGlyphs): string {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const chars = [...plain];
	if (chars.length < 4 || chars[0] !== glyphs.vertical || chars.at(-1) !== glyphs.vertical) return line;
	const leftPaddingIndex = 1;
	const rightPaddingIndex = chars.length - 2;
	let visibleIndex = 0;
	return line.replace(/\x1b\[[0-9;:]*m|./gu, token => {
		if (token.startsWith("\x1b[")) return token;
		const shouldReplace =
			token === glyphs.horizontal && (visibleIndex === leftPaddingIndex || visibleIndex === rightPaddingIndex);
		visibleIndex += 1;
		return shouldReplace ? " " : token;
	});
}


function locateTopBorderContent(
	line: string,
	glyphs: PromptBorderGlyphs,
	topBorder: EditorTopBorder | undefined,
): { firstContentIndex: number; lastContentIndex: number } | undefined {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const chars = [...plain];
	if (chars.length < 2 || chars[0] !== glyphs.topLeft || chars.at(-1) !== glyphs.topRight) return undefined;
	if (!topBorder) return undefined;

	const findContentIndex = (content: string): number => {
		const contentChars = [...content];
		if (contentChars.length === 0) return -1;
		for (let index = 1; index <= chars.length - contentChars.length; index += 1) {
			if (contentChars.every((char, contentIndex) => chars[index + contentIndex] === char)) return index;
		}
		return -1;
	};

	let plainContent = topBorder.content.replace(ANSI_SGR_PATTERN, "");
	let firstContentIndex = findContentIndex(plainContent);
	if (firstContentIndex === -1) {
		for (let width = topBorder.width - 1; width > 0; width -= 1) {
			const truncated = truncateToWidth(topBorder.content, width);
			plainContent = truncated.replace(ANSI_SGR_PATTERN, "");
			firstContentIndex = findContentIndex(plainContent);
			if (plainContent.length > 0 && firstContentIndex !== -1) break;
		}
	}
	if (plainContent.length === 0 || firstContentIndex === -1) return undefined;
	return {
		firstContentIndex,
		lastContentIndex: firstContentIndex + [...plainContent].length - 1,
	};
}

function hideTopBorderLine(line: string, glyphs: PromptBorderGlyphs, topBorder: EditorTopBorder | undefined): string | null {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const chars = [...plain];
	if (chars.length < 2 || chars[0] !== glyphs.topLeft || chars.at(-1) !== glyphs.topRight) return line;
	if (!topBorder) return null;
	const contentRange = locateTopBorderContent(line, glyphs, topBorder);
	if (!contentRange) return null;
	let visibleIndex = 0;
	return line.replace(/\x1b\[[0-9;:]*m|./gu, token => {
		if (token.startsWith("\x1b[")) return token;
		const shouldReplace =
			visibleIndex < contentRange.firstContentIndex || visibleIndex > contentRange.lastContentIndex;
		visibleIndex += 1;
		return shouldReplace ? " " : token;
	});
}

export function renderBottomBorderLine(width: number, glyphs: PromptBorderGlyphs, color: (str: string) => string): string {
	return color(`${glyphs.bottomLeft}${glyphs.horizontal.repeat(Math.max(0, width - 2))}${glyphs.bottomRight}`);
}

function replaceVisibleGlyphAt(line: string, targetIndex: number, targetWidth: number, frame: string): string {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const tokens = [...line.matchAll(/\x1b\[[0-9;:]*m|./gu)].map(match => match[0]);
	let visibleIndex = 0;
	let targetTokenIndex = -1;
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index]!.startsWith("\x1b[")) continue;
		if (visibleIndex === targetIndex) {
			targetTokenIndex = index;
			break;
		}
		visibleIndex += 1;
	}
	if (targetTokenIndex === -1) return line;

	const originalWidth = visibleWidth(plain);
	const frameWidth = visibleWidth(frame);
	let suffix = tokens.slice(targetTokenIndex + 1).join("");
	let consumedSpaces = 0;

	if (frameWidth > targetWidth) {
		const availableSpaces = suffix.replace(ANSI_SGR_PATTERN, "").match(/^ +/u)?.[0].length ?? 0;
		consumedSpaces = Math.min(frameWidth - targetWidth, availableSpaces);
		if (consumedSpaces > 0) {
			const suffixWidth = visibleWidth(suffix);
			suffix = sliceByColumn(suffix, consumedSpaces, Math.max(0, suffixWidth - consumedSpaces));
		}
	}

	const allowedFrameWidth = targetWidth + consumedSpaces;
	const fittedFrame = frameWidth > allowedFrameWidth ? truncateToWidth(frame, allowedFrameWidth, "") : frame;
	let replacement = fittedFrame;
	const replacementWidth = visibleWidth(replacement);
	if (replacementWidth < targetWidth) {
		replacement = `${replacement}${" ".repeat(targetWidth - replacementWidth)}`;
	}

	const prefix = tokens.slice(0, targetTokenIndex).join("");
	const result = `${prefix}${replacement}${suffix}`;
	if (visibleWidth(result.replace(ANSI_SGR_PATTERN, "")) <= originalWidth) return result;

	const suffixWidth = visibleWidth(suffix.replace(ANSI_SGR_PATTERN, ""));
	const prefixWidth = visibleWidth(prefix.replace(ANSI_SGR_PATTERN, ""));
	const maxReplacementWidth = Math.max(0, originalWidth - prefixWidth - suffixWidth);
	replacement = truncateToWidth(replacement, maxReplacementWidth, "");
	return `${prefix}${replacement}${suffix}`;
}

export function replaceBodyLeftGlyph(line: string, glyphs: PromptBorderGlyphs, frame: string): string {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const plainChars = [...plain];
	if (plainChars[0] !== glyphs.bottomLeft || plainChars[1] !== glyphs.horizontal) return line;
	if (plainChars.at(-1) === glyphs.bottomRight && plainChars.slice(2, -1).every(char => char === glyphs.horizontal)) {
		return line;
	}
	return replaceVisibleGlyphAt(line, 1, visibleWidth(glyphs.horizontal), frame);
}

function replaceSideBodyLeftGlyph(line: string, glyphs: PromptBorderGlyphs, frame: string): string {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const plainChars = [...plain];
	if (plainChars.length < 4 || plainChars[0] !== glyphs.vertical || plainChars.at(-1) !== glyphs.vertical) return line;
	if (plainChars[1] !== " " || plainChars[2] !== " ") return line;

	return replaceVisibleGlyphAt(line, 1, 1, frame);
}

function replaceBodyRightGlyph(line: string, glyphs: PromptBorderGlyphs, frame: string): string {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const plainChars = [...plain];
	if (plainChars.length < 4 || plainChars[0] !== glyphs.bottomLeft || plainChars.at(-1) !== glyphs.bottomRight) return line;
	if (plainChars.slice(1, -1).every(char => char === glyphs.horizontal)) return line;
	const tokens = [...line.matchAll(/\x1b\[[0-9;:]*m|./gu)].map(match => match[0]);
	let borderTokenIndex = -1;
	let visibleIndex = 0;
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index]!.startsWith("\x1b[")) continue;
		if (visibleIndex === plainChars.length - 1) {
			borderTokenIndex = index;
			break;
		}
		visibleIndex += 1;
	}
	if (borderTokenIndex === -1) return line;
	const prefixTokens = tokens.slice(0, borderTokenIndex);
	const suffix = tokens.slice(borderTokenIndex).join("");
	const frameWidth = visibleWidth(frame);
	let removableWidth = 0;
	let removeFromIndex = prefixTokens.length;
	for (let index = prefixTokens.length - 1; index >= 0 && removableWidth < frameWidth; index -= 1) {
		const token = prefixTokens[index]!;
		if (token.startsWith("\x1b[")) continue;
		if (token !== " " && token !== glyphs.horizontal) break;
		removeFromIndex = index;
		removableWidth += visibleWidth(token);
	}
	if (removableWidth === 0) return line;
	const fittedFrame = frameWidth > removableWidth ? truncateToWidth(frame, removableWidth, "") : frame;
	const fittedWidth = visibleWidth(fittedFrame);
	const leftPad = removableWidth > fittedWidth ? " ".repeat(removableWidth - fittedWidth) : "";
	return `${prefixTokens.slice(0, removeFromIndex).join("")}${leftPad}${fittedFrame}${suffix}`;
}
function replaceSideBodyRightGlyph(line: string, glyphs: PromptBorderGlyphs, frame: string): string {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const plainChars = [...plain];
	if (plainChars.length < 4 || plainChars[0] !== glyphs.vertical || plainChars.at(-1) !== glyphs.vertical) return line;
	const tokens = [...line.matchAll(/\x1b\[[0-9;:]*m|./gu)].map(match => match[0]);
	let borderTokenIndex = -1;
	let visibleIndex = 0;
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index]!.startsWith("\x1b[")) continue;
		if (visibleIndex === plainChars.length - 1) {
			borderTokenIndex = index;
			break;
		}
		visibleIndex += 1;
	}
	if (borderTokenIndex === -1) return line;
	const prefixTokens = tokens.slice(0, borderTokenIndex);
	const suffix = tokens.slice(borderTokenIndex).join("");
	const frameWidth = visibleWidth(frame);
	let removableWidth = 0;
	let removeFromIndex = prefixTokens.length;
	for (let index = prefixTokens.length - 1; index >= 0 && removableWidth < frameWidth; index -= 1) {
		const token = prefixTokens[index]!;
		if (token.startsWith("\x1b[")) continue;
		if (token !== " ") break;
		removeFromIndex = index;
		removableWidth += visibleWidth(token);
	}
	if (removableWidth === 0) return line;
	const fittedFrame = frameWidth > removableWidth ? truncateToWidth(frame, removableWidth, "") : frame;
	const fittedWidth = visibleWidth(fittedFrame);
	const leftPad = removableWidth > fittedWidth ? " ".repeat(removableWidth - fittedWidth) : "";
	return `${prefixTokens.slice(0, removeFromIndex).join("")}${leftPad}${fittedFrame}${suffix}`;
}

type CursorSymbols = Pick<EditorTheme["symbols"], "inputCursor" | "cursor">;

function scoreCursorBodyRow(
	line: string,
	cursorSymbols: CursorSymbols,
	cursorLineText: string,
	cursorCol: number,
): number {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	if (line.includes(CURSOR_MARKER) || line.includes("\x1b[7m")) return 100;
	if (!plain.includes(cursorSymbols.inputCursor) && !plain.includes(cursorSymbols.cursor)) return -1;
	let score = 1;
	const prefixHint = cursorCol > 0 ? cursorLineText.slice(Math.max(0, cursorCol - 8), cursorCol) : "";
	if (prefixHint.length > 0 && plain.includes(prefixHint)) score += 10;
	const lineHint = cursorLineText.length > 0 ? cursorLineText.slice(0, Math.min(cursorLineText.length, 8)) : "";
	if (lineHint.length > 0 && plain.includes(lineHint)) score += 5;
	return score;
}

function applyGlyphsToCursorRow(
	rows: readonly string[],
	glyphs: PromptBorderGlyphs,
	cursorSymbols: CursorSymbols,
	cursorLineText: string,
	cursorCol: number,
	leftFrame: string | undefined,
	rightFrame: string | undefined,
	borderLine?: string,
): readonly string[] {
	let targetIndex = -1;
	let targetScore = -1;
	let fallbackIndex = -1;
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index]!;
		if (row === borderLine) continue;
		fallbackIndex = index;
		const score = scoreCursorBodyRow(row, cursorSymbols, cursorLineText, cursorCol);
		if (score < targetScore) continue;
		targetScore = score;
		targetIndex = index;
	}
	const rowIndex = targetScore >= 0 ? targetIndex : fallbackIndex;
	if (rowIndex === -1 || (leftFrame === undefined && rightFrame === undefined)) return rows;
	return rows.map((row, index) => {
		if (index !== rowIndex) return row;
		let nextRow = row;
		if (leftFrame !== undefined) {
			nextRow = replaceSideBodyLeftGlyph(replaceBodyLeftGlyph(nextRow, glyphs, leftFrame), glyphs, leftFrame);
		}
		if (rightFrame !== undefined) {
			nextRow = replaceSideBodyRightGlyph(replaceBodyRightGlyph(nextRow, glyphs, rightFrame), glyphs, rightFrame);
		}
		return nextRow;
	});
}

export class PromptBorderEditor extends CustomEditor {
	readonly #cursorSymbols: CursorSymbols;
	readonly #state: PromptBorderState;
	readonly #glyphs: PromptBorderGlyphs;
	readonly #config: PromptBorderConfigInput;
	readonly #contextRail: ContextRailRuntime | undefined;
	#topBorder: EditorTopBorder | undefined;
	#renderedTopBorder: EditorTopBorder | undefined;
	#topBorderProvider: ((availableWidth: number) => EditorTopBorder | undefined) | undefined;
	#leftGlyphFrameIndex = 0;
	#rightGlyphFrameIndex = 0;
	#leftGlyphTimer: Timer | undefined;
	#rightGlyphTimer: Timer | undefined;
	#requestGlyphRepaint: (() => void) | undefined;

	constructor(
		theme: EditorTheme,
		state: PromptBorderState,
		config: PromptBorderConfigInput = DEFAULT_PROMPT_BORDER_CONFIG,
		contextRail?: ContextRailRuntime,
	) {
		const glyphs = borderStyles[state.style];
		const editorTheme =
			state.layout === "default"
				? withPromptBorder(theme, state)
				: withPromptBorder(theme, state, withSeparateBottomGlyphs(glyphs));
		super(editorTheme);
		this.#cursorSymbols = { inputCursor: theme.symbols.inputCursor, cursor: theme.symbols.cursor };
		this.#state = state;
		this.#glyphs = glyphs;
		this.#config = config;
		this.#contextRail = contextRail;
	}
	override setTheme(theme: EditorTheme): void {
		const editorTheme =
			this.#state.layout === "default"
				? withPromptBorder(theme, this.#state)
				: withPromptBorder(theme, this.#state, withSeparateBottomGlyphs(this.#glyphs));
		super.setTheme(editorTheme);
	}
	override setBorderStyle(_style: EditorBorderStyle): void {
		super.setBorderStyle("box");
	}
	override setTopBorder(content: EditorTopBorder | undefined): void {
		this.#topBorder = content;
		this.#renderedTopBorder = content;
		super.setTopBorder(content);
	}
	override setTopBorderProvider(
		provider: ((availableWidth: number) => EditorTopBorder | undefined) | undefined,
	): void {
		this.#topBorderProvider = provider;
		this.#renderedTopBorder = undefined;
		super.setTopBorderProvider(
			provider === undefined
				? undefined
				: availableWidth => {
						const content = provider(availableWidth);
						this.#renderedTopBorder = content;
						return content;
					},
		);
	}
	override setShimmerRepaintHandler(handler: (() => void) | undefined): void {
		super.setShimmerRepaintHandler(handler);
		this.#requestGlyphRepaint = handler;
		if (handler !== undefined) return;
		if (this.#leftGlyphTimer !== undefined) clearTimeout(this.#leftGlyphTimer);
		if (this.#rightGlyphTimer !== undefined) clearTimeout(this.#rightGlyphTimer);
		this.#leftGlyphTimer = undefined;
		this.#rightGlyphTimer = undefined;
	}
	#currentGlyphFrame(side: PromptBorderGlyphSide): string | undefined {
		const glyphConfig = side === "left" ? this.#config.leftGlyph : this.#config.rightGlyph;
		const frameIndex = side === "left" ? this.#leftGlyphFrameIndex : this.#rightGlyphFrameIndex;
		if (glyphConfig.frames.length === 0) return undefined;
		return glyphConfig.frames[frameIndex % glyphConfig.frames.length];
	}
	#scheduleGlyphFrame(side: PromptBorderGlyphSide): void {
		const glyphConfig = side === "left" ? this.#config.leftGlyph : this.#config.rightGlyph;
		const timer = side === "left" ? this.#leftGlyphTimer : this.#rightGlyphTimer;
		if (glyphConfig.frames.length <= 1 || timer !== undefined || this.#requestGlyphRepaint === undefined) return;
		const scheduledTimer = setTimeout(() => {
			if (side === "left") {
				this.#leftGlyphTimer = undefined;
				this.#leftGlyphFrameIndex = (this.#leftGlyphFrameIndex + 1) % glyphConfig.frames.length;
			} else {
				this.#rightGlyphTimer = undefined;
				this.#rightGlyphFrameIndex = (this.#rightGlyphFrameIndex + 1) % glyphConfig.frames.length;
			}
			this.#requestGlyphRepaint?.();
		}, glyphConfig.frameMs);
		scheduledTimer.unref?.();
		if (side === "left") this.#leftGlyphTimer = scheduledTimer;
		else this.#rightGlyphTimer = scheduledTimer;
	}

	#renderContextRailRows(width: number): readonly string[] | undefined {
		const runtime = this.#contextRail;
		if (runtime === undefined || runtime.config.placement !== "inside" || !contextRailVisible(runtime)) return undefined;
		scheduleContextRailRoleFrames(runtime);
		const innerWidth = Math.max(0, width - 2);
		const contents = renderContextRailRows(
			innerWidth,
			runtime.palette(this.#glyphs.horizontal),
			runtime.usage,
			runtime.boundaries,
			contextRailRenderOptions(runtime),
		);
		if (this.#state.layout === "top-bottom") return contents.map(content => ` ${content} `);
		const side = this.borderColor(this.#glyphs.vertical);
		return contents.map(content => `${side}${content}${side}`);
	}

	#insertContextRail(lines: readonly string[], width: number): readonly string[] {
		const rows = this.#renderContextRailRows(width);
		if (rows === undefined) return lines;
		const hasTopRow =
			this.#state.layout === "full" ||
			this.#state.layout === "top-bottom" ||
			this.#state.layout === "default" ||
			this.#renderedTopBorder !== undefined ||
			this.#topBorder !== undefined;
		const insertionIndex = hasTopRow ? Math.min(1, lines.length) : 0;
		return [...lines.slice(0, insertionIndex), ...rows, ...lines.slice(insertionIndex)];
	}

	override handleInput(data: string): void {
		super.handleInput(data);
		if (this.#contextRail !== undefined) markContextRailDraftActivity(this.#contextRail, this.getText());
	}
	override render(width: number): readonly string[] {
		const lines = [...super.render(width)];
		const leftFrame = this.#currentGlyphFrame("left");
		const rightFrame = this.#currentGlyphFrame("right");
		if (leftFrame !== undefined) this.#scheduleGlyphFrame("left");
		if (rightFrame !== undefined) this.#scheduleGlyphFrame("right");
		const cursor = this.getCursor();
		const cursorLineText = this.getText().split("\n")[cursor.line] ?? "";
		const topBorder = this.#topBorderProvider === undefined ? this.#topBorder : this.#renderedTopBorder;
		if (this.#state.layout === "default") {
			if (lines[0] === undefined) return this.#insertContextRail(lines, width);
			const bodyAndAutocompleteRows = lines.slice(1);
			const splitIndex = bodyAndAutocompleteRows.findIndex(line => {
				const plain = line.replace(ANSI_SGR_PATTERN, "");
				return !(
					(plain.startsWith(this.#glyphs.vertical) && plain.endsWith(this.#glyphs.vertical)) ||
					(plain.startsWith(this.#glyphs.bottomLeft) && plain.endsWith(this.#glyphs.bottomRight))
				);
			});
			const bodyRows = splitIndex === -1 ? bodyAndAutocompleteRows : bodyAndAutocompleteRows.slice(0, splitIndex);
			const autocompleteRows = splitIndex === -1 ? [] : bodyAndAutocompleteRows.slice(splitIndex);
			const glyphRows = applyGlyphsToCursorRow(
				bodyRows,
				this.#glyphs,
				this.#cursorSymbols,
				cursorLineText,
				cursor.col,
				leftFrame,
				rightFrame,
			);
			return this.#insertContextRail([lines[0], ...glyphRows, ...autocompleteRows], width);
		}
		const restyledTopRow = lines[0];
		const hiddenTopRow = restyledTopRow === undefined ? null : hideTopBorderLine(restyledTopRow, this.#glyphs, topBorder);
		const topRows =
			this.#state.layout === "full" || this.#state.layout === "top-bottom"
				? restyledTopRow === undefined
					? []
					: [restyledTopRow]
				: hiddenTopRow === null
					? []
					: [hiddenTopRow];
		const bodyAndAutocompleteRows = lines.slice(1);
		const splitIndex = bodyAndAutocompleteRows.findIndex(
			line => !isBodyOrUpstreamBottomBorderRow(line, width, this.#glyphs),
		);
		const bodyRowsWithUpstreamChrome =
			splitIndex === -1 ? bodyAndAutocompleteRows : bodyAndAutocompleteRows.slice(0, splitIndex);
		const borderedBodyRows = bodyRowsWithUpstreamChrome.filter(
			(line, index, rows) =>
				!isUpstreamBottomBorderRow(line, width, this.#glyphs) ||
				!isImeSafeCursorTailRow(rows[index - 1] ?? "", this.#glyphs),
		);
		const autocompleteRows = splitIndex === -1 ? [] : bodyAndAutocompleteRows.slice(splitIndex);
		const sideOnlyBodyRows = borderedBodyRows.map(line =>
			stripSideRowHorizontalPadding(normalizeUpstreamMergedBottomBodyRow(line, this.#glyphs), this.#glyphs),
		);
		const normalizedBodyRows =
			this.#state.layout === "top-bottom"
				? sideOnlyBodyRows.map(line => hideSideBorderGlyphs(line, this.#glyphs))
				: sideOnlyBodyRows;
		const borderLine = renderBottomBorderLine(width, this.#glyphs, this.borderColor);
		const glyphRows = applyGlyphsToCursorRow(
			normalizedBodyRows,
			this.#glyphs,
			this.#cursorSymbols,
			cursorLineText,
			cursor.col,
			leftFrame,
			rightFrame,
			borderLine,
		);
		if (this.#state.layout === "sides") return this.#insertContextRail([...topRows, ...glyphRows, ...autocompleteRows], width);
		return this.#insertContextRail([...topRows, ...glyphRows, borderLine, ...autocompleteRows], width);
	}
	dispose(): void {
		if (this.#leftGlyphTimer !== undefined) clearTimeout(this.#leftGlyphTimer);
		if (this.#rightGlyphTimer !== undefined) clearTimeout(this.#rightGlyphTimer);
		this.#leftGlyphTimer = undefined;
		this.#rightGlyphTimer = undefined;
		super.setShimmerRepaintHandler(undefined);
	}
}
function installPromptBorderEditor(ctx: { ui: ExtensionUIContext }): void {
	const runtime = activeContextRailRuntime;
	settings.override("composer.shape", "box");
	try {
		ctx.ui.setEditorComponent((tui, theme) => {
			if (runtime !== undefined) runtime.requestRender = () => tui.requestRender();
			const editor = new PromptBorderEditor(theme, activeBorder, activeConfig, runtime);
			activePromptBorderEditor = editor;
			return editor;
		});
	} finally {
		settings.clearOverride("composer.shape");
	}
}

function refreshContextRail(ctx: {
	hasUI: boolean;
	getContextUsage?(): { tokens: number; contextWindow: number; percent: number } | undefined;
	model?: ContextRailModel | null;
}): void {
	if (!ctx.hasUI || activeContextRailRuntime === undefined) return;
	const raw = ctx.getContextUsage?.();
	updateContextRailState(
		activeContextRailRuntime,
		raw === undefined ? undefined : { tokens: raw.tokens, contextWindow: raw.contextWindow, percent: raw.percent },
		ctx.model,
	);
}

function disposeContextRailRuntime(): void {
	if (activeContextRailRuntime === undefined) return;
	clearTimeout(activeContextRailRuntime.compactTimer);
	activeContextRailRuntime.compactTimer = undefined;
	clearContextRailRoleTimers(activeContextRailRuntime);
	activeContextRailRuntime.roleFrames = emptyContextRailRoleFrames();
	activeContextRailRuntime.labelGlyphFrame = 0;
	activeContextRailRuntime.pointerGlyphFrame = 0;
	activeContextRailRuntime.requestRender = undefined;
	activeContextRailRuntime = undefined;
}

function formatContextRailStatus(runtime: ContextRailRuntime): string {
	const usage = runtime.usage;
	const usageText =
		usage !== undefined && Number.isFinite(usage.percent)
			? `${usage.percent.toFixed(1)}%/${usage.contextWindow.toLocaleString()}`
			: "unknown";
	return `Context Rail: ${runtime.config.enabled ? "on" : "off"} · ${runtime.config.mode} · ${runtime.config.placement} · ${runtime.config.visibility} · pointer ${runtime.config.pointer.visibility} · label-position ${runtime.config.labelPosition} · label-glyph ${runtime.config.showLabelGlyph === false ? "off" : "on"} · ${usageText}`;
}

async function initializeContextRailGlyphs(
	ctx: { hasUI: boolean; ui: ExtensionUIContext },
	configPath: string,
): Promise<void> {
	const contextRail = activeConfig.contextRail;
	const files = [
		{
			path: getContextRailLabelPath(contextRail),
			content: `${resolveContextRailFallback(ctx.ui.theme)}\n`,
		},
		{
			path: getContextRailRolePath(contextRail, "pointer"),
			content: `${resolveContextRailPointerFallback(ctx.ui.theme)}\n`,
		},
	];
	const created: string[] = [];
	const overwritten: string[] = [];
	const skipped: string[] = [];
	const failed: string[] = [];
	for (const file of files) {
		try {
			await mkdir(path.dirname(file.path), { recursive: true });
			const exists = await Bun.file(file.path).exists();
			if (exists) {
				const overwrite = await ctx.ui.confirm(
					"Overwrite Context Rail glyph file?",
					`${file.path} already exists. Overwrite it?`,
				);
				if (!overwrite) {
					skipped.push(file.path);
					continue;
				}
			}
			await Bun.write(file.path, file.content);
			(exists ? overwritten : created).push(file.path);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			failed.push(`${file.path}: ${message}`);
		}
	}

	const summary = [
		"Context Rail glyph initialization:",
		created.length > 0 ? `Created: ${created.join(", ")}` : "",
		overwritten.length > 0 ? `Overwritten: ${overwritten.join(", ")}` : "",
		skipped.length > 0 ? `Skipped: ${skipped.join(", ")}` : "",
		failed.length > 0 ? `Failed: ${failed.join(", ")}` : "",
	]
		.filter(Boolean)
		.join("\n");
	ctx.ui.notify(summary, failed.length > 0 ? "error" : skipped.length > 0 ? "warning" : "info");
	if (created.length === 0 && overwritten.length === 0) return;

	activeConfig = await ensurePromptBorderConfigFile(configPath);
	if (activeContextRailRuntime !== undefined) {
		replaceContextRailConfig(
			activeContextRailRuntime,
			activeConfig.contextRail,
			await loadContextRailRoleAssets(activeConfig.contextRail),
		);
		mountContextRailWidget(ctx);
		activeContextRailRuntime.requestRender?.();
	}
}

async function persistContextRailUpdate(
	ctx: { hasUI: boolean; ui: ExtensionUIContext },
	update: ContextRailConfigUpdate,
	configPath: string,
): Promise<void> {
	activeConfig = await writeContextRailConfigSelection(update, configPath);
	if (activeContextRailRuntime !== undefined) {
		replaceContextRailConfig(
			activeContextRailRuntime,
			activeConfig.contextRail,
			await loadContextRailRoleAssets(activeConfig.contextRail),
		);
		if (update.enabled === true || update.visibility !== undefined) activeContextRailRuntime.toggledVisible = true;
		mountContextRailWidget(ctx);
		activeContextRailRuntime.requestRender?.();
	}
}



async function initializeMissingPromptBorderAssets(input: PromptBorderConfigPathInput, ctx: { ui: ExtensionUIContext }): Promise<void> {
	if (!(await ctx.ui.confirm("Initialize Prompt Border assets?", "Create only missing Prompt Border glyph files?"))) return;
	const paths = resolveConfigPaths(input);
	const seeds: Record<PromptBorderGlyphSlot, string> = {
		left: DEFAULT_LEFT_GLYPH_TEXT,
		right: "",
		status: "",
		activity: "",
	};
	const created: string[] = [];
	for (const slot of ["left", "right", "status", "activity"] as const) {
		const filePath = getGlyphTextPath(paths.configPath, slot);
		await mkdir(path.dirname(filePath), { recursive: true });
		if (await Bun.file(filePath).exists()) continue;
		const seed = seeds[slot];
		await Bun.write(filePath, seed.length > 0 && !seed.endsWith("\n") ? `${seed}\n` : seed);
		created.push(filePath);
	}
	ctx.ui.notify(
		created.length > 0 ? `Initialized missing Prompt Border assets:\n${created.join("\n")}` : "Prompt Border assets already exist",
		"info",
	);
}

async function initializeMissingContextRailAssets(
	config: PromptBorderConfig,
	ctx: { ui: ExtensionUIContext },
): Promise<void> {
	if (!(await ctx.ui.confirm("Initialize Context Rail assets?", "Create only missing Context Rail glyph files?"))) return;
	const rail = config.contextRail;
	const roleFallbacks = resolveContextRailRoleFallbacks(ctx.ui.theme);
	const files: Array<{ path: string; content: string }> = [
		{ path: getContextRailLabelPath(rail), content: `${resolveContextRailFallback(ctx.ui.theme)}\n` },
		{ path: getContextRailPointerPath(rail), content: `${resolveContextRailPointerFallback(ctx.ui.theme)}\n` },
		...CONTEXT_RAIL_ROLES.map(role => ({
			path: getContextRailRolePath(rail, role),
			content: `${roleFallbacks[role]}\n`,
		})),
	];
	const created: string[] = [];
	for (const file of files) {
		await mkdir(path.dirname(file.path), { recursive: true });
		if (await Bun.file(file.path).exists()) continue;
		await Bun.write(file.path, file.content);
		created.push(file.path);
	}
	ctx.ui.notify(
		created.length > 0 ? `Initialized missing Context Rail assets:\n${created.join("\n")}` : "Context Rail assets already exist",
		"info",
	);
}

type PromptBorderDialogApplyResult = { config?: PromptBorderConfig; error?: string };
type PromptBorderDialogCallbacks = {
	apply: (draft: PromptBorderConfig) => Promise<PromptBorderDialogApplyResult>;
	reload: () => Promise<PromptBorderConfig>;
	showPaths: () => void;
	initializePromptAssets: () => Promise<void>;
	initializeContextRailAssets: (draft: PromptBorderConfig) => Promise<void>;
};

function validatePromptBorderDraft(config: PromptBorderConfig): string | undefined {
	if (!isBorderStyleName(String(config.style))) return `Invalid border style: ${String(config.style)}`;
	if (!isBorderLayoutName(String(config.layout))) return `Invalid border layout: ${String(config.layout)}`;
	for (const [label, glyph] of [
		["left glyph", config.leftGlyph],
		["right glyph", config.rightGlyph],
		["status spinner", config.spinnerGlyphs.status],
		["activity spinner", config.spinnerGlyphs.activity],
	] as const) {
		if (!Number.isFinite(glyph.frameMs) || glyph.frameMs < 16 || glyph.frameMs > 1000) {
			return `${label} frameMs must be between 16 and 1000`;
		}
	}
	const rail = config.contextRail;
	if (typeof rail.enabled !== "boolean") return "Context Rail enabled must be boolean";
	if (!(CONTEXT_RAIL_PLACEMENTS as readonly string[]).includes(String(rail.placement))) return "Invalid Context Rail placement";
	if (!(CONTEXT_RAIL_VISIBILITIES as readonly string[]).includes(String(rail.visibility))) return "Invalid Context Rail visibility";
	if (!(CONTEXT_RAIL_MODES as readonly string[]).includes(String(rail.mode))) return "Invalid Context Rail mode";
	if (!(CONTEXT_RAIL_POINTERS as readonly string[]).includes(String(rail.pointer.visibility))) {
		return "Invalid Context Rail pointer visibility";
	}
	if (!(CONTEXT_RAIL_LABELS as readonly string[]).includes(String(rail.labels))) return "Invalid Context Rail labels";
	if (!(CONTEXT_RAIL_POSITIONS as readonly string[]).includes(String(rail.labelPosition))) {
		return "Invalid Context Rail label position";
	}
	if (typeof rail.showLabelGlyph !== "boolean") return "Context Rail showLabelGlyph must be boolean";
	if (typeof rail.glyphDirectory !== "string" || rail.glyphDirectory.trim().length === 0) {
		return "Context Rail glyphDirectory must be nonempty";
	}
	for (const role of CONTEXT_RAIL_ROLES) {
		const roleConfig = rail[role];
		if (typeof roleConfig.framesFile !== "string" || roleConfig.framesFile.trim().length === 0) {
			return `Context Rail ${role} framesFile must be nonempty`;
		}
		if (typeof roleConfig.meaning !== "string" || roleConfig.meaning.trim().length === 0) {
			return `Context Rail ${role} meaning must be nonempty`;
		}
		if (roleConfig.fps !== undefined && (!Number.isFinite(roleConfig.fps) || roleConfig.fps <= 0)) {
			return `Context Rail ${role} fps must be positive`;
		}
	}
	if (!(CONTEXT_RAIL_MEANING_PLACEMENTS as readonly string[]).includes(String(rail.custom.meaningPlacement))) {
		return "Invalid Context Rail meaning placement";
	}
	if (rail.custom.items.length !== CONTEXT_RAIL_ROLES.length) return "Context Rail custom templates must include every role";
	const customRoles = new Set<ContextRailRole>();
	for (const item of rail.custom.items) {
		if (customRoles.has(item.role)) return "Context Rail custom templates may include each role once";
		customRoles.add(item.role);
		if ((item.template.match(/\{frame\}/g) ?? []).length !== 1) {
			return `Context Rail ${item.role} template must contain exactly one {frame}`;
		}
	}
	return undefined;
}

function inputSetting(
	id: string,
	label: string,
	currentValue: string,
	onSubmit: (value: string) => void,
	description?: string,
): SettingItem {
	return {
		id,
		label,
		currentValue,
		description,
		submenu: (value, done) => {
			const input = new Input();
			input.setValue(value);
			input.onSubmit = next => {
				onSubmit(next);
				done(next);
			};
			input.onEscape = () => done();
			return {
				render: width => input.render(width),
				handleInput: data => input.handleInput(data),
				invalidate: () => input.invalidate(),
			};
		},
	};
}

function selectSetting(id: string, label: string, currentValue: string, values: readonly string[], description?: string): SettingItem {
	return {
		id,
		label,
		currentValue,
		description,
		submenu: (value, done) => {
			const list = new SelectList(
				values.map(option => ({ value: option, label: option })),
				Math.min(Math.max(values.length, 1), 8),
				getSelectListTheme(),
			);
			const selected = values.indexOf(value);
			if (selected >= 0) list.setSelectedIndex(selected);
			list.onSelect = item => done(item.value);
			list.onCancel = () => done();
			return list;
		},
	};
}

class PromptBorderSettingsDialog implements Component {
	#draft: PromptBorderConfig;
	#items: SettingItem[] = [];
	#settingsList: SettingsList;
	#error = "";
	#done: () => void;
	#tui: { requestRender: () => void };
	#theme: Theme;
	#callbacks: PromptBorderDialogCallbacks;

	constructor(
		tui: { requestRender: () => void },
		theme: Theme,
		initial: PromptBorderConfig,
		done: () => void,
		callbacks: PromptBorderDialogCallbacks,
	) {
		this.#tui = tui;
		this.#theme = theme;
		this.#draft = structuredClone(initial);
		this.#done = done;
		this.#callbacks = callbacks;
		this.#settingsList = this.createSettingsList();
	}

	private createSettingsList(): SettingsList {
		const items: SettingItem[] = [
			{ id: "heading.config", label: "Config", currentValue: "", heading: true },
			selectSetting("style", "Style", String(this.#draft.style), STYLE_NAMES),
			selectSetting("layout", "Layout", String(this.#draft.layout), LAYOUT_NAMES),
			inputSetting("left.frameMs", "Left glyph frameMs", String(this.#draft.leftGlyph.frameMs), value => {
				this.#draft.leftGlyph.frameMs = Number(value);
			}),
			inputSetting("right.frameMs", "Right glyph frameMs", String(this.#draft.rightGlyph.frameMs), value => {
				this.#draft.rightGlyph.frameMs = Number(value);
			}),
			inputSetting("spinner.status.frameMs", "Status spinner frameMs", String(this.#draft.spinnerGlyphs.status.frameMs), value => {
				this.#draft.spinnerGlyphs.status.frameMs = Number(value);
			}),
			inputSetting(
				"spinner.activity.frameMs",
				"Activity spinner frameMs",
				String(this.#draft.spinnerGlyphs.activity.frameMs),
				value => {
					this.#draft.spinnerGlyphs.activity.frameMs = Number(value);
				},
			),
			{ id: "heading.display", label: "Context Rail", currentValue: "", heading: true },
			{
				id: "rail.enabled",
				label: "Enabled",
				currentValue: String(this.#draft.contextRail.enabled),
				values: ["true", "false"],
			},
			selectSetting("rail.placement", "Placement", this.#draft.contextRail.placement, CONTEXT_RAIL_PLACEMENTS),
			selectSetting("rail.visibility", "Visibility", this.#draft.contextRail.visibility, CONTEXT_RAIL_VISIBILITIES),
			selectSetting("rail.mode", "Mode", this.#draft.contextRail.mode, CONTEXT_RAIL_MODES),
			inputSetting("rail.glyphDirectory", "Glyph directory", this.#draft.contextRail.glyphDirectory, value => {
				this.#draft.contextRail.glyphDirectory = value;
			}),
			selectSetting("rail.labels", "Labels", this.#draft.contextRail.labels, CONTEXT_RAIL_LABELS),
			selectSetting("rail.labelPosition", "Label position", this.#draft.contextRail.labelPosition, CONTEXT_RAIL_POSITIONS),
			{
				id: "rail.showLabelGlyph",
				label: "Show label glyph",
				currentValue: String(this.#draft.contextRail.showLabelGlyph !== false),
				values: ["true", "false"],
			},
			...CONTEXT_RAIL_ROLES.flatMap(role => {
				const roleConfig = this.#draft.contextRail[role];
				return [
					{ id: `rail.${role}.heading`, label: role, currentValue: "", heading: true } satisfies SettingItem,
					inputSetting(`rail.${role}.framesFile`, "Frames file", roleConfig.framesFile, value => {
						roleConfig.framesFile = value;
					}),
					inputSetting(`rail.${role}.fps`, "FPS (blank = asset)", roleConfig.fps === undefined ? "" : String(roleConfig.fps), value => {
						roleConfig.fps = value.trim().length === 0 ? undefined : Number(value);
					}),
					inputSetting(`rail.${role}.meaning`, "Meaning", roleConfig.meaning, value => {
						roleConfig.meaning = value;
					}),
					...(role === "pointer"
						? [
								selectSetting(
									"rail.pointer.visibility",
									"Pointer visibility",
									this.#draft.contextRail.pointer.visibility,
									CONTEXT_RAIL_POINTERS,
								),
							]
						: []),
				];
			}),
			{ id: "heading.custom", label: "Custom", currentValue: "", heading: true },
			selectSetting(
				"rail.custom.meaningPlacement",
				"Meaning placement",
				this.#draft.contextRail.custom.meaningPlacement,
				CONTEXT_RAIL_MEANING_PLACEMENTS,
			),
			...CONTEXT_RAIL_ROLES.map(role =>
				inputSetting(`rail.custom.${role}`, `${role} template`, this.#draft.contextRail.custom.items.find(item => item.role === role)?.template ?? "", value => {
					const item = this.#draft.contextRail.custom.items.find(candidate => candidate.role === role);
					if (item) item.template = value;
				}),
			),
			{ id: "heading.assets", label: "Assets", currentValue: "", heading: true },
			{ id: "action.show-paths", label: "Show paths", currentValue: "Enter" },
			{ id: "action.initialize-prompt-assets", label: "Initialize missing Prompt Border assets", currentValue: "Enter" },
			{ id: "action.initialize-context-assets", label: "Initialize missing Context Rail assets", currentValue: "Enter" },
			{ id: "action.reload", label: "Reload from disk", currentValue: "Enter" },
			{ id: "heading.actions", label: "Actions", currentValue: "", heading: true },
			{ id: "action.apply", label: "Apply changes", currentValue: "Enter" },
			{ id: "action.cancel", label: "Cancel", currentValue: "Enter" },
		];
		this.#items = items;
		return new SettingsList(
			items,
			Math.min(Math.max(items.length, 8), 22),
			getSettingsListTheme(),
			(id, value) => {
				this.applySetting(id, value);
				this.#settingsList.setItems(this.createSettingsListItems());
			},
			() => this.#done(),
			{ layout: "flat", hint: "↑↓ navigate · Enter edit · Esc cancel" },
		);
	}

	private createSettingsListItems(): SettingItem[] {
		this.createSettingsList();
		return this.#items;
	}

	private applySetting(id: string, value: string): void {
		switch (id) {
			case "style":
				this.#draft.style = value as BorderStyleName;
				break;
			case "layout":
				this.#draft.layout = value as BorderLayoutName;
				break;
			case "left.frameMs":
				this.#draft.leftGlyph.frameMs = Number(value);
				break;
			case "right.frameMs":
				this.#draft.rightGlyph.frameMs = Number(value);
				break;
			case "spinner.status.frameMs":
				this.#draft.spinnerGlyphs.status.frameMs = Number(value);
				break;
			case "spinner.activity.frameMs":
				this.#draft.spinnerGlyphs.activity.frameMs = Number(value);
				break;
			case "rail.enabled":
				this.#draft.contextRail.enabled = value === "true";
				break;
			case "rail.placement":
				this.#draft.contextRail.placement = value as ContextRailPlacement;
				break;
			case "rail.visibility":
				this.#draft.contextRail.visibility = value as ContextRailVisibility;
				break;
			case "rail.mode":
				this.#draft.contextRail.mode = value as ContextRailMode;
				break;
			case "rail.glyphDirectory":
				this.#draft.contextRail.glyphDirectory = value;
				break;
			case "rail.labels":
				this.#draft.contextRail.labels = value as ContextRailLabels;
				break;
			case "rail.labelPosition":
				this.#draft.contextRail.labelPosition = value as ContextRailLabelPosition;
				break;
			case "rail.showLabelGlyph":
				this.#draft.contextRail.showLabelGlyph = value === "true";
				break;
			case "rail.pointer.visibility":
				this.#draft.contextRail.pointer.visibility = value as ContextRailPointer;
				break;
			case "rail.custom.meaningPlacement":
				this.#draft.contextRail.custom.meaningPlacement = value as ContextRailMeaningPlacement;
				break;
			default:
				if (id.startsWith("rail.") && id.endsWith(".framesFile")) {
					const role = id.split(".")[1] as ContextRailRole;
					this.#draft.contextRail[role].framesFile = value;
				} else if (id.startsWith("rail.") && id.endsWith(".fps")) {
					const role = id.split(".")[1] as ContextRailRole;
					this.#draft.contextRail[role].fps = value.trim().length === 0 ? undefined : Number(value);
				} else if (id.startsWith("rail.") && id.endsWith(".meaning")) {
					const role = id.split(".")[1] as ContextRailRole;
					this.#draft.contextRail[role].meaning = value;
				} else if (id.startsWith("rail.custom.")) {
					const role = id.slice("rail.custom.".length) as ContextRailRole;
					const item = this.#draft.contextRail.custom.items.find(candidate => candidate.role === role);
					if (item) item.template = value;
				}
		}
	}

	private runAction(id: string): void {
		if (id === "action.show-paths") {
			this.#callbacks.showPaths();
		} else if (id === "action.initialize-prompt-assets") {
			void this.#callbacks.initializePromptAssets().then(() => this.#tui.requestRender());
		} else if (id === "action.initialize-context-assets") {
			void this.#callbacks.initializeContextRailAssets(this.#draft).then(() => this.#tui.requestRender());
		} else if (id === "action.reload") {
			void this.#callbacks.reload().then(config => {
				this.#draft = structuredClone(config);
				this.#settingsList.setItems(this.createSettingsListItems());
				this.#error = "";
				this.#tui.requestRender();
			});
		} else if (id === "action.apply") {
			void this.#callbacks.apply(this.#draft).then(result => {
				if (result.error !== undefined) {
					this.#error = result.error;
					this.#tui.requestRender();
					return;
				}
				this.#done();
			});
		} else if (id === "action.cancel") {
			this.#done();
		}
	}

	render(width: number): readonly string[] {
		const header = this.#theme.fg("accent", this.#theme.bold("Prompt Border Configuration"));
		const error = this.#error.length > 0 ? this.#theme.fg("error", `Error: ${this.#error}`) : "";
		return [header, ...(error ? [truncateToWidth(error, width)] : []), ...this.#settingsList.render(width)];
	}

	handleInput(data: string): void {
		if (data === "\n" || data === "\r") {
			const selected = this.#settingsList.getSelectedItem();
			if (selected?.id.startsWith("action.")) {
				this.runAction(selected.id);
				return;
			}
		}
		this.#settingsList.handleInput(data);
		this.#tui.requestRender();
	}

	invalidate(): void {
		this.#settingsList.invalidate();
	}
}
type PromptBorderLiveContext = {
	hasUI: boolean;
	ui: ExtensionUIContext;
	getContextUsage?: () => { tokens: number; contextWindow: number; percent: number } | undefined;
	model?: ContextRailModel | null;
};

function effectiveContextRailConfig(config: PromptBorderConfig): ContextRailConfig {
	if (sessionRailEnabledOverride === undefined) return structuredClone(config.contextRail);
	return { ...structuredClone(config.contextRail), enabled: sessionRailEnabledOverride };
}

async function rebuildPromptBorderRuntime(ctx: PromptBorderLiveContext, input: PromptBorderConfigPathInput): Promise<void> {
	activeBorder = {
		style: sessionStyleOverride ?? activeConfig.style,
		layout: sessionLayoutOverride ?? activeConfig.layout,
	};
	applySpinnerGlyphFrames(ctx.ui.theme, activeConfig);
	const railConfig = effectiveContextRailConfig(activeConfig);
	const roleAssets = await loadContextRailRoleAssets(railConfig);
	if (activeContextRailRuntime === undefined) {
		activeContextRailRuntime = createContextRailRuntime(
			railConfig,
			horizontal => createContextRailPalette(ctx.ui.theme, horizontal),
			resolveContextRailFallback(ctx.ui.theme),
			resolveContextRailPointerFallback(ctx.ui.theme),
			roleAssets,
			resolveContextRailRoleFallbacks(ctx.ui.theme),
		);
	} else {
		replaceContextRailConfig(activeContextRailRuntime, railConfig, roleAssets);
	}
	refreshContextRail(ctx);
	mountPromptAttachmentWidget(ctx);
	mountContextRailWidget(ctx);
	if (builtInEditorOverride) {
		activePromptBorderEditor = undefined;
		ctx.ui.setEditorComponent(undefined);
	} else {
		ctx.ui.setEditorComponent(undefined);
		installPromptBorderEditor(ctx);
	}
}

function tearDownPromptBorderRuntime(ctx: PromptBorderLiveContext): void {
	activePromptBorderEditor = undefined;
	if (ctx.hasUI) {
		ctx.ui.setWidget?.(CONTEXT_RAIL_WIDGET_KEY, undefined);
		ctx.ui.setWidget?.(PROMPT_ATTACHMENT_WIDGET_KEY, undefined);
		ctx.ui.setEditorComponent(undefined);
		clearPromptLoadingGlyphDebugUi(ctx);
		restoreSpinnerGlyphFrames(ctx.ui.theme);
	}
	disposeContextRailRuntime();
}

async function activatePromptBorderSession(ctx: PromptBorderLiveContext, input: PromptBorderConfigPathInput): Promise<void> {
	tearDownPromptBorderRuntime(ctx);
	sessionStyleOverride = undefined;
	sessionLayoutOverride = undefined;
	sessionRailEnabledOverride = undefined;
	builtInEditorOverride = false;
	activeConfig = await ensurePromptBorderConfigFile(input);
	notifyInvalidConfig(ctx);
	if (!ctx.hasUI) return;
	await rebuildPromptBorderRuntime(ctx, input);
}

function formatPromptBorderStatus(config: PromptBorderConfig, input: PromptBorderConfigPathInput): string {
	const paths = resolveConfigPaths(input);
	const rail = activeContextRailRuntime?.config ?? config.contextRail;
	const assetPaths = (["left", "right", "status", "activity"] as const).map(slot => getGlyphTextPath(paths.configPath, slot));
	const rolePaths = CONTEXT_RAIL_ROLES.map(role => getContextRailRolePath(rail, role));
	return [
		`Prompt Border: ${activeBorder.style} ${activeBorder.layout} (persisted ${config.style} ${config.layout})`,
		`Session overrides: style=${sessionStyleOverride ?? "none"} layout=${sessionLayoutOverride ?? "none"} editor=${builtInEditorOverride ? "builtin" : "custom"}`,
		`Context Rail: ${rail.enabled ? "enabled" : "disabled"} ${rail.placement}/${rail.visibility}/${rail.mode}`,
		`Config: ${paths.configPath}`,
		`Prompt Border assets: ${assetPaths.join(", ")}`,
		`Context Rail assets: ${expandHome(rail.glyphDirectory)} (${rolePaths.join(", ")})`,
	].join("\n");
}

async function applyPromptBorderDraft(
	draft: PromptBorderConfig,
	ctx: PromptBorderLiveContext,
	input: PromptBorderConfigPathInput,
): Promise<PromptBorderDialogApplyResult> {
	const validationError = validatePromptBorderDraft(draft);
	if (validationError !== undefined) return { error: validationError };
	const previous = activeConfig;
	try {
		await writeJsonAtomically(resolveConfigPaths(input).configPath, persistedConfigJson(draft));
	} catch (error) {
		return { error: `Could not write Prompt Border config: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (draft.style !== previous.style) {
		sessionStyleOverride = undefined;
		builtInEditorOverride = false;
	}
	if (draft.layout !== previous.layout) {
		sessionLayoutOverride = undefined;
		builtInEditorOverride = false;
	}
	if (draft.contextRail.enabled !== previous.contextRail.enabled) sessionRailEnabledOverride = undefined;
	if (draft.contextRail.visibility !== previous.contextRail.visibility && activeContextRailRuntime !== undefined) {
		activeContextRailRuntime.toggledVisible = true;
	}
	activeConfig = draft;
	if (ctx.hasUI) await rebuildPromptBorderRuntime(ctx, input);
	return { config: draft };
}

function openPromptBorderDialog(ctx: PromptBorderLiveContext, input: PromptBorderConfigPathInput): Promise<void> {
	return ctx.ui.custom((_tui, _theme, _keybindings, done) => {
		const tui = _tui as { requestRender: () => void };
		const theme = _theme as Theme;
		return new PromptBorderSettingsDialog(tui, theme, structuredClone(activeConfig), () => done(undefined), {
			apply: draft => applyPromptBorderDraft(draft, ctx, input),
			reload: () => readPromptBorderConfig(input),
			showPaths: () => ctx.ui.notify(formatPromptBorderStatus(activeConfig, input), "info"),
			initializePromptAssets: () => initializeMissingPromptBorderAssets(input, ctx),
			initializeContextRailAssets: draft => initializeMissingContextRailAssets(draft, ctx),
		});
	}).then(() => undefined);
}

export default function promptBorderStyle(pi: ExtensionAPI, configPath: PromptBorderConfigPathInput = CONFIG_PATH): void {
	pi.setLabel("Prompt Border Style");

	const resetSession = async (_event: unknown, ctx: PromptBorderLiveContext): Promise<void> => {
		await activatePromptBorderSession(ctx, configPath);
	};
	pi.on("session_start", resetSession);
	pi.on("session_switch", resetSession);
	pi.on("session_branch", resetSession);

	pi.on("context", (_event, ctx) => refreshContextRail(ctx));
	pi.on("message_update", (_event, ctx) => refreshContextRail(ctx));
	pi.on("message_end", (_event, ctx) => refreshContextRail(ctx));
	pi.on("turn_end", (_event, ctx) => refreshContextRail(ctx));
	pi.on("auto_compaction_start", (_event, ctx) => refreshContextRail(ctx));
	pi.on("auto_compaction_end", (_event, ctx) => refreshContextRail(ctx));

	pi.on("session_shutdown", (_event, ctx: PromptBorderLiveContext) => {
		tearDownPromptBorderRuntime(ctx);
		sessionStyleOverride = undefined;
		sessionLayoutOverride = undefined;
		sessionRailEnabledOverride = undefined;
		builtInEditorOverride = false;
	});

	pi.registerCommand("prompt-border", {
		description: "Configure the prompt border and context rail",
		getArgumentCompletions: getPromptBorderArgumentCompletions,
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			const action = parsePromptBorderArgs(args, activeBorder);
			if (action.kind === "config") {
				activeConfig = await ensurePromptBorderConfigFile(configPath);
				notifyInvalidConfig(ctx);
				await openPromptBorderDialog(ctx, configPath);
				return;
			}
			if (action.kind === "status") {
				const persisted = await readPromptBorderConfig(configPath);
				notifyInvalidConfig(ctx);
				ctx.ui.notify(formatPromptBorderStatus(persisted, configPath), "info");
				return;
			}
			activeConfig = await readPromptBorderConfig(configPath);
			notifyInvalidConfig(ctx);
			if (action.kind === "invalid") {
				ctx.ui.notify(USAGE, "warning");
				return;
			}
			if (action.kind === "reset") {
				sessionStyleOverride = undefined;
				sessionLayoutOverride = undefined;
				builtInEditorOverride = true;
				activePromptBorderEditor = undefined;
				ctx.ui.setEditorComponent(undefined);
				activeBorder = { style: activeConfig.style, layout: activeConfig.layout };
				ctx.ui.notify("Prompt border reset for this session", "info");
				return;
			}
			if (action.kind === "rail-toggle") {
				const runtime = activeContextRailRuntime;
				if (runtime !== undefined && runtime.config.enabled && runtime.config.visibility === "toggle") {
					runtime.toggledVisible = !runtime.toggledVisible;
					mountContextRailWidget(ctx);
					runtime.requestRender?.();
					ctx.ui.notify(`Context Rail: ${runtime.toggledVisible ? "shown" : "hidden"}`, "info");
					return;
				}
				sessionRailEnabledOverride = !(runtime?.config.enabled ?? activeConfig.contextRail.enabled);
				await rebuildPromptBorderRuntime(ctx, configPath);
				ctx.ui.notify(`Context Rail: ${sessionRailEnabledOverride ? "enabled" : "disabled"} for this session`, "info");
				return;
			}
			if (action.kind === "glyph-debug") {
				if (action.action === "frames") {
					ctx.ui.notify(formatAllSpinnerFrameDebugReports(activeConfig), "info");
				} else if (action.action === "demo") {
					mountPromptLoadingGlyphDebugWidget(ctx, activeConfig);
					ctx.ui.notify("Prompt loading glyph demo enabled for this session", "info");
				} else if (action.action === "on") {
					promptLoadingGlyphDebugEnabledSessions.add(ctx.ui.setWorkingMessage);
					ctx.ui.setWorkingMessage(buildPromptLoadingGlyphDebugMessage(activeConfig));
					ctx.ui.notify("Prompt loading glyph debug enabled for this session", "info");
				} else {
					clearPromptLoadingGlyphDebugUi(ctx);
					ctx.ui.notify("Prompt loading glyph debug disabled", "info");
				}
				return;
			}
			if (action.state.style !== activeBorder.style) sessionStyleOverride = action.state.style;
			if (action.state.layout !== activeBorder.layout) sessionLayoutOverride = action.state.layout;
			builtInEditorOverride = false;
			activeBorder = {
				style: sessionStyleOverride ?? activeConfig.style,
				layout: sessionLayoutOverride ?? activeConfig.layout,
			};
			await rebuildPromptBorderRuntime(ctx, configPath);
			ctx.ui.notify(`Prompt border: ${activeBorder.style} ${activeBorder.layout} for this session`, "info");
		},
	});
}
