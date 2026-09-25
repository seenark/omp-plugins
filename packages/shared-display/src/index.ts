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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { getSettingsListTheme } from "@oh-my-pi/pi-coding-agent";
import { Input, SettingsList, type Component, type SettingItem } from "@oh-my-pi/pi-tui";
import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import {
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
} from "./client.ts";

const WIDGET_KEY = "codesook-shared-display";
const DEFAULT_HORIZONTAL_SEPARATOR = "  ";
const DEFAULT_PONYTAIL_TEMPLATE = "{activity} {glyph} ponytail: {modeIcon}{mode}";
const DEFAULT_PONYTAIL_DIRECTORY = "~/.config/codesook-omp/ponytail";
const SOURCE_ORDER: readonly DisplaySource[] = ["ponytail", "caveman", "headroom"];
const PONYTAIL_MODES = ["off", "lite", "full", "ultra", "review"] as const;
const PONYTAIL_MODE_ICONS: Record<PonytailMode, string> = {
	off: "",
	lite: "🌿 ",
	full: "⚡ ",
	ultra: "🔥 ",
	review: "",
};

export type SharedDisplayLayout = "horizontal" | "vertical";
export type SharedDisplayPlacement = "aboveEditor" | "belowEditor";
export type PonytailMode = (typeof PONYTAIL_MODES)[number];

export type SharedDisplayConfig = {
	enabled: boolean;
	layout: SharedDisplayLayout;
	order: DisplaySource[];
	widgetPlacement: SharedDisplayPlacement;
	horizontalSeparator: string;
	verticalGapRows: number;
	ponytail: {
		visible: boolean;
		nativeVisible: boolean;
		template: string;
		glyphDirectory: string;
	};
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
	order: [...SOURCE_ORDER],
	widgetPlacement: "belowEditor",
	horizontalSeparator: DEFAULT_HORIZONTAL_SEPARATOR,
	verticalGapRows: 0,
	ponytail: {
		visible: true,
		nativeVisible: false,
		template: DEFAULT_PONYTAIL_TEMPLATE,
		glyphDirectory: DEFAULT_PONYTAIL_DIRECTORY,
	},
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneDefaultConfig(): SharedDisplayConfig {
	return {
		...DEFAULT_SHARED_DISPLAY_CONFIG,
		order: [...DEFAULT_SHARED_DISPLAY_CONFIG.order],
		ponytail: { ...DEFAULT_SHARED_DISPLAY_CONFIG.ponytail },
	};
}

function nonEmptyString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

export function normalizeSharedDisplayConfig(raw: unknown): SharedDisplayConfig {
	const source = isObject(raw) ? raw : {};
	const ponytail = isObject(source.ponytail) ? source.ponytail : {};
	const normalized = cloneDefaultConfig();
	if (typeof source.enabled === "boolean") normalized.enabled = source.enabled;
	if (source.layout === "horizontal" || source.layout === "vertical") normalized.layout = source.layout;
	if (Array.isArray(source.order)) {
		normalized.order = [...new Set(source.order.filter(isDisplaySource))];
	}
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
	if (typeof ponytail.visible === "boolean") normalized.ponytail.visible = ponytail.visible;
	if (typeof ponytail.nativeVisible === "boolean") normalized.ponytail.nativeVisible = ponytail.nativeVisible;
	normalized.ponytail.template = nonEmptyString(ponytail.template, normalized.ponytail.template);
	normalized.ponytail.glyphDirectory = nonEmptyString(
		ponytail.glyphDirectory,
		normalized.ponytail.glyphDirectory,
	);
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
		ponytail: { ...config.ponytail },
	};
}

export function validateSharedDisplayConfig(config: unknown): string[] {
	if (!isObject(config)) return ["configuration must be an object"];
	const errors: string[] = [];
	if (typeof config.enabled !== "boolean") errors.push("enabled must be boolean");
	if (config.layout !== "horizontal" && config.layout !== "vertical") errors.push("layout is invalid");
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
	const ponytail = isObject(config.ponytail) ? config.ponytail : undefined;
	if (ponytail === undefined) {
		errors.push("ponytail must be an object");
	} else {
		if (typeof ponytail.visible !== "boolean") errors.push("ponytail.visible must be boolean");
		if (typeof ponytail.nativeVisible !== "boolean") errors.push("ponytail.nativeVisible must be boolean");
		if (typeof ponytail.template !== "string" || ponytail.template.trim().length === 0) {
			errors.push("ponytail.template must be nonempty");
		}
		if (
			typeof ponytail.glyphDirectory !== "string" ||
			ponytail.glyphDirectory.trim().length === 0
		) {
			errors.push("ponytail.glyphDirectory must be nonempty");
		}
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

export type PonytailStatus = {
	active: boolean;
	mode: PonytailMode;
};

export function parsePonytailStatus(text: string | undefined): PonytailStatus | undefined {
	if (text === undefined) return undefined;
	if (text.length === 0) return { active: false, mode: "off" };
	const plain = text.replace(/\x1b\[[0-9;:]*m/gu, "");
	const match = /([○●])?.*\b(off|lite|full|ultra|review)\s*$/iu.exec(plain);
	if (!match) return undefined;
	return { active: match[1] === "●", mode: match[2]!.toLowerCase() as PonytailMode };
}

export function resolvePonytailSessionStatus(entries: readonly unknown[]): PonytailStatus | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!isObject(entry) || entry.type !== "custom" || entry.customType !== "ponytail-mode") continue;
		const data = isObject(entry.data) ? entry.data : undefined;
		const mode = typeof data?.mode === "string" ? data.mode.trim().toLowerCase() : "";
		if ((PONYTAIL_MODES as readonly string[]).includes(mode)) {
			return { active: false, mode: mode as PonytailMode };
		}
	}
	return undefined;
}

function expandHome(value: string): string {
	return value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

export function loadPackagedPonytailSequence(mode: PonytailMode): FrameSequence | undefined {
	try {
		return parseFrameSequenceAsset(readFileSync(new URL(`../assets/ponytail/${mode}.txt`, import.meta.url), "utf8"));
	} catch {
		return undefined;
	}
}
export function initializeMissingPonytailAssets(config: SharedDisplayConfig): string[] {
	const directory = expandHome(config.ponytail.glyphDirectory);
	mkdirSync(directory, { recursive: true });
	const created: string[] = [];
	for (const mode of PONYTAIL_MODES) {
		const destination = path.join(directory, `${mode}.txt`);
		if (existsSync(destination)) continue;
		try {
			const source = readFileSync(new URL(`../assets/ponytail/${mode}.txt`, import.meta.url), "utf8");
			writeFileSync(destination, source, "utf8");
			created.push(destination);
		} catch {
			// A missing package asset is not a reason to overwrite another asset.
		}
	}
	return created;
}

function ponytailAsset(mode: PonytailMode, config: SharedDisplayConfig): FrameSequence {
	try {
		const user = parseFrameSequenceAsset(
			readFileSync(path.join(expandHome(config.ponytail.glyphDirectory), `${mode}.txt`), "utf8"),
		);
		if (user !== undefined) return user;
	} catch {
		// Package fallback below.
	}
	return loadPackagedPonytailSequence(mode) ?? { frames: [["🐴"]] };
}

function renderPonytailTemplate(
	template: string,
	status: PonytailStatus,
	glyph: string,
): string {
	const values = {
		activity: status.active ? "●" : "○",
		glyph,
		mode: status.mode.toUpperCase(),
		modeIcon: PONYTAIL_MODE_ICONS[status.mode],
	};
	return template
		.replace(/\{(activity|glyph|mode|modeIcon)\}/gu, (_, key: keyof typeof values) => values[key])
		.replace(/\r\n?/gu, "\n");
}

export function ponytailFrameSequence(
	status: PonytailStatus | undefined,
	config: SharedDisplayConfig,
): FrameSequence | null {
	if (status === undefined || status.mode === "off" || !config.ponytail.visible) return null;
	const asset = ponytailAsset(status.mode, config);
	const frames = asset.frames
		.map(frame => renderPonytailTemplate(config.ponytail.template, status, frame.join("\n")).split("\n"))
		.filter(frame => frame.length > 0);
	return frames.length > 0
		? asset.fps === undefined
			? { frames }
			: { frames, fps: asset.fps }
		: null;
}

function ponytailNativeText(status: PonytailStatus, config: SharedDisplayConfig): string {
	const asset = ponytailAsset(status.mode, config);
	const firstRow = asset.frames[0]?.[0] || "🐴";
	return renderPonytailTemplate(config.ponytail.template, status, firstRow).replace(/[\r\n]+/gu, " ");
}

export type ComposeDisplayOptions = {
	layout: SharedDisplayLayout;
	order: readonly DisplaySource[];
	horizontalSeparator?: string;
	verticalGapRows?: number;
	width: number;
	nowMs?: number;
	animationOriginMs?: number;
	active?: boolean;
};

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

	const rows: string[] = [];
	if (options.layout === "vertical") {
		for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
			if (blockIndex > 0) rows.push(...Array.from({ length: Math.max(0, options.verticalGapRows ?? 0) }, () => ""));
			rows.push(...blocks[blockIndex]!.rows);
		}
	} else {
		const height = Math.max(...blocks.map(block => block.rows.length), 0);
		const separator = options.horizontalSeparator ?? DEFAULT_HORIZONTAL_SEPARATOR;
		for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
			rows.push(
				blocks
					.map(block => {
						const row = block.rows[rowIndex] ?? "";
						return `${row}${" ".repeat(Math.max(0, block.width - visibleWidth(row)))}`;
					})
					.join(separator),
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
		setWidget(
			key: string,
			content: ((tui: WidgetTui) => WidgetComponent) | undefined,
			options?: { placement?: string },
		): void;
		setStatus(key: string, text: string | undefined): void;
		notify(message: string, level?: string): void;
		confirm?: (title: string, message: string) => Promise<boolean>;
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
	sessionManager?: { getBranch(): readonly unknown[] };
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
	publisher?: SharedDisplayPublisher;
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
	capturedNativeText?: string;
	savedNativeText?: string;
	ponytailStatus?: PonytailStatus;
	wrapper?: { ui: HostContext["ui"]; previous: HostContext["ui"]["setStatus"]; handler: HostContext["ui"]["setStatus"] };
};

function monotonicNow(): number {
	return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function configuredSnapshots(runtime: HostRuntime): ReadonlyMap<DisplaySource, FrameSequence> {
	const result = new Map<DisplaySource, FrameSequence>();
	for (const source of runtime.config.order) {
		if (source === "ponytail" && !runtime.config.ponytail.visible) continue;
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
		if (source === "ponytail" && !runtime.config.ponytail.visible) continue;
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

function handleHostMessage(runtime: HostRuntime, data: unknown): void {
	const message = parseSharedDisplayMessage(data);
	if (message === undefined) return;
	if (message.kind === "ready") {
		if (runtime.epoch !== undefined) {
			safeEmit(runtime.events, { protocol: 1, kind: "request", epoch: runtime.epoch, source: message.source });
		}
		return;
	}
	if (message.kind !== "snapshot" || runtime.epoch === undefined || message.epoch !== runtime.epoch) return;
	const previousRevision = runtime.revisions.get(message.source) ?? 0;
	if (message.revision <= previousRevision) return;
	runtime.revisions.set(message.source, message.revision);
	if (message.sequence === null) runtime.snapshots.delete(message.source);
	else runtime.snapshots.set(message.source, copyFrameSequence(message.sequence));
	syncWidget(runtime);
}

function teardownWrapper(runtime: HostRuntime): void {
	const wrapper = runtime.wrapper;
	if (wrapper === undefined) return;
	runtime.savedNativeText = runtime.capturedNativeText;
	try {
		wrapper.previous.call(wrapper.ui, "ponytail", undefined);
	} catch {
		// UI teardown should remain best effort during shutdown.
	}
	if (wrapper.ui.setStatus === wrapper.handler) wrapper.ui.setStatus = wrapper.previous;
	runtime.wrapper = undefined;
}

function reconcileNative(runtime: HostRuntime, ctx: HostContext): void {
	const wrapper = runtime.wrapper;
	if (wrapper === undefined) return;
	let text: string | undefined;
	if (runtime.config.ponytail.nativeVisible && runtime.ponytailStatus !== undefined && runtime.ponytailStatus.mode !== "off") {
		const parsedSaved = parsePonytailStatus(runtime.savedNativeText);
		text =
			parsedSaved?.mode === runtime.ponytailStatus.mode && runtime.savedNativeText !== undefined
				? runtime.savedNativeText
				: ponytailNativeText(runtime.ponytailStatus, runtime.config);
	}
	wrapper.previous.call(ctx.ui, "ponytail", text);
}

function installWrapper(runtime: HostRuntime, ctx: HostContext): void {
	if (!runtime.config.enabled) return;
	const previous = ctx.ui.setStatus;
	const handler = (key: string, text: string | undefined): void => {
		if (key !== "ponytail") {
			previous.call(ctx.ui, key, text);
			return;
		}
		runtime.capturedNativeText = text;
		const status = parsePonytailStatus(text);
		runtime.ponytailStatus = status;
		runtime.publisher?.publish(ponytailFrameSequence(status, runtime.config));
		previous.call(ctx.ui, key, runtime.config.ponytail.nativeVisible ? text : undefined);
		syncWidget(runtime);
	};
	ctx.ui.setStatus = handler;
	runtime.wrapper = { ui: ctx.ui, previous, handler };
	reconcileNative(runtime, ctx);
}

function requestSnapshots(runtime: HostRuntime): void {
	if (runtime.epoch === undefined) return;
	safeEmit(runtime.events, { protocol: 1, kind: "request", epoch: runtime.epoch });
}

function resetSnapshots(runtime: HostRuntime): void {
	runtime.snapshots.clear();
	runtime.revisions.clear();
}

function startSession(runtime: HostRuntime, context: unknown): void {
	const ctx = context as HostContext;
	teardownWrapper(runtime);
	runtime.capturedNativeText = undefined;
	clearWidget(runtime);
	runtime.active = false;
	runtime.animationOriginMs = monotonicNow();
	resetSnapshots(runtime);
	runtime.ctx = ctx;
	runtime.config = loadSharedDisplayConfig(runtime.configPath);
	runtime.epoch = randomUUID();
	runtime.publisher?.dispose();
	runtime.publisher = connectSharedDisplay(runtime.events, "ponytail");
	runtime.ponytailStatus = resolvePonytailSessionStatus(ctx.sessionManager?.getBranch() ?? []);
	runtime.publisher.publish(
		runtime.config.enabled ? ponytailFrameSequence(runtime.ponytailStatus, runtime.config) : null,
	);
	if (runtime.config.enabled && ctx.hasUI) installWrapper(runtime, ctx);
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
	if (runtime.ponytailStatus !== undefined) {
		runtime.ponytailStatus = { ...runtime.ponytailStatus, active: true };
		 runtime.publisher?.publish(ponytailFrameSequence(runtime.ponytailStatus, runtime.config));
		if (runtime.wrapper !== undefined && runtime.config.ponytail.nativeVisible) {
			runtime.wrapper.previous.call(runtime.wrapper.ui, "ponytail", ponytailNativeText(runtime.ponytailStatus, runtime.config));
		}
	}
	syncWidget(runtime);
}

function endAgent(runtime: HostRuntime, event: unknown): void {
	const willContinue = isObject(event) && event.willContinue === true;
	if (willContinue) return;
	if (runtime.ponytailStatus !== undefined) {
		runtime.ponytailStatus = { ...runtime.ponytailStatus, active: false };
		runtime.publisher?.publish(ponytailFrameSequence(runtime.ponytailStatus, runtime.config));
		if (runtime.wrapper !== undefined && runtime.config.ponytail.nativeVisible) {
			runtime.wrapper.previous.call(runtime.wrapper.ui, "ponytail", ponytailNativeText(runtime.ponytailStatus, runtime.config));
		}
	}
	terminalAgentEnd(runtime);
}

function shutdown(runtime: HostRuntime): void {
	teardownWrapper(runtime);
	if (runtime.publisher !== undefined) {
		runtime.publisher.publish(null);
		runtime.publisher.dispose();
		runtime.publisher = undefined;
	}
	clearWidget(runtime);
	runtime.active = false;
	runtime.animationOriginMs = undefined;
	runtime.epoch = undefined;
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
				"Enable the Shared Display host and composed status widget. False removes the widget and stops host-controlled Ponytail routing until re-enabled.",
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
			id: "order",
			label: "Source order",
			currentValue: draft.order.join(", "),
			submenu: (current, done) => inputSubmenu(current, done),
			changed: draft.order.join(",") !== DEFAULT_SHARED_DISPLAY_CONFIG.order.join(","),
			description:
				"Comma-separated source order: ponytail, caveman, headroom. Unknown names and duplicates are discarded; blank shows no sources.",
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
		{ id: "ponytail", label: "Ponytail", currentValue: "", heading: true },
		{
			id: "ponytail.visible",
			label: "Visible",
			currentValue: String(draft.ponytail.visible),
			values: ["true", "false"],
			description:
				"Include Ponytail frames in Shared Display. This does not control Ponytail's native footer status.",
		},
		{
			id: "ponytail.nativeVisible",
			label: "Native status",
			currentValue: String(draft.ponytail.nativeVisible),
			values: ["true", "false"],
			description:
				"Show captured Ponytail status in OMP's native footer while Shared Display is enabled. Independent of the Ponytail widget row.",
		},
		{
			id: "ponytail.template",
			label: "Template",
			currentValue: draft.ponytail.template,
			submenu: (current, done) => inputSubmenu(current, done),
			description:
				"Ponytail format. Tokens: {activity}=●/○, {glyph}=current frame, {mode}=uppercase mode, {modeIcon}=mode icon; other text stays literal.",
		},
		{
			id: "ponytail.glyphDirectory",
			label: "Glyph directory",
			currentValue: draft.ponytail.glyphDirectory,
			submenu: (current, done) => inputSubmenu(current, done),
			description:
				"Directory for off.txt, lite.txt, full.txt, ultra.txt, review.txt (off renders nothing). Optional positive fps=N; whitespace frames or blank-line blocks. Invalid/missing files use packaged assets; ~ means home.",
		},
		{ id: "actions", label: "Actions", currentValue: "", heading: true },
		{
			id: "show-paths",
			label: "Show paths",
			currentValue: "Enter",
			description: "Show the active config.json path and draft Ponytail Glyph directory.",
		},
		{
			id: "initialize-assets",
			label: "Initialize missing assets",
			currentValue: "Enter",
			description:
				"Create only missing off.txt, lite.txt, full.txt, ultra.txt, and review.txt in the draft directory; existing files stay untouched and created files remain after Cancel.",
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
				"Close without saving draft edits or changing live settings; initialized asset files remain on disk.",
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
		case "ponytail.visible":
			draft.ponytail.visible = value === "true";
			break;
		case "ponytail.nativeVisible":
			draft.ponytail.nativeVisible = value === "true";
			break;
		case "ponytail.template":
			draft.ponytail.template = value;
			break;
		case "ponytail.glyphDirectory":
			draft.ponytail.glyphDirectory = value;
			break;
	}
}

function applySharedDisplayRuntime(runtime: HostRuntime, next: SharedDisplayConfig): void {
	teardownWrapper(runtime);
	clearWidget(runtime);
	runtime.config = cloneSharedDisplayConfig(next);
	runtime.publisher?.publish(
		runtime.config.enabled ? ponytailFrameSequence(runtime.ponytailStatus, runtime.config) : null,
	);
	if (runtime.ctx?.hasUI && runtime.config.enabled) installWrapper(runtime, runtime.ctx);
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
							`Config: ${runtime.configPath}\nGlyphs: ${draft.ponytail.glyphDirectory}`,
							"info",
						);
						return;
					}
					if (id === "initialize-assets") {
						void (async () => {
							const confirmed =
								context.ui.confirm === undefined ||
								(await context.ui.confirm(
									"Initialize Shared Display assets?",
									"Create only missing Ponytail asset files?",
								));
							if (!confirmed) return;
							const created = initializeMissingPonytailAssets(draft);
							context.ui.notify(
								created.length > 0 ? `Created:\n${created.join("\n")}` : "No missing assets.",
								"info",
							);
						})();
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
	ponytailNativeText,
	ponytailAsset,
};
