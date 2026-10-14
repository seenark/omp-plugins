export {
	CODESOOK_OMP_CONFIG_CHANGED,
	CODESOOK_OMP_CONFIG_PATH,
	defaultCodesookOmpConfig,
	isRecord,
	readCodesookOmpConfig,
	readCodesookOmpSection,
	updateCodesookOmpConfig,
	updateCodesookOmpSection,
	writeCodesookOmpConfig,
	type CodesookOmpConfig,
	type CodesookOmpConfigGroup,
	type CodesookOmpConfigReadResult,
} from "./config-store.ts";
import {
	CODESOOK_OMP_CONFIG_CHANGED,
	CODESOOK_OMP_CONFIG_PATH,
	isRecord,
	readCodesookOmpConfig,
	readCodesookOmpSection,
	updateCodesookOmpSection,
} from "./config-store.ts";

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { getSettingsListTheme } from "@oh-my-pi/pi-coding-agent";
import { Input, SettingsList, type Component, type SettingItem } from "@oh-my-pi/pi-tui";
import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import {
	CHANNEL,
	copyFrameSequence,
	isDisplaySource,
	isValidBlockFrame,
	isValidFrameSequence,
	parseSharedDisplayMessage,
	type BlockFrame,
	type DisplaySource,
	type FrameSequence,
	type SharedDisplayEvents,
} from "./client.ts";

export {
	CHANNEL,
	connectSharedDisplay,
	copyFrameSequence,
	isDisplaySource,
	isValidBlockFrame,
	isValidFrameSequence,
	parseFrameSequenceAsset,
	parseSharedDisplayMessage,
	type BlockFrame,
	type DisplaySource,
	type FrameSequence,
	type SharedDisplayEvents,
	type SharedDisplayPublisher,
	type SharedDisplayHostMessage,
	type SharedDisplayMessage,
} from "./client.ts";

const WIDGET_KEY = "codesook-shared-display";
const DEFAULT_HORIZONTAL_SEPARATOR = "  ";
const SOURCE_ORDER: readonly DisplaySource[] = ["ponytail", "caveman", "headroom", "rtk", "codegraph", "beads"];

export type SharedDisplayLayout = "horizontal" | "vertical";
export type SharedDisplayStyle = "plain" | "powerline";
export type SharedDisplayPlacement = "aboveEditor" | "belowEditor";

export type SharedDisplayConfig = {
	enabled: boolean;
	layout: SharedDisplayLayout;
	style: SharedDisplayStyle;
	order: DisplaySource[];
	widgetPlacement: SharedDisplayPlacement;
	horizontalSeparator: string;
	verticalGapRows: number;
};

const LEGACY_SHARED_DISPLAY_CONFIG_PATH = path.join(
	os.homedir(),
	".config",
	"codesook-omp",
	"shared-display",
	"config.json",
);
export const SHARED_DISPLAY_CONFIG_PATH = CODESOOK_OMP_CONFIG_PATH;
export const DEFAULT_SHARED_DISPLAY_CONFIG: SharedDisplayConfig = {
	enabled: true,
	layout: "horizontal",
	style: "plain",
	order: [...SOURCE_ORDER],
	widgetPlacement: "belowEditor",
	horizontalSeparator: DEFAULT_HORIZONTAL_SEPARATOR,
	verticalGapRows: 0,
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneDefaultConfig(): SharedDisplayConfig {
	return {
		...DEFAULT_SHARED_DISPLAY_CONFIG,
		order: [...DEFAULT_SHARED_DISPLAY_CONFIG.order],
	};
}

export function normalizeSharedDisplayConfig(raw: unknown): SharedDisplayConfig {
	const source = isObject(raw) ? raw : {};
	const normalized = cloneDefaultConfig();
	if (typeof source.enabled === "boolean") normalized.enabled = source.enabled;
	if (source.layout === "horizontal" || source.layout === "vertical") normalized.layout = source.layout;
	if (source.style === "plain" || source.style === "powerline") normalized.style = source.style;
	if (Array.isArray(source.order)) {
		normalized.order = [...new Set(source.order.filter(isDisplaySource))];
	}
	for (const known of SOURCE_ORDER) if (!normalized.order.includes(known)) normalized.order.push(known);
	if (source.widgetPlacement === "aboveEditor" || source.widgetPlacement === "belowEditor") {
		normalized.widgetPlacement = source.widgetPlacement;
	}
	if (typeof source.horizontalSeparator === "string" && !/[\r\n]/u.test(source.horizontalSeparator)) {
		normalized.horizontalSeparator = source.horizontalSeparator;
	}
	if (
		typeof source.verticalGapRows === "number" &&
		Number.isSafeInteger(source.verticalGapRows) &&
		source.verticalGapRows >= 0 &&
		source.verticalGapRows <= 10
	) {
		normalized.verticalGapRows = source.verticalGapRows;
	}
	return normalized;
}

function isRootConfigPath(configPath: string): boolean {
	return configPath === CODESOOK_OMP_CONFIG_PATH;
}

function loadLegacySharedDisplayConfig(): SharedDisplayConfig | undefined {
	try {
		const raw: unknown = JSON.parse(readFileSync(LEGACY_SHARED_DISPLAY_CONFIG_PATH, "utf8"));
		return isObject(raw) ? normalizeSharedDisplayConfig(raw) : undefined;
	} catch {
		return undefined;
	}
}

function migrateLegacySharedDisplayConfig(fallback: SharedDisplayConfig): SharedDisplayConfig {
	const legacy = loadLegacySharedDisplayConfig();
	if (legacy === undefined) return fallback;
	try {
		updateCodesookOmpSection("display", "sharedDisplay", legacy, CODESOOK_OMP_CONFIG_PATH);
		rmSync(LEGACY_SHARED_DISPLAY_CONFIG_PATH, { force: true });
	} catch {
		// Keep legacy settings active when migration cannot be completed.
	}
	return legacy;
}

function loadRootSharedDisplayConfig(): SharedDisplayConfig {
	const root = readCodesookOmpConfig(CODESOOK_OMP_CONFIG_PATH);
	if (root.exists && !root.valid) return cloneDefaultConfig();
	if (root.exists) {
		const section = readCodesookOmpSection(root.value, "display", "sharedDisplay");
		if (section !== undefined) return normalizeSharedDisplayConfig(section);
	}
	return migrateLegacySharedDisplayConfig(cloneDefaultConfig());
}

export function loadSharedDisplayConfig(configPath = SHARED_DISPLAY_CONFIG_PATH): SharedDisplayConfig {
	if (isRootConfigPath(configPath)) return loadRootSharedDisplayConfig();
	try {
		return normalizeSharedDisplayConfig(JSON.parse(readFileSync(configPath, "utf8")));
	} catch {
		return cloneDefaultConfig();
	}
}
export function cloneSharedDisplayConfig(config: SharedDisplayConfig): SharedDisplayConfig {
	return {
		...config,
		order: [...config.order],
	};
}

export function validateSharedDisplayConfig(config: unknown): string[] {
	if (!isObject(config)) return ["configuration must be an object"];
	const errors: string[] = [];
	if (typeof config.enabled !== "boolean") errors.push("enabled must be boolean");
	if (config.layout !== "horizontal" && config.layout !== "vertical") errors.push("layout is invalid");
	if (config.style !== "plain" && config.style !== "powerline") errors.push("style is invalid");
	if (
		!Array.isArray(config.order) ||
		config.order.some(source => !isDisplaySource(source)) ||
		new Set(config.order).size !== config.order.length
	) {
		errors.push("order must contain unique valid sources");
	}
	if (config.widgetPlacement !== "aboveEditor" && config.widgetPlacement !== "belowEditor") {
		errors.push("widgetPlacement is invalid");
	}
	if (typeof config.horizontalSeparator !== "string" || /[\r\n]/u.test(config.horizontalSeparator)) {
		errors.push("horizontalSeparator must be a single-line string");
	}
	if (
		typeof config.verticalGapRows !== "number" ||
		!Number.isSafeInteger(config.verticalGapRows) ||
		config.verticalGapRows < 0 ||
		config.verticalGapRows > 10
	) {
		errors.push("verticalGapRows must be an integer from 0 through 10");
	}
	return errors;
}

export function writeSharedDisplayConfig(
	config: SharedDisplayConfig,
	configPath = SHARED_DISPLAY_CONFIG_PATH,
): void {
	const errors = validateSharedDisplayConfig(config);
	if (errors.length > 0) throw new Error(errors.join("; "));
	if (isRootConfigPath(configPath)) {
		updateCodesookOmpSection("display", "sharedDisplay", config, configPath);
		return;
	}
	mkdirSync(path.dirname(configPath), { recursive: true });
	const temporaryPath = path.join(
		path.dirname(configPath),
		`.${path.basename(configPath)}.${process.pid}.${randomUUID()}.tmp`,
	);
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
		renameSync(temporaryPath, configPath);
	} catch (error) {
		try {
			rmSync(temporaryPath, { force: true });
		} catch {
			// Preserve the original write/rename error.
		}
		throw error;
	}
}

export type PowerlinePalette = {
	/** Segment background colors as `#rrggbb`, cycled per block. */
	backgrounds: readonly string[];
	/** Segment text color as `#rrggbb`. */
	text: string;
};

export type ComposeDisplayOptions = {
	layout: SharedDisplayLayout;
	order: readonly DisplaySource[];
	horizontalSeparator?: string;
	verticalGapRows?: number;
	width: number;
	nowMs?: number;
	animationOriginMs?: number;
	active?: boolean;
	/** When set, blocks render as Starship-style powerline segments. */
	powerline?: PowerlinePalette;
};

const POWERLINE_CAP = "\ue0b6";
const POWERLINE_ARROW = "\ue0b0";
const RESET = "\x1b[0m";
const SGR = /\x1b\[[0-9;:]*m/gu;

function ansi(hex: string, plane: 38 | 48): string {
	const value = Number.parseInt(hex.slice(1), 16);
	return `\x1b[${plane};2;${(value >> 16) & 255};${(value >> 8) & 255};${value & 255}m`;
}

/** Cap, colored cells joined by arrows, closing arrow. Producer colors are stripped so text stays readable on the segment background. */
function powerlineRow(cells: readonly { text: string; bg: string }[], palette: PowerlinePalette): string {
	if (cells.length === 0) return "";
	let out = `${ansi(cells[0]!.bg, 38)}${POWERLINE_CAP}`;
	cells.forEach((cell, index) => {
		const next = cells[index + 1];
		out += `${ansi(cell.bg, 48)}${ansi(palette.text, 38)} ${cell.text.replace(SGR, "")} `;
		out += next === undefined ? `${RESET}${ansi(cell.bg, 38)}${POWERLINE_ARROW}${RESET}` : `${ansi(next.bg, 48)}${ansi(cell.bg, 38)}${POWERLINE_ARROW}`;
	});
	return out;
}

export function selectFrame(
	sequence: FrameSequence,
	nowMs = 0,
	animationOriginMs = 0,
	_active = true,
): BlockFrame {
	if (sequence.frames.length === 0) return [];
	if (sequence.frames.length < 2 || sequence.fps === undefined || !Number.isFinite(sequence.fps)) {
		return sequence.frames[0]!;
	}
	const elapsed = Math.max(0, nowMs - animationOriginMs);
	const index = Math.floor((elapsed * sequence.fps) / 1000) % sequence.frames.length;
	return sequence.frames[index]!;
}

function fitDisplayRow(row: string, width: number): string {
	if (width <= 0) return "";
	const clipped = truncateToWidth(row, width, "", false);
	return `${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}${clipped}`;
}

function blockForSequence(
	sequence: FrameSequence,
	nowMs: number,
	animationOriginMs: number,
	active: boolean,
): { rows: readonly string[]; width: number } | undefined {
	const rows = selectFrame(sequence, nowMs, animationOriginMs, active);
	const width = Math.max(...rows.map(row => visibleWidth(row)), 0);
	return width > 0 ? { rows, width } : undefined;
}

export function composeDisplayRows(
	snapshots: ReadonlyMap<DisplaySource, FrameSequence>,
	options: ComposeDisplayOptions,
): string[] {
	const nowMs = options.nowMs ?? 0;
	const origin = options.animationOriginMs ?? 0;
	const active = options.active ?? false;
	const blocks = options.order
		.map(source => snapshots.get(source))
		.filter((sequence): sequence is FrameSequence => sequence !== undefined && isValidFrameSequence(sequence))
		.map(sequence => blockForSequence(sequence, nowMs, origin, active))
		.filter((block): block is { rows: readonly string[]; width: number } => block !== undefined);
	if (blocks.length === 0) return [];

	const palette = options.powerline;
	const padded = (block: { rows: readonly string[]; width: number }, rowIndex: number): string => {
		const row = block.rows[rowIndex] ?? "";
		return `${row}${" ".repeat(Math.max(0, block.width - visibleWidth(row)))}`;
	};
	const backgroundFor = (index: number): string => palette!.backgrounds[index % palette!.backgrounds.length]!;
	const rows: string[] = [];
	if (options.layout === "vertical") {
		for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
			if (blockIndex > 0) rows.push(...Array.from({ length: Math.max(0, options.verticalGapRows ?? 0) }, () => ""));
			const block = blocks[blockIndex]!;
			for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
				rows.push(
					palette === undefined
						? block.rows[rowIndex]!
						: powerlineRow([{ text: padded(block, rowIndex), bg: backgroundFor(blockIndex) }], palette),
				);
			}
		}
	} else {
		const height = Math.max(...blocks.map(block => block.rows.length), 0);
		const separator = options.horizontalSeparator ?? DEFAULT_HORIZONTAL_SEPARATOR;
		for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
			rows.push(
				palette === undefined
					? blocks.map(block => padded(block, rowIndex)).join(separator)
					: powerlineRow(
							blocks.map((block, blockIndex) => ({ text: padded(block, rowIndex), bg: backgroundFor(blockIndex) })),
							palette,
						),
			);
		}
	}
	return rows.map(row => fitDisplayRow(row, options.width));
}

export const composeFrames = composeDisplayRows;

type WidgetComponent = {
	render(width: number): readonly string[];
	dispose?(): void;
	invalidate?(): void;
};
type WidgetTui = { requestComponentRender(component: WidgetComponent): void };
type HostContext = {
	hasUI: boolean;
	ui: {
		readonly theme?: unknown;
		setWidget(
			key: string,
			content: ((tui: WidgetTui) => WidgetComponent) | undefined,
			options?: { placement?: string },
		): void;
		notify(message: string, level?: string): void;
		custom?: <T>(
			factory: (
				tui: unknown,
				theme: unknown,
				keybindings: unknown,
				done: (result: T) => void,
			) => Component | Promise<Component>,
			options?: unknown,
		) => Promise<T>;
	};
	setInterval(callback: (...args: unknown[]) => void, ms?: number): unknown;
	clearTimer(timer: unknown): void;
};

export type SharedDisplayExtensionOptions = {
	configPath?: string;
};

type HostOptions = SharedDisplayExtensionOptions;

type HostRuntime = {
	config: SharedDisplayConfig;
	configPath: string;
	events?: SharedDisplayEvents;
	unsubscribe?: () => void;
	configUnsubscribe?: () => void;
	ctx?: HostContext;
	epoch?: string;
	snapshots: Map<DisplaySource, FrameSequence>;
	revisions: Map<DisplaySource, number>;
	active: boolean;
	animationOriginMs?: number;
	timer?: unknown;
	timerFps?: number;
	component?: WidgetComponent;
	tui?: WidgetTui;
	mounted: boolean;
	mountedPlacement?: SharedDisplayPlacement;
};

function monotonicNow(): number {
	return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

type ThemeLike = { getColorHex(color: string): string; getBgHex(color: string): string };
const POWERLINE_THEME_COLORS = [
	"statusLineModel",
	"statusLinePath",
	"statusLineGitClean",
	"statusLineContext",
	"statusLineSpend",
	"statusLineDirty",
] as const;
const HEX = /^#[0-9a-f]{6}$/iu;

/** Palette from the active OMP theme's status-line colors; undefined (plain rendering) unless style is powerline and the theme resolves true colors. */
function powerlinePalette(runtime: HostRuntime): PowerlinePalette | undefined {
	if (runtime.config.style !== "powerline") return undefined;
	const theme = runtime.ctx?.ui.theme as Partial<ThemeLike> | undefined;
	if (typeof theme?.getColorHex !== "function" || typeof theme.getBgHex !== "function") return undefined;
	try {
		const backgrounds = POWERLINE_THEME_COLORS.map(color => theme.getColorHex!(color)).filter(hex => HEX.test(hex));
		const text = theme.getBgHex("statusLineBg");
		return backgrounds.length > 0 && HEX.test(text) ? { backgrounds, text } : undefined;
	} catch {
		return undefined;
	}
}

function configuredSnapshots(runtime: HostRuntime): ReadonlyMap<DisplaySource, FrameSequence> {
	const result = new Map<DisplaySource, FrameSequence>();
	for (const source of runtime.config.order) {
		const sequence = runtime.snapshots.get(source);
		if (sequence !== undefined) result.set(source, sequence);
	}
	return result;
}

function hasVisibleSnapshot(runtime: HostRuntime): boolean {
	return (
		composeDisplayRows(configuredSnapshots(runtime), {
			layout: runtime.config.layout,
			order: runtime.config.order,
			horizontalSeparator: runtime.config.horizontalSeparator,
			powerline: powerlinePalette(runtime),
			verticalGapRows: runtime.config.verticalGapRows,
			width: 1,
			nowMs: monotonicNow(),
			animationOriginMs: runtime.animationOriginMs,
			active: runtime.active,
		}).length > 0
	);
}

function fastestFps(runtime: HostRuntime): number | undefined {
	let fastest: number | undefined;
	for (const source of runtime.config.order) {
		const sequence = runtime.snapshots.get(source);
		if (sequence === undefined || sequence.frames.length < 2 || sequence.fps === undefined) continue;
		if (fastest === undefined || sequence.fps > fastest) fastest = sequence.fps;
	}
	return fastest;
}

function stopAnimationTimer(runtime: HostRuntime): void {
	if (runtime.timer !== undefined && runtime.ctx !== undefined) runtime.ctx.clearTimer(runtime.timer);
	runtime.timer = undefined;
	runtime.timerFps = undefined;
}

function ensureAnimationTimer(runtime: HostRuntime): void {
	const ctx = runtime.ctx;
	const fps = fastestFps(runtime);
	if (ctx === undefined || runtime.component === undefined || runtime.tui === undefined || fps === undefined) {
		stopAnimationTimer(runtime);
		return;
	}
	if (runtime.timer !== undefined && runtime.timerFps === fps) return;
	stopAnimationTimer(runtime);
	const component = runtime.component;
	const tui = runtime.tui;
	runtime.timer = ctx.setInterval(
		() => {
			if (runtime.component !== component || runtime.tui !== tui) return;
			if (!hasVisibleSnapshot(runtime)) {
				syncWidget(runtime);
				return;
			}
			tui.requestComponentRender(component);
		},
		Math.max(1, Math.round(1000 / fps)),
	);
	runtime.timerFps = fps;
}

function requestRender(runtime: HostRuntime): void {
	if (runtime.component !== undefined && runtime.tui !== undefined) {
		runtime.tui.requestComponentRender(runtime.component);
	}
}

function clearWidget(runtime: HostRuntime): void {
	stopAnimationTimer(runtime);
	if (runtime.ctx?.hasUI && runtime.mounted) runtime.ctx.ui.setWidget(WIDGET_KEY, undefined);
	runtime.component = undefined;
	runtime.tui = undefined;
	runtime.mounted = false;
	runtime.mountedPlacement = undefined;
}

function syncWidget(runtime: HostRuntime): void {
	const ctx = runtime.ctx;
	if (ctx === undefined || !ctx.hasUI || !runtime.config.enabled || !hasVisibleSnapshot(runtime)) {
		if (ctx !== undefined) clearWidget(runtime);
		return;
	}
	const placement = runtime.config.widgetPlacement;
	if (runtime.mounted && runtime.mountedPlacement !== placement) {
		clearWidget(runtime);
	}
	if (!runtime.mounted) {
		ctx.ui.setWidget(
			WIDGET_KEY,
			tui => {
				const component: WidgetComponent = {
					dispose() {
						if (runtime.component === component) {
							runtime.component = undefined;
							runtime.tui = undefined;
						}
					},
					invalidate() {},
					render(width: number): readonly string[] {
						return composeDisplayRows(configuredSnapshots(runtime), {
							layout: runtime.config.layout,
							order: runtime.config.order,
							horizontalSeparator: runtime.config.horizontalSeparator,
							powerline: powerlinePalette(runtime),
							verticalGapRows: runtime.config.verticalGapRows,
							width,
							nowMs: monotonicNow(),
							animationOriginMs: runtime.animationOriginMs,
							active: runtime.active,
						});
					},
				};
				runtime.component = component;
				runtime.tui = tui;
				ensureAnimationTimer(runtime);
				return component;
			},
			{ placement },
		);
		runtime.mounted = true;
		runtime.mountedPlacement = placement;
	}
	ensureAnimationTimer(runtime);
	requestRender(runtime);
}

function parseSharedDisplayConfigChanged(data: unknown): SharedDisplayConfig | undefined {
	if (!isRecord(data) || !isRecord(data.config)) return undefined;
	const config = data.config;
	if (config.version !== 1 || !isRecord(config.display) || !isRecord(config.behavior)) return undefined;
	return normalizeSharedDisplayConfig(config.display.sharedDisplay);
}

function handleSharedDisplayConfigChanged(runtime: HostRuntime, data: unknown): void {
	if (!isRootConfigPath(runtime.configPath)) return;
	const next = parseSharedDisplayConfigChanged(data);
	if (next !== undefined) applySharedDisplayRuntime(runtime, next);
}

function safeEmit(events: SharedDisplayEvents | undefined, data: unknown): void {
	if (events === undefined) return;
	try {
		events.emit(CHANNEL, data);
	} catch {
		// A producer must not take down the host when another listener fails.
	}
}

function announceHost(runtime: HostRuntime, active = runtime.config.enabled && runtime.ctx?.hasUI === true): void {
	if (runtime.epoch === undefined) return;
	safeEmit(runtime.events, { protocol: 1, kind: "host", epoch: runtime.epoch, active });
}

function handleHostMessage(runtime: HostRuntime, data: unknown): void {
	const message = parseSharedDisplayMessage(data);
	if (message === undefined) return;
	if (message.kind === "ready") {
		if (runtime.epoch !== undefined) {
			announceHost(runtime);
			if (runtime.config.enabled && runtime.ctx?.hasUI) {
				safeEmit(runtime.events, { protocol: 1, kind: "request", epoch: runtime.epoch, source: message.source });
			}
		}
		return;
	}
	if (message.kind !== "snapshot" || !runtime.config.enabled || !runtime.ctx?.hasUI ||
		runtime.epoch === undefined || message.epoch !== runtime.epoch) return;
	const previousRevision = runtime.revisions.get(message.source) ?? 0;
	if (message.revision <= previousRevision) return;
	runtime.revisions.set(message.source, message.revision);
	if (message.sequence === null) runtime.snapshots.delete(message.source);
	else runtime.snapshots.set(message.source, copyFrameSequence(message.sequence));
	syncWidget(runtime);
}

function requestSnapshots(runtime: HostRuntime): void {
	if (runtime.epoch === undefined || !runtime.config.enabled || !runtime.ctx?.hasUI) return;
	safeEmit(runtime.events, { protocol: 1, kind: "request", epoch: runtime.epoch });
}

function resetSnapshots(runtime: HostRuntime): void {
	runtime.snapshots.clear();
	runtime.revisions.clear();
}

function startSession(runtime: HostRuntime, context: unknown): void {
	const ctx = context as HostContext;
	announceHost(runtime, false);
	clearWidget(runtime);
	runtime.active = false;
	runtime.animationOriginMs = monotonicNow();
	resetSnapshots(runtime);
	runtime.ctx = ctx;
	runtime.config = loadSharedDisplayConfig(runtime.configPath);
	runtime.epoch = randomUUID();
	announceHost(runtime);
	requestSnapshots(runtime);
	syncWidget(runtime);
}

function terminalAgentEnd(runtime: HostRuntime): void {
	runtime.active = false;
	requestRender(runtime);
}

function startAgent(runtime: HostRuntime): void {
	if (runtime.active) return;
	runtime.active = true;
	if (runtime.animationOriginMs === undefined) runtime.animationOriginMs = monotonicNow();
	syncWidget(runtime);
}

function endAgent(runtime: HostRuntime, event: unknown): void {
	const willContinue = isObject(event) && event.willContinue === true;
	if (willContinue) return;
	terminalAgentEnd(runtime);
}

function shutdown(runtime: HostRuntime): void {
	announceHost(runtime, false);
	clearWidget(runtime);
	runtime.active = false;
	runtime.animationOriginMs = undefined;
	runtime.epoch = undefined;
	runtime.ctx = undefined;
	resetSnapshots(runtime);
	runtime.unsubscribe?.();
	runtime.unsubscribe = undefined;
	runtime.configUnsubscribe?.();
	runtime.configUnsubscribe = undefined;
}

function parseOrderInput(value: string): DisplaySource[] {
	if (value.trim() === "") return [];
	return [...new Set(value.split(",").map(item => item.trim()).filter(isDisplaySource))];
}

function inputSubmenu(
	currentValue: string,
	done: (value?: string) => void,
): Component {
	const input = new Input();
	input.prompt = "> ";
	input.setValue(currentValue);
	input.onSubmit = value => done(value);
	input.onEscape = () => done(undefined);
	return input;
}

export function sharedDisplaySettingsItems(
	draft: SharedDisplayConfig,
): SettingItem[] {
	return [
		{ id: "config", label: "Config", currentValue: "", heading: true },
		{
			id: "enabled",
			label: "Enabled",
			currentValue: String(draft.enabled),
			values: ["true", "false"],
			changed: draft.enabled !== DEFAULT_SHARED_DISPLAY_CONFIG.enabled,
			description:
				"Enable the Shared Display host and composed status widget. False removes the widget until re-enabled.",
		},
		{
			id: "layout",
			label: "Layout",
			currentValue: draft.layout,
			values: ["horizontal", "vertical"],
			changed: draft.layout !== DEFAULT_SHARED_DISPLAY_CONFIG.layout,
			description:
				"Arrange configured sources side by side (horizontal) or in stacked rows (vertical).",
		},
		{
			id: "style",
			label: "Style",
			currentValue: draft.style,
			values: ["plain", "powerline"],
			changed: draft.style !== DEFAULT_SHARED_DISPLAY_CONFIG.style,
			description: "Plain text, or Starship-style powerline segments colored from the active OMP theme (needs a Nerd Font).",
		},
		{
			id: "order",
			label: "Source order",
			currentValue: draft.order.join(", "),
			submenu: (current, done) => inputSubmenu(current, done),
			changed: draft.order.join(",") !== DEFAULT_SHARED_DISPLAY_CONFIG.order.join(","),
			description:
				"Comma-separated source order: ponytail, caveman, headroom, rtk, codegraph, beads. Unknown names and duplicates are discarded. Omitted sources are appended; integration visibility controls whether they appear.",
		},
		{
			id: "widgetPlacement",
			label: "Widget placement",
			currentValue: draft.widgetPlacement,
			values: ["aboveEditor", "belowEditor"],
			changed: draft.widgetPlacement !== DEFAULT_SHARED_DISPLAY_CONFIG.widgetPlacement,
			description: "Mount the shared widget above or below the prompt editor.",
		},
		{
			id: "horizontalSeparator",
			label: "Horizontal separator",
			currentValue: draft.horizontalSeparator,
			submenu: (current, done) => inputSubmenu(current, done),
			description:
				"Text inserted between sources in horizontal layout. Must be one line; an empty string is allowed.",
		},
		{
			id: "verticalGapRows",
			label: "Vertical gap rows",
			currentValue: String(draft.verticalGapRows),
			submenu: (current, done) => inputSubmenu(current, done),
			description:
				"Blank rows inserted between sources in vertical layout. Enter an integer from 0 through 10.",
		},
		{ id: "actions", label: "Actions", currentValue: "", heading: true },
		{
			id: "show-paths",
			label: "Show paths",
			currentValue: "Enter",
			description: "Show the active config.json path.",
		},
		{
			id: "reload",
			label: "Reload from disk",
			currentValue: "Enter",
			description:
				"Discard draft edits and reread config.json; live settings stay unchanged until Apply.",
		},
		{
			id: "apply",
			label: "Apply changes",
			currentValue: "Enter",
			description:
				"Validate every field, atomically save config.json, and activate this draft.",
		},
		{
			id: "cancel",
			label: "Cancel",
			currentValue: "Enter",
			description:
				"Close without saving draft edits or changing live settings.",
		},
	];
}

export function updateSharedDisplayDraft(
	draft: SharedDisplayConfig,
	id: string,
	value: string,
): void {
	switch (id) {
		case "enabled":
			draft.enabled = value === "true";
			break;
		case "layout":
			if (value === "horizontal" || value === "vertical") draft.layout = value;
			break;
		case "style":
			if (value === "plain" || value === "powerline") draft.style = value;
			break;
		case "order":
			draft.order = parseOrderInput(value);
			break;
		case "widgetPlacement":
			if (value === "aboveEditor" || value === "belowEditor") draft.widgetPlacement = value;
			break;
		case "horizontalSeparator":
			draft.horizontalSeparator = value;
			break;
		case "verticalGapRows":
			draft.verticalGapRows = Number(value);
			break;
	}
}

function applySharedDisplayRuntime(runtime: HostRuntime, next: SharedDisplayConfig): void {
	const wasEnabled = runtime.config.enabled;
	clearWidget(runtime);
	runtime.config = normalizeSharedDisplayConfig(next);
	if (runtime.config.enabled !== wasEnabled) announceHost(runtime);
	if (runtime.config.enabled && !wasEnabled) requestSnapshots(runtime);
	syncWidget(runtime);
}

export async function openSharedDisplayConfigDialog(runtime: HostRuntime, context: HostContext): Promise<void> {
	if (!context.hasUI || context.ui.custom === undefined) {
		context.ui.notify("Shared Display configuration requires the interactive TUI.", "warning");
		return;
	}
	let draft = cloneSharedDisplayConfig(loadSharedDisplayConfig(runtime.configPath));
	let error: string | undefined;
	await context.ui.custom<void>((_tui, _theme, _keybindings, done) => {
		let list: SettingsList;
		const finish = (): void => done(undefined);
		const refresh = (): void => list.setItems(sharedDisplaySettingsItems(draft));
		const component: Component = {
			render(width: number): readonly string[] {
				const rows = [...list.render(width)];
				if (error !== undefined) rows.push(`Error: ${error}`);
				rows.push("Enter edit/action  Esc cancel");
				return rows;
			},
			handleInput(data: string): void {
				if (data === "\n" || data === "\r") {
					const id = list.getSelectedItem()?.id;
					if (id === "show-paths") {
						context.ui.notify(
							`Config: ${runtime.configPath}`,
							"info",
						);
						return;
					}
					if (id === "reload") {
						draft = cloneSharedDisplayConfig(loadSharedDisplayConfig(runtime.configPath));
						error = undefined;
						refresh();
						return;
					}
					if (id === "cancel") {
						finish();
						return;
					}
					if (id === "apply") {
						const errors = validateSharedDisplayConfig(draft);
						if (errors.length > 0) {
							error = errors.join("; ");
							return;
						}
						try {
							writeSharedDisplayConfig(draft, runtime.configPath);
							applySharedDisplayRuntime(runtime, draft);
							finish();
						} catch (applyError) {
							error = applyError instanceof Error ? applyError.message : String(applyError);
						}
						return;
					}
				}
				list.handleInput(data);
			},
			invalidate(): void {
				list.invalidate();
			},
		};
		list = new SettingsList(
			sharedDisplaySettingsItems(draft),
			Math.min(18, sharedDisplaySettingsItems(draft).length),
			getSettingsListTheme(),
			(id, value) => {
				updateSharedDisplayDraft(draft, id, value);
				refresh();
			},
			finish,
			{ layout: "flat", hint: "Up/Down navigate · Enter edit · Esc cancel" },
		);
		return component;
	});
}

export default function sharedDisplayExtension(pi: ExtensionAPI, options: HostOptions = {}): void {
	const runtime: HostRuntime = {
		config: loadSharedDisplayConfig(options.configPath),
		configPath: options.configPath ?? SHARED_DISPLAY_CONFIG_PATH,
		snapshots: new Map(),
		revisions: new Map(),
		active: false,
		mounted: false,
	};
	runtime.events = (pi as unknown as { events?: SharedDisplayEvents }).events;
	if (runtime.events !== undefined) {
		runtime.unsubscribe = runtime.events.on(CHANNEL, data => handleHostMessage(runtime, data));
		if (isRootConfigPath(runtime.configPath)) {
			runtime.configUnsubscribe = runtime.events.on(CODESOOK_OMP_CONFIG_CHANGED, data =>
				handleSharedDisplayConfigChanged(runtime, data),
			);
		}
	}

	pi.on("session_start", (_event, ctx) => startSession(runtime, ctx));
	pi.on("session_switch", (_event, ctx) => startSession(runtime, ctx));
	pi.on("session_branch", (_event, ctx) => startSession(runtime, ctx));
	pi.on("agent_start", () => startAgent(runtime));
	pi.on("agent_end", (event) => endAgent(runtime, event));
	pi.on("session_shutdown", () => shutdown(runtime));

}

export const __test__ = {
	DEFAULT_SHARED_DISPLAY_CONFIG,
	configuredSnapshots,
	fastestFps,
	fitDisplayRow,
	hasVisibleSnapshot,
};
