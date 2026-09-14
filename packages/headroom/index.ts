import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { getSettingsListTheme } from "@oh-my-pi/pi-coding-agent";
import {
	Input,
	SettingsList,
	Text,
	type Component,
	type SettingItem,
} from "@oh-my-pi/pi-tui";
import {
	connectSharedDisplay,
	type SharedDisplayPublisher,
} from "@codesook/omp-shared-display/client";
import { applyCompressionResult, buildCompressionPayload } from "./bridge.ts";
import { HeadroomHttpClient } from "./client.ts";
import {
	HEADROOM_CONFIG_FILE,
	isRemoteBlocked,
	loadHeadroomConfig,
	normalizeHeadroomConfig,
	writeHeadroomConfig,
	type HeadroomConfig,
	type HeadroomConfigLoadOptions,
} from "./config.ts";
import {
	DEFAULT_GLYPHS,
	loadGlyphAsset,
	renderDisplayFrames,
	resolveThemeGlyph,
	widgetState,
	type DisplayState,
} from "./display.ts";
import {
	buildHeadroomInitFiles,
	writeHeadroomInitFiles,
	type HeadroomInitPaths,
	type HeadroomInitTarget,
} from "./init.ts";
import { startPersistentHeadroomProxy } from "./proxy-manager.ts";
import type { AgentMessage, CompressResult, HeadroomStats } from "./types.ts";

const SUBCOMMANDS = ["config", "status", "on", "off", "health", "stats", "init"] as const;
const INIT_TARGETS = ["config", "glyphs", "all"] as const;
const HEADROOM_USAGE = "Usage: /headroom [config|status|on|off|health|stats|init [config|glyphs|all]]";
const HEADROOM_STATUS_PURPOSES = {
	off: "Used while effective compression is disabled.",
	"remote-blocked": "Used when Base URL is non-local and Allow remote is false.",
	starting: "Used while Headroom is starting a local proxy.",
	offline: "Used after the proxy is confirmed unavailable.",
	idle: "Used while enabled before proxy health is known.",
	online: "Used while the proxy is healthy and no compression result exists.",
	compressed: "Used after a compression has saved tokens in this session.",
} satisfies Record<DisplayState, string>;

type Subcommand = (typeof SUBCOMMANDS)[number];
type ParsedCommand = { command: Subcommand | "invalid"; initTarget?: HeadroomInitTarget };

type HeadroomRuntimeState = {
	enabled: boolean;
	sessionEnabledOverride: boolean | undefined;
	proxyOnline: boolean | null;
	proxyStarting: boolean;
	proxyStartAttempted: boolean;
	remoteWarningShown: boolean;
	offlineWarningShown: boolean;
	stats: HeadroomStats;
};

type HeadroomRuntime = {
	config: HeadroomConfig;
	client: HeadroomHttpClient;
	state: HeadroomRuntimeState;
	publisher: SharedDisplayPublisher | undefined;
	configPath: string;
	glyphDirectoryOverride: string | undefined;
	env: NodeJS.ProcessEnv;
	refreshStatus(ctx: ExtensionContext): void;
	updateHealth(ctx: ExtensionContext): Promise<boolean>;
	ensureProxy(ctx: ExtensionContext): Promise<boolean>;
};

export interface HeadroomExtensionOptions {
	initPaths?: HeadroomInitPaths;
	configPath?: string;
	glyphDirectory?: string;
	env?: NodeJS.ProcessEnv;
	legacySettingsPaths?: readonly string[];
	legacyDisplayPath?: string;
}

type DialogResult = { action: "apply"; config: HeadroomConfig } | { action: "cancel" };
export default function headroomExtension(pi: ExtensionAPI, options: HeadroomExtensionOptions = {}): void {
	const configPath = options.configPath ?? HEADROOM_CONFIG_FILE;
	let activeContext: ExtensionContext | undefined;
	const warned = new Set<string>();
	const pendingWarnings = new Set<string>();
	const warn = (message: string): void => {
		if (warned.has(message)) return;
		warned.add(message);
		if (activeContext?.hasUI) {
			activeContext.ui.notify(message, "warning");
			return;
		}
		pendingWarnings.add(message);
		const logger = (pi as unknown as { logger?: { warn?: (text: string) => void } }).logger;
		logger?.warn?.(message);
	};
	const runtime = createRuntime({
		...options,
		configPath,
		warn,
		env: options.env ?? process.env,
	});

	const startSession = (_event: unknown, ctx: ExtensionContext): void => {
		activeContext = ctx;
		for (const message of pendingWarnings) {
			if (ctx.hasUI) ctx.ui.notify(message, "warning");
		}
		pendingWarnings.clear();
		resetSession(runtime, pi, ctx, { ...options, configPath, warn, env: options.env ?? process.env });
	};
	pi.on("session_start", startSession);
	pi.on("session_switch", startSession);
	pi.on("session_branch", startSession);
	pi.on("session_shutdown", (_event, ctx) => {
		activeContext = ctx;
		disposePublisher(runtime);
		activeContext = undefined;
	});
	pi.on("context", (event, ctx) => handleContextCompression(runtime, event, ctx));

	pi.registerCommand("headroom", {
		description: `Headroom token compression. ${HEADROOM_USAGE}`,
		getArgumentCompletions(argumentPrefix) {
			const normalized = argumentPrefix.toLowerCase();
			const tokens = normalized.trim().split(/\s+/).filter(Boolean);
			if (/\s/.test(normalized)) {
				if (tokens[0] === "init" && tokens.length <= 2) {
					const prefix = tokens[1] ?? "";
					return INIT_TARGETS.filter((target) => target.startsWith(prefix)).map((value) => ({ value, label: value }));
				}
				if (tokens.length > 1) return [];
				const prefix = tokens[0] ?? "";
				return SUBCOMMANDS.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
			}
			const prefix = normalized.trim();
			return SUBCOMMANDS.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => handleCommand(runtime, parseCommand(args), ctx, options.initPaths),
	});
}

function createRuntime(options: HeadroomConfigLoadOptions & { glyphDirectory?: string }): HeadroomRuntime {
	const config = loadRuntimeConfig(options);
	const client = new HeadroomHttpClient({ baseUrl: config.baseUrl, timeoutMs: config.timeoutMs });
	const state: HeadroomRuntimeState = {
		enabled: config.enabled,
		sessionEnabledOverride: undefined,
		proxyOnline: null,
		proxyStarting: false,
		proxyStartAttempted: false,
		remoteWarningShown: false,
		offlineWarningShown: false,
		stats: emptyStats(),
	};
	const runtime: HeadroomRuntime = {
		config,
		client,
		state,
		publisher: undefined,
		configPath: options.configPath ?? HEADROOM_CONFIG_FILE,
		glyphDirectoryOverride: options.glyphDirectory,
		env: options.env ?? process.env,
		refreshStatus(ctx) {
			publishDisplay(runtime, ctx);
		},
		async updateHealth(ctx) {
			const online = await updateHealthState(runtime);
			runtime.refreshStatus(ctx);
			return online;
		},
		async ensureProxy(ctx) {
			return ensureProxy(runtime, ctx);
		},
	};
	return runtime;
}

function resetSession(
	runtime: HeadroomRuntime,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	options: HeadroomExtensionOptions & HeadroomConfigLoadOptions,
): void {
	disposePublisher(runtime);
	const previousConfig = runtime.config;
	const nextConfig = loadRuntimeConfig({
		...options,
		configPath: runtime.configPath,
		env: runtime.env,
	});
	runtime.config = nextConfig;
	runtime.glyphDirectoryOverride = options.glyphDirectory;
	if (previousConfig.baseUrl !== nextConfig.baseUrl || previousConfig.timeoutMs !== nextConfig.timeoutMs) {
		runtime.client = new HeadroomHttpClient({ baseUrl: nextConfig.baseUrl, timeoutMs: nextConfig.timeoutMs });
	}
	runtime.state.enabled = nextConfig.enabled;
	runtime.state.sessionEnabledOverride = undefined;
	runtime.state.proxyOnline = null;
	runtime.state.proxyStarting = false;
	runtime.state.proxyStartAttempted = false;
	runtime.state.remoteWarningShown = false;
	runtime.state.offlineWarningShown = false;
	runtime.state.stats = emptyStats();
	const events = (pi as unknown as { events?: unknown }).events;
	runtime.publisher = connectSharedDisplay(isEventBus(events) ? events : undefined, "headroom");
	runtime.refreshStatus(ctx);
	if (isRemoteBlocked(runtime.config)) {
		notify(ctx, `Headroom remote URL is blocked by default: ${runtime.config.baseUrl}\nSet PI_HEADROOM_ALLOW_REMOTE=1 only if you trust that proxy with full context.`, "warning");
		return;
	}
	if (runtime.state.enabled) void ensureProxyInBackground(runtime, ctx);
}

function loadRuntimeConfig(options: HeadroomConfigLoadOptions & { glyphDirectory?: string }): HeadroomConfig {
	const config = loadHeadroomConfig({
		env: options.env ?? process.env,
		configPath: options.configPath ?? HEADROOM_CONFIG_FILE,
		legacySettingsPaths: options.legacySettingsPaths,
		legacyDisplayPath: options.legacyDisplayPath,
		warn: options.warn,
	});
	if (!options.glyphDirectory) return config;
	return {
		...config,
		display: { ...config.display, glyphDirectory: options.glyphDirectory },
	};
}

function disposePublisher(runtime: HeadroomRuntime): void {
	if (!runtime.publisher) return;
	try {
		runtime.publisher.publish(null);
		runtime.publisher.dispose();
	} finally {
		runtime.publisher = undefined;
	}
}

function isEventBus(value: unknown): value is { emit: (channel: string, data: unknown) => void; on: (channel: string, handler: (data: unknown) => void) => () => void } {
	return typeof value === "object" && value !== null && typeof (value as { emit?: unknown }).emit === "function" && typeof (value as { on?: unknown }).on === "function";
}

async function updateHealthState(runtime: HeadroomRuntime, signal?: AbortSignal): Promise<boolean> {
	if (isRemoteBlocked(runtime.config)) return false;
	runtime.state.proxyOnline = await runtime.client.health(signal);
	return runtime.state.proxyOnline;
}

async function ensureProxy(runtime: HeadroomRuntime, ctx: ExtensionContext): Promise<boolean> {
	if (await runtime.updateHealth(ctx)) return true;
	if (!runtime.config.autoStart || runtime.state.proxyStartAttempted) return false;

	runtime.state.proxyStartAttempted = true;
	runtime.state.proxyStarting = true;
	runtime.refreshStatus(ctx);
	const started = await startPersistentHeadroomProxy(runtime.config);
	if (!started.ok) {
		runtime.state.stats.lastError = started.reason;
		runtime.state.proxyStarting = false;
		runtime.state.proxyOnline = false;
		runtime.refreshStatus(ctx);
		return false;
	}

	const online = await waitForProxyHealth(runtime);
	runtime.state.proxyStarting = false;
	runtime.state.proxyOnline = online;
	runtime.refreshStatus(ctx);
	return online;
}

async function ensureProxyInBackground(runtime: HeadroomRuntime, ctx?: ExtensionContext): Promise<void> {
	try {
		if (await updateHealthState(runtime)) {
			safeRefreshStatus(runtime, ctx);
			return;
		}
		if (!runtime.config.autoStart || runtime.state.proxyStartAttempted) {
			safeRefreshStatus(runtime, ctx);
			return;
		}
		runtime.state.proxyStartAttempted = true;
		runtime.state.proxyStarting = true;
		safeRefreshStatus(runtime, ctx);
		const started = await startPersistentHeadroomProxy(runtime.config);
		if (!started.ok) {
			runtime.state.stats.lastError = started.reason;
			runtime.state.proxyStarting = false;
			runtime.state.proxyOnline = false;
			safeRefreshStatus(runtime, ctx);
			return;
		}
		runtime.state.proxyOnline = await waitForProxyHealth(runtime);
		runtime.state.proxyStarting = false;
		safeRefreshStatus(runtime, ctx);
	} catch (error) {
		runtime.state.proxyStarting = false;
		runtime.state.proxyOnline = false;
		runtime.state.stats.lastError = error instanceof Error ? error.message : String(error);
		safeRefreshStatus(runtime, ctx);
	}
}

function safeRefreshStatus(runtime: HeadroomRuntime, ctx: ExtensionContext | undefined): void {
	if (!ctx) return;
	try {
		runtime.refreshStatus(ctx);
	} catch {
		// The session may have been replaced while background health was in flight.
	}
}

async function waitForProxyHealth(runtime: HeadroomRuntime, signal?: AbortSignal): Promise<boolean> {
	for (const delay of [300, 500, 800, 1200, 2000]) {
		await sleep(delay);
		if (await updateHealthState(runtime, signal)) return true;
	}
	return false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleContextCompression(
	runtime: HeadroomRuntime,
	event: ContextEvent,
	ctx: ExtensionContext,
): Promise<{ messages?: AgentMessage[] } | undefined> {
	if (shouldSkipBeforePayload(runtime, ctx)) return undefined;
	const payload = buildCompressionPayload(event.messages, runtime.config.minMessageChars);
	if (payload.candidateCount === 0) return undefined;
	if (runtime.state.proxyOnline !== true) {
		void ensureProxyInBackground(runtime, ctx);
		return undefined;
	}

	runtime.state.stats.attempts++;
	try {
		const result = await runtime.client.compress(payload.messages, ctx.model?.id);
		runtime.state.proxyOnline = true;
		if (!result.compressed || result.tokensSaved <= 0) {
			runtime.refreshStatus(ctx);
			return undefined;
		}

		const applied = applyCompressionResult(event.messages, payload.mappings, result.messages, {
			minMessageChars: runtime.config.minMessageChars,
		});
		if (!applied.ok) {
			recordGuardSkip(runtime.state.stats, applied.reason);
			runtime.refreshStatus(ctx);
			return undefined;
		}

		recordAppliedCompression(runtime.state.stats, result, applied.appliedMessages);
		runtime.refreshStatus(ctx);
		return { messages: applied.messages };
	} catch (error) {
		recordCompressionError(runtime, ctx, error);
		return undefined;
	}
}

function shouldSkipBeforePayload(runtime: HeadroomRuntime, ctx: ExtensionContext): boolean {
	if (!runtime.state.enabled) return true;
	if (isRemoteBlocked(runtime.config)) {
		if (!runtime.state.remoteWarningShown) {
			runtime.state.remoteWarningShown = true;
			notify(ctx, "Headroom compression skipped because remote proxy is blocked.", "warning");
		}
		runtime.refreshStatus(ctx);
		return true;
	}
	const usage = ctx.getContextUsage();
	return usage?.tokens !== null && usage?.tokens !== undefined && usage.tokens < runtime.config.minContextTokens;
}

function recordGuardSkip(stats: HeadroomStats, reason: string): void {
	stats.guardSkips++;
	stats.lastSkipReason = reason;
}

function recordAppliedCompression(stats: HeadroomStats, result: CompressResult, appliedMessages: number): void {
	stats.applied++;
	stats.tokensSaved += result.tokensSaved;
	stats.lastError = undefined;
	stats.lastSkipReason = undefined;
	stats.last = { ...result, appliedMessages };
}

function recordCompressionError(runtime: HeadroomRuntime, ctx: ExtensionContext, error: unknown): void {
	runtime.state.stats.lastError = getErrorMessage(error);
	if (isAbortOrTimeoutError(error)) {
		runtime.refreshStatus(ctx);
		return;
	}

	runtime.state.proxyOnline = false;
	if (!runtime.state.offlineWarningShown) {
		runtime.state.offlineWarningShown = true;
		notify(
			ctx,
			`Headroom proxy unavailable. Compression disabled until /headroom health succeeds.\n${runtime.state.stats.lastError}`,
			"warning",
		);
	}
	runtime.refreshStatus(ctx);
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isAbortOrTimeoutError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const candidate = error as { cause?: unknown; message?: unknown; name?: unknown };
	if (candidate.name === "TimeoutError" || candidate.name === "AbortError") return true;
	if (typeof candidate.message === "string" && /aborted due to timeout|operation was aborted/i.test(candidate.message)) return true;
	return candidate.cause !== undefined && candidate.cause !== error && isAbortOrTimeoutError(candidate.cause);
}

async function showProxyStats(ctx: ExtensionContext, client: HeadroomHttpClient, config: HeadroomConfig): Promise<void> {
	if (isRemoteBlocked(config)) {
		notify(ctx, `Headroom proxy stats blocked for remote URL: ${config.baseUrl}`, "warning");
		return;
	}
	try {
		const stats = await client.stats();
		notify(ctx, `Headroom proxy stats:\n${JSON.stringify(stats, null, 2)}`, "info");
	} catch (error) {
		notify(ctx, `Headroom proxy stats unavailable: ${getErrorMessage(error)}`, "warning");
	}
}

async function handleCommand(
	runtime: HeadroomRuntime,
	parsed: ParsedCommand,
	ctx: ExtensionContext,
	initPaths?: HeadroomInitPaths,
): Promise<void> {
	if (parsed.command === "invalid") {
		notify(ctx, HEADROOM_USAGE, "warning");
		return;
	}
	if (parsed.command === "config") {
		await showConfigDialog(runtime, ctx, initPaths);
		return;
	}
	if (parsed.command === "init") {
		await handleInitCommand(ctx, parsed.initTarget, initPaths);
		return;
	}
	if (parsed.command === "on") {
		runtime.state.sessionEnabledOverride = true;
		runtime.state.enabled = true;
		runtime.state.offlineWarningShown = false;
		runtime.state.proxyStartAttempted = false;
		const healthy = await runtime.ensureProxy(ctx);
		notify(ctx, healthy ? "Headroom compression enabled. Proxy will keep running after Pi exits." : proxyStartHint(runtime.config), healthy ? "info" : "warning");
		return;
	}
	if (parsed.command === "off") {
		runtime.state.sessionEnabledOverride = false;
		runtime.state.enabled = false;
		runtime.refreshStatus(ctx);
		notify(ctx, "Headroom compression disabled for this Pi session. The proxy process is left running.", "info");
		return;
	}
	if (parsed.command === "health") {
		runtime.state.proxyStartAttempted = false;
		const healthy = await runtime.ensureProxy(ctx);
		notify(ctx, healthy ? `Headroom proxy online: ${runtime.config.baseUrl}` : proxyStartHint(runtime.config), healthy ? "info" : "warning");
		return;
	}
	if (parsed.command === "stats") {
		await showProxyStats(ctx, runtime.client, runtime.config);
		return;
	}
	notify(ctx, renderStatus(runtime.config, runtime.state, runtime.configPath), "info");
}

async function handleInitCommand(ctx: ExtensionContext, target: HeadroomInitTarget | undefined, initPaths?: HeadroomInitPaths): Promise<void> {
	if (!target) {
		notify(ctx, HEADROOM_USAGE, "warning");
		return;
	}
	const files = buildHeadroomInitFiles(target, ctx.ui.theme, initPaths);
	const result = await writeHeadroomInitFiles(files, async (file) => ctx.ui.confirm("Overwrite Headroom file?", `${file.path} already exists. Overwrite it?`));
	notify(
		ctx,
		[
			"Headroom initialization complete.",
			formatInitSummary("Created", result.created),
			formatInitSummary("Overwritten", result.overwritten),
			formatInitSummary("Skipped", result.skipped),
		].join("\n"),
		"info",
	);
	if (result.skipped.length > 0 || result.failed.length > 0) {
		const issues = [
			result.skipped.length > 0 ? formatInitSummary("Skipped", result.skipped) : "",
			result.failed.length > 0 ? [`Failed (${result.failed.length}):`, ...result.failed.map((failure) => `  ${failure.path}: ${failure.message}`)].join("\n") : "",
		].filter(Boolean);
		notify(ctx, `Headroom initialization issues.\n${issues.join("\n")}`, result.failed.length > 0 ? "error" : "warning");
	}
}

function formatInitSummary(label: string, files: readonly string[]): string {
	return files.length > 0 ? `${label} (${files.length}):\n${files.map((file) => `  ${file}`).join("\n")}` : `${label}: none`;
}

function publishDisplay(runtime: HeadroomRuntime, ctx: ExtensionContext): void {
	if (!runtime.publisher) return;
	if (!runtime.config.display.visible) {
		runtime.publisher.publish(null);
		return;
	}
	const state = widgetState(
		runtime.state.enabled,
		isRemoteBlocked(runtime.config),
		runtime.state.proxyStarting,
		runtime.state.proxyOnline,
		Boolean(runtime.state.stats.last),
	);
	const fallback = resolveThemeGlyph(ctx.ui.theme, state) || DEFAULT_GLYPHS[state];
	try {
		const values = {
			label: "Headroom",
			compressionPercent: runtime.state.stats.last ? Math.round((1 - runtime.state.stats.last.compressionRatio) * 100) : 0,
			tokensSaved: runtime.state.stats.last?.tokensSaved ?? 0,
			tokensBefore: runtime.state.stats.last?.tokensBefore ?? 0,
			tokensAfter: runtime.state.stats.last?.tokensAfter ?? 0,
			proxyStatus:
				runtime.state.proxyOnline === true
					? "online"
					: runtime.state.proxyStarting
						? "starting"
						: runtime.state.proxyOnline === false
							? "offline"
							: "unknown",
			error: runtime.state.stats.lastError ?? "",
		};
		const asset = loadGlyphAsset(state, runtime.config.display, fallback);
		runtime.publisher.publish(renderDisplayFrames(state, values, runtime.config.display, fallback, asset));
	} catch {
		// Keep Headroom visible with a safe one-row source when a custom asset fails.
		runtime.publisher.publish({ frames: [[fallback]] });
	}
}

function renderStatus(config: HeadroomConfig, state: HeadroomRuntimeState, configPath: string): string {
	const stats = state.stats;
	const lines = [
		"Headroom token compression",
		`  Enabled: ${state.enabled ? "yes" : "no"}`,
		`  Persisted enabled: ${config.enabled ? "yes" : "no"}`,
		`  Display: ${config.display.visible ? "shown" : "hidden"}`,
		`  Proxy:   ${config.baseUrl} (${state.proxyOnline === true ? "online" : state.proxyStarting ? "starting" : state.proxyOnline === false ? "not running" : "unknown"})`,
		`  Auto-start: ${config.autoStart ? `yes (${config.command})` : "no"}`,
		"  Shutdown: proxy is left running after Pi exits",
		`  Remote:  ${isRemoteBlocked(config) ? "blocked" : config.allowRemote ? "allowed" : "local-only"}`,
		`  Thresholds: context >= ${config.minContextTokens.toLocaleString()} tokens, toolResult >= ${config.minMessageChars.toLocaleString()} chars`,
		`  Config: ${configPath}`,
		"",
		"Session stats:",
		`  Attempts:     ${stats.attempts}`,
		`  Applied:      ${stats.applied}`,
		`  Guard skips:  ${stats.guardSkips}`,
		`  Tokens saved: ${stats.tokensSaved.toLocaleString()}`,
	];
	if (stats.last) {
		const pct = Math.round((1 - stats.last.compressionRatio) * 100);
		lines.push(
			"",
			"Last applied compression:",
			`  ${stats.last.tokensBefore.toLocaleString()} → ${stats.last.tokensAfter.toLocaleString()} tokens (-${pct}%)`,
			`  Applied messages: ${stats.last.appliedMessages}`,
			`  Transforms: ${stats.last.transformsApplied.join(", ") || "none"}`,
			`  CCR hashes: ${stats.last.ccrHashes.length}`,
		);
	}
	if (stats.lastSkipReason) lines.push("", `Last guard skip: ${stats.lastSkipReason}`);
	if (stats.lastError) lines.push("", `Last error: ${stats.lastError}`);
	return lines.join("\n");
}

function proxyStartHint(config: HeadroomConfig): string {
	if (isRemoteBlocked(config)) return renderRemoteBlocked(config);
	if (!config.autoStart) {
		return [
			`Headroom proxy is not running: ${config.baseUrl}`,
			"Auto-start is disabled. Start it manually:",
			`  HEADROOM_TELEMETRY=off ${renderManualProxyCommand(config)}`,
		].join("\n");
	}
	return [
		`Headroom proxy is not running: ${config.baseUrl}`,
		`Tried to start persistent proxy with command: ${config.command}`,
		"Install Headroom or set PI_HEADROOM_COMMAND if needed:",
		'  pip install "headroom-ai[proxy]"',
		"  # then run /headroom on",
	].join("\n");
}

function renderManualProxyCommand(config: HeadroomConfig): string {
	try {
		const url = new URL(config.baseUrl);
		const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname.replace(/^\[(.*)]$/, "$1");
		const port = url.port || "8788";
		return `${config.command} proxy --host ${host} --port ${port} --mode token --no-cache`;
	} catch {
		return `${config.command} proxy --mode token --no-cache`;
	}
}

function renderRemoteBlocked(config: HeadroomConfig): string {
	return [
		`Headroom remote URL is blocked: ${config.baseUrl}`,
		"Compression sends conversation context to the proxy.",
		"Set PI_HEADROOM_ALLOW_REMOTE=1 only for a trusted proxy.",
	].join("\n");
}

function parseCommand(args: string): ParsedCommand {
	const tokens = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return { command: "config" };
	const command = tokens[0];
	if (!SUBCOMMANDS.includes(command as Subcommand)) return { command: "invalid" };
	if (command !== "init") return tokens.length === 1 ? { command: command as Subcommand } : { command: "invalid" };
	if (tokens.length === 1) return { command: "init", initTarget: "all" };
	return tokens.length === 2 && INIT_TARGETS.includes(tokens[1] as HeadroomInitTarget)
		? { command: "init", initTarget: tokens[1] as HeadroomInitTarget }
		: { command: "invalid" };
}

function emptyStats(): HeadroomStats {
	return { attempts: 0, applied: 0, guardSkips: 0, tokensSaved: 0 };
}

function notify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error"): void {
	ctx.ui.notify(message, type);
}

async function showConfigDialog(runtime: HeadroomRuntime, ctx: ExtensionContext, initPaths?: HeadroomInitPaths): Promise<void> {
	if (!ctx.hasUI || typeof ctx.ui.custom !== "function") {
		notify(ctx, renderStatus(runtime.config, runtime.state, runtime.configPath), "info");
		return;
	}
	const persisted = loadHeadroomConfig({ env: {}, configPath: runtime.configPath });
	const result = await ctx.ui.custom<DialogResult>(
		(_tui, _theme, _keybindings, done) => new HeadroomConfigDialog(persisted, ctx, runtime.configPath, initPaths, done),
		{ overlay: true },
	);
	if (result?.action !== "apply") return;
	await applyConfig(runtime, ctx, result.config);
}

async function applyConfig(runtime: HeadroomRuntime, ctx: ExtensionContext, draft: HeadroomConfig): Promise<void> {
	const before = loadHeadroomConfig({ env: {}, configPath: runtime.configPath });
	try {
		writeHeadroomConfig(draft, runtime.configPath);
	} catch (error) {
		notify(ctx, `Failed to save Headroom config: ${error instanceof Error ? error.message : String(error)}`, "error");
		return;
	}
	const next = loadHeadroomConfig({ env: runtime.env, configPath: runtime.configPath });
	if (before.enabled !== draft.enabled) runtime.state.sessionEnabledOverride = undefined;
	runtime.config = next;
	runtime.state.enabled = runtime.state.sessionEnabledOverride ?? next.enabled;
	if (before.baseUrl !== next.baseUrl || before.timeoutMs !== next.timeoutMs) {
		runtime.client = new HeadroomHttpClient({ baseUrl: next.baseUrl, timeoutMs: next.timeoutMs });
		runtime.state.proxyOnline = null;
		runtime.state.proxyStarting = false;
		runtime.state.proxyStartAttempted = false;
	}
	runtime.refreshStatus(ctx);
	notify(ctx, "Headroom configuration applied.", "info");
}

class HeadroomConfigDialog implements Component {
	private draft: HeadroomConfig;
	private list: SettingsList;
	private error = "";

	constructor(
		config: HeadroomConfig,
		private readonly ctx: ExtensionContext,
		private readonly configPath: string,
		private readonly initPaths: HeadroomInitPaths | undefined,
		private readonly done: (result: DialogResult) => void,
	) {
		this.draft = cloneConfig(config);
		this.list = this.buildList();
	}

	render(width: number): readonly string[] {
		const rows = [...this.list.render(width)];
		if (this.error) rows.push(...new Text(this.error, 0, 0).render(width));
		return rows;
	}

	handleInput(data: string): void {
		const selected = this.list.getSelectedItem();
		if ((data === "\n" || data === "\r") && selected?.id.startsWith("action:")) {
			void this.handleAction(selected.id.slice(7));
			return;
		}
		this.list.handleInput(data);
	}

	private buildList(): SettingsList {
		const items: SettingItem[] = [
			{ id: "section:config", label: "Config", currentValue: "", heading: true },
			this.booleanItem("enabled", "Enabled", this.draft.enabled, "Default compression state for new sessions; /headroom on/off override only this session. PI_HEADROOM_*/HEADROOM_* may override saved operational values at runtime."),
			this.stringItem("baseUrl", "Base URL", this.draft.baseUrl, "HTTP(S) Headroom proxy URL. Non-local hosts are blocked unless Allow remote is true; compression sends conversation context to this endpoint."),
			this.booleanItem("allowRemote", "Allow remote", this.draft.allowRemote, "Allow non-local proxy hosts. Enable only for an endpoint trusted with full conversation context; localhost, 127.0.0.1, and ::1 never need it."),
			this.booleanItem("autoStart", "Auto-start", this.draft.autoStart, "After a failed health check, start a detached local proxy with Command. Remote URLs are never auto-started; the proxy remains running after OMP exits."),
			this.stringItem("command", "Command", this.draft.command, "Executable used only to auto-start the proxy. It must be available to OMP; disable Auto-start if you run the proxy yourself."),
			this.numberItem("minContextTokens", "Minimum context tokens", this.draft.minContextTokens, "Minimum known context-token count before compression is attempted. Equality qualifies; 0 disables this threshold."),
			this.numberItem("minMessageChars", "Minimum message chars", this.draft.minMessageChars, "Minimum extracted character count for each toolResult compression candidate. Equality qualifies; enter an integer of at least 1."),
			this.numberItem("timeoutMs", "Timeout (ms)", this.draft.timeoutMs, "Timeout in milliseconds for proxy health, stats, and compression requests. Minimum 100; timeout keeps the original conversation unchanged."),
			{ id: "section:display", label: "Display", currentValue: "", heading: true },
			this.booleanItem("display.visible", "Visible", this.draft.display.visible, "Publish Headroom status to Shared Display. Hiding it does not disable compression, proxy checks, or commands."),
			this.stringItem("display.glyphDirectory", "Glyph directory", this.draft.display.glyphDirectory, "Path for off.txt, remote-blocked.txt, starting.txt, offline.txt, idle.txt, online.txt, compressed.txt. Optional positive fps=N; whitespace frames or blank-line blocks. Invalid/missing files use theme glyphs; ~ means home."),
			this.stringItem("display.template", "Outer template", this.draft.display.template, "Single-line wrapper around the active state template. Tokens: {status}, {glyph}, {state}, {label}, {compressionPercent}, {tokensSaved}, {tokensBefore}, {tokensAfter}, {proxyStatus}, {error}."),
			...(Object.keys(this.draft.display.status) as DisplayState[]).map((state) => this.stringItem(`display.status.${state}`, state, this.draft.display.status[state], `${HEADROOM_STATUS_PURPOSES[state]} Must be one line; supports the Outer template tokens except {status}.`)),
			{ id: "section:actions", label: "Actions", currentValue: "", heading: true },
			{ id: "action:show-config", label: "Show config path", currentValue: this.configPath, description: "Show the destination config.json path; does not change the draft." },
			{ id: "action:show-glyphs", label: "Show glyph path", currentValue: this.draft.display.glyphDirectory, description: "Show the draft Glyph directory; it may differ from the live path until Apply." },
			{ id: "action:initialize-glyphs", label: "Initialize missing glyphs", currentValue: "Enter", description: "Create or overwrite the seven state files named above from current theme glyphs; each existing file requires confirmation. Files remain after Cancel." },
			{ id: "action:reload", label: "Reload from disk", currentValue: "Enter", description: "Discard draft edits and reload persisted config.json without environment overrides; live settings stay unchanged until Apply." },
			{ id: "action:apply", label: "Apply changes", currentValue: "Enter", description: "Validate every field, atomically save config.json, and activate the effective runtime settings." },
			{ id: "action:cancel", label: "Cancel", currentValue: "Enter", description: "Close without saving draft edits or changing live settings; initialized asset files remain on disk." },
		];
		return new SettingsList(items, Math.min(16, items.length), getSettingsListTheme(), (id, value) => this.onChange(id, value), () => this.done({ action: "cancel" }), { layout: "flat", typeToSearch: false, hint: "Enter edit/action · Esc cancel" });
	}

	private booleanItem(id: string, label: string, value: boolean, description: string): SettingItem {
		return { id, label, currentValue: value ? "true" : "false", values: ["true", "false"], description };
	}

	private stringItem(id: string, label: string, value: string, description: string): SettingItem {
		return { id, label, currentValue: value, submenu: (current, done) => this.inputSubmenu(current, done), description };
	}

	private numberItem(id: string, label: string, value: number, description: string): SettingItem {
		return this.stringItem(id, label, String(value), description);
	}

	private inputSubmenu(current: string, done: (selected?: string) => void): Input {
		const input = new Input();
		input.setValue(current);
		input.onSubmit = (value) => done(value);
		input.onEscape = () => done(undefined);
		return input;
	}

	private onChange(id: string, value: string): void {
		if (id === "enabled" || id === "allowRemote" || id === "autoStart") {
			(this.draft as unknown as Record<string, unknown>)[id] = value === "true";
			return;
		}
		if (id === "baseUrl" || id === "command") {
			(this.draft as unknown as Record<string, unknown>)[id] = value;
			return;
		}
		if (id === "minContextTokens" || id === "minMessageChars" || id === "timeoutMs") {
			(this.draft as unknown as Record<string, unknown>)[id] = Number(value);
			return;
		}
		if (id === "display.visible") {
			this.draft.display.visible = value === "true";
			return;
		}
		if (id === "display.glyphDirectory") this.draft.display.glyphDirectory = value;
		else if (id === "display.template") this.draft.display.template = value;
		else if (id.startsWith("display.status.")) this.draft.display.status[id.slice(15) as DisplayState] = value;
	}

	private async handleAction(action: string): Promise<void> {
		switch (action) {
			case "show-config":
				this.ctx.ui.notify(`Headroom config: ${this.configPath}`, "info");
				return;
			case "show-glyphs":
				this.ctx.ui.notify(`Headroom glyphs: ${this.draft.display.glyphDirectory}`, "info");
				return;
			case "initialize-glyphs": {
				const files = buildHeadroomInitFiles("glyphs", this.ctx.ui.theme, this.initPaths ?? { glyphs: this.draft.display.glyphDirectory });
				await writeHeadroomInitFiles(files, async (file) => this.ctx.ui.confirm("Overwrite Headroom glyph?", `${file.path} already exists. Overwrite it?`));
				return;
			}
			case "reload":
				this.draft = loadHeadroomConfig({ env: {}, configPath: this.configPath });
				this.list = this.buildList();
				return;
			case "apply": {
				const error = validateDraft(this.draft);
				if (error) {
					this.error = error;
					return;
				}
				this.done({ action: "apply", config: cloneConfig(this.draft) });
				return;
			}
			case "cancel":
				this.done({ action: "cancel" });
				return;
		}
	}
}

function validateDraft(config: HeadroomConfig): string | undefined {
	if (typeof config.enabled !== "boolean" || typeof config.allowRemote !== "boolean" || typeof config.autoStart !== "boolean") return "Boolean settings must be true or false.";
	try {
		const url = new URL(config.baseUrl);
		if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return "Base URL must be an HTTP(S) URL with a hostname.";
	} catch {
		return "Base URL must be an HTTP(S) URL with a hostname.";
	}
	if (!config.command.trim()) return "Command must not be empty.";
	if (!Number.isSafeInteger(config.minContextTokens) || config.minContextTokens < 0) return "Minimum context tokens must be a non-negative integer.";
	if (!Number.isSafeInteger(config.minMessageChars) || config.minMessageChars < 1) return "Minimum message chars must be an integer of at least 1.";
	if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 100) return "Timeout must be an integer of at least 100 ms.";
	if (typeof config.display.glyphDirectory !== "string" || !config.display.glyphDirectory.trim()) return "Glyph directory must not be empty.";
	if (typeof config.display.template !== "string" || /[\r\n]/.test(config.display.template)) return "Display template must be a single line.";
	for (const state of Object.keys(config.display.status) as DisplayState[]) {
		if (typeof config.display.status[state] !== "string" || /[\r\n]/.test(config.display.status[state])) return `${state} template must be a single line.`;
	}
	return undefined;
}

function cloneConfig(config: HeadroomConfig): HeadroomConfig {
	return normalizeHeadroomConfig({
		...config,
		display: {
			...config.display,
			status: { ...config.display.status },
		},
	});
}

export const __test__ = {
	isAbortOrTimeoutError,
	parseCommand,
	validateDraft,
};
