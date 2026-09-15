import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
	Text,
	matchesKey,
	type Component,
} from "@oh-my-pi/pi-tui";
import {
	CODESOOK_OMP_CONFIG_CHANGED,
	isRecord as isConfigRecord,
} from "@codesook/omp-shared-display/config-store";
import {
	connectSharedDisplay,
	type SharedDisplayPublisher,
} from "@codesook/omp-shared-display/client";
import { applyCompressionResult, buildCompressionPayload } from "./bridge.ts";
import { HeadroomHttpClient, loadHeadroomProxyToken } from "./client.ts";
import {
	HEADROOM_CONFIG_FILE,
	isHeadroomRootConfigPath,
	isRemoteBlocked,
	loadHeadroomConfig,
	normalizeHeadroomConfig,
	type HeadroomConfig,
	type HeadroomConfigLoadOptions,
} from "./config.ts";
import {
	DEFAULT_GLYPHS,
	loadGlyphAsset,
	renderDisplayFrames,
	resolveThemeGlyph,
	widgetState,
} from "./display.ts";
import {
	buildHeadroomInitFiles,
	writeHeadroomInitFiles,
	type HeadroomInitPaths,
	type HeadroomInitTarget,
} from "./init.ts";
import type { AgentMessage, CompressResult, HeadroomStats } from "./types.ts";

const SUBCOMMANDS = ["status", "on", "off", "health", "stats", "init"] as const;
const INIT_TARGETS = ["config", "glyphs", "all"] as const;
const HEADROOM_USAGE = "Usage: /headroom [status|on|off|health|stats|init [config|glyphs|all]]";

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
	healthGeneration: number;
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
	legacyConfigPath?: string;
	legacySettingsPaths?: readonly string[];
	legacyDisplayPath?: string;
}
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
	const events = (pi as unknown as { events?: unknown }).events;
	if (isHeadroomRootConfigPath(configPath) && isEventBus(events)) {
		events.on(CODESOOK_OMP_CONFIG_CHANGED, data => {
			const next = loadEventConfig(data, runtime);
			if (!next) return;
			applyLiveConfig(runtime, next, activeContext);
		});
	}

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

function createClient(config: HeadroomConfig): HeadroomHttpClient {
	return new HeadroomHttpClient({
		baseUrl: config.baseUrl,
		timeoutMs: config.timeoutMs,
		proxyToken: loadHeadroomProxyToken(config.proxyTokenFile),
	});
}

function createRuntime(options: HeadroomConfigLoadOptions & { glyphDirectory?: string }): HeadroomRuntime {
	const config = loadRuntimeConfig(options);
	const client = createClient(config);
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
		healthGeneration: 0,
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
	runtime.healthGeneration++;
	const previousConfig = runtime.config;
	const nextConfig = loadRuntimeConfig({
		...options,
		configPath: runtime.configPath,
		env: runtime.env,
	});
	runtime.config = nextConfig;
	runtime.glyphDirectoryOverride = options.glyphDirectory;
	if (
		previousConfig.baseUrl !== nextConfig.baseUrl ||
		previousConfig.timeoutMs !== nextConfig.timeoutMs ||
		previousConfig.proxyTokenFile !== nextConfig.proxyTokenFile
	) {
		runtime.client = createClient(nextConfig);
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
	if (runtime.state.enabled) void checkHealthInBackground(runtime, ctx);
}

function loadRuntimeConfig(options: HeadroomConfigLoadOptions & { glyphDirectory?: string }): HeadroomConfig {
	const config = loadHeadroomConfig({
		env: options.env ?? process.env,
		configPath: options.configPath ?? HEADROOM_CONFIG_FILE,
		legacyConfigPath: options.legacyConfigPath,
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

function loadEventConfig(data: unknown, runtime: HeadroomRuntime): HeadroomConfig | undefined {
	if (!isConfigRecord(data) || !isConfigRecord(data.config)) return undefined;
	const root = data.config;
	if (root.version !== 1 || !isConfigRecord(root.display) || !isConfigRecord(root.behavior)) return undefined;
	const normalized = loadHeadroomConfig(runtime.env, normalizeHeadroomConfig(root));
	if (!runtime.glyphDirectoryOverride) return normalized;
	return {
		...normalized,
		display: { ...normalized.display, glyphDirectory: runtime.glyphDirectoryOverride },
	};
}

function applyLiveConfig(runtime: HeadroomRuntime, next: HeadroomConfig, ctx: ExtensionContext | undefined): void {
	const previous = runtime.config;
	const wasEnabled = runtime.state.enabled;
	const wasBlocked = isRemoteBlocked(previous);
	runtime.healthGeneration++;
	const clientChanged =
		previous.baseUrl !== next.baseUrl ||
		previous.timeoutMs !== next.timeoutMs ||
		previous.proxyTokenFile !== next.proxyTokenFile;
	runtime.config = next;
	if (clientChanged) {
		runtime.client = createClient(next);
		runtime.state.proxyOnline = null;
		runtime.state.proxyStarting = false;
		runtime.state.proxyStartAttempted = false;
	}
	runtime.state.enabled = runtime.state.sessionEnabledOverride ?? next.enabled;
	runtime.state.remoteWarningShown = false;
	runtime.state.offlineWarningShown = false;
	if (ctx) {
		runtime.refreshStatus(ctx);
		const shouldCheckHealth =
			runtime.state.enabled &&
			!isRemoteBlocked(next) &&
			(clientChanged || !wasEnabled || wasBlocked || runtime.state.proxyOnline === null);
		if (shouldCheckHealth) void checkHealthInBackground(runtime, ctx);
	}
}

async function updateHealthState(
	runtime: HeadroomRuntime,
	signal?: AbortSignal,
	generation = runtime.healthGeneration,
	client = runtime.client,
): Promise<boolean> {
	if (isRemoteBlocked(runtime.config)) return false;
	const online = await client.health(signal);
	if (generation !== runtime.healthGeneration || client !== runtime.client) return runtime.state.proxyOnline === true;
	runtime.state.proxyOnline = online;
	return online;
}

async function checkHealthInBackground(runtime: HeadroomRuntime, ctx: ExtensionContext): Promise<void> {
	const generation = runtime.healthGeneration;
	const client = runtime.client;
	try {
		await updateHealthState(runtime, undefined, generation, client);
	} catch {
		if (generation === runtime.healthGeneration && client === runtime.client) runtime.state.proxyOnline = false;
	}
	if (generation === runtime.healthGeneration && client === runtime.client) runtime.refreshStatus(ctx);
}

async function ensureProxy(runtime: HeadroomRuntime, ctx: ExtensionContext): Promise<boolean> {
	const healthy = await runtime.updateHealth(ctx);
	runtime.state.proxyStarting = false;
	runtime.state.proxyStartAttempted = false;
	runtime.refreshStatus(ctx);
	return healthy;
}

async function handleContextCompression(
	runtime: HeadroomRuntime,
	event: ContextEvent,
	ctx: ExtensionContext,
): Promise<{ messages?: AgentMessage[] } | undefined> {
	if (shouldSkipBeforePayload(runtime, ctx)) return undefined;
	const config = runtime.config;
	const client = runtime.client;
	const payload = buildCompressionPayload(event.messages, config.minMessageChars);
	if (payload.candidateCount === 0 || runtime.state.proxyOnline !== true) return undefined;

	runtime.state.stats.attempts++;
	try {
		const result = await client.compress(payload.messages, ctx.model?.id);
		runtime.state.proxyOnline = true;
		if (!result.compressed || result.tokensSaved <= 0) {
			runtime.refreshStatus(ctx);
			return undefined;
		}

		const applied = applyCompressionResult(event.messages, payload.mappings, result.messages, {
			minMessageChars: config.minMessageChars,
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

async function showReadOnlyOverlay(
	ctx: ExtensionContext,
	title: string,
	load: () => string | Promise<string>,
): Promise<void> {
	if (!ctx.hasUI || typeof ctx.ui.custom !== "function") {
		try {
			notify(ctx, await load(), "info");
		} catch (error) {
			notify(ctx, `Headroom ${title.toLowerCase()} unavailable: ${getErrorMessage(error)}`, "warning");
		}
		return;
	}

	await ctx.ui.custom<void>((tui, _theme, _keybindings, done) => {
		let state: "loading" | "ready" | "error" = "loading";
		let content = "Loading…";
		let closed = false;
		const refresh = (): void => {
			if (!closed) tui.requestRender();
		};
		const component: Component = {
			render(width: number): readonly string[] {
				const body = state === "error" ? `Error: ${content}` : content;
				return [title, ...new Text(body, 1, 0).render(width), "Enter/Esc close"];
			},
			handleInput(data: string): void {
				if (
					matchesKey(data, "enter") ||
					matchesKey(data, "return") ||
					matchesKey(data, "escape") ||
					matchesKey(data, "esc") ||
					data === "\r" ||
					data === "\n" ||
					data === "\x1b"
				) {
					closed = true;
					done(undefined);
				}
			},
		};
		void Promise.resolve()
			.then(load)
			.then(
				value => {
					if (closed) return;
					state = "ready";
					content = value;
					refresh();
				},
				error => {
					if (closed) return;
					state = "error";
					content = getErrorMessage(error);
					refresh();
				},
			);
		return component;
	}, { overlay: true });
}

async function showProxyStats(ctx: ExtensionContext, client: HeadroomHttpClient, config: HeadroomConfig): Promise<void> {
	await showReadOnlyOverlay(ctx, "Headroom proxy stats", async () => {
		if (isRemoteBlocked(config)) throw new Error(`stats blocked for remote URL: ${config.baseUrl}`);
		return `Headroom proxy stats:\n${JSON.stringify(await client.stats(), null, 2)}`;
	});
}

async function showProxyHealth(runtime: HeadroomRuntime, ctx: ExtensionContext): Promise<void> {
	await showReadOnlyOverlay(ctx, "Headroom proxy health", async () => {
		const healthy = await runtime.ensureProxy(ctx);
		return healthy ? `Headroom proxy online: ${runtime.config.baseUrl}` : proxyStartHint(runtime.config);
	});
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
	if (parsed.command === "init") {
		await handleInitCommand(ctx, parsed.initTarget, initPaths);
		return;
	}
	if (parsed.command === "on") {
		runtime.state.sessionEnabledOverride = true;
		runtime.state.enabled = true;
		runtime.state.offlineWarningShown = false;
		const healthy = await runtime.ensureProxy(ctx);
		notify(ctx, healthy ? "Headroom compression enabled. Start proxy separately if needed." : proxyStartHint(runtime.config), healthy ? "info" : "warning");
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
		await showProxyHealth(runtime, ctx);
		return;
	}
	if (parsed.command === "stats") {
		await showProxyStats(ctx, runtime.client, runtime.config);
		return;
	}
	await showReadOnlyOverlay(ctx, "Headroom status", () => renderStatus(runtime.config, runtime.state, runtime.configPath));
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
		"  Proxy start: manual",
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
	return [
		`Headroom proxy is not running: ${config.baseUrl}`,
		"Start it manually:",
		`  HEADROOM_TELEMETRY=off ${renderManualProxyCommand(config)}`,
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
	if (tokens.length === 0) return { command: "status" };
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


export const __test__ = {
	isAbortOrTimeoutError,
	parseCommand,
};
