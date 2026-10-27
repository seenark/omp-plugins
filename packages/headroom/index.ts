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
import { applyCompressionResult, buildCompressionPayload, estimateTokens, findUsageAnchor, replaceToolResultTexts } from "./bridge.ts";
import { HeadroomHttpClient, HeadroomHttpError, loadHeadroomProxyToken, writeHeadroomProxyToken } from "./client.ts";
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
	formatCompact,
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
import type { AgentMessage, CompressionPayload, CompressResult, HeadroomStats } from "./types.ts";

const SUBCOMMANDS = ["status", "on", "off", "health", "stats", "token", "init"] as const;
const INIT_TARGETS = ["config", "glyphs", "all"] as const;
const HEADROOM_USAGE = "Usage: /headroom [status|on|off|health|stats|token|init [config|glyphs|all]]";
const HEADROOM_MENU = [
	{ command: "status", label: "Show status", description: "Open compression and proxy status; no plugin settings changes." },
	{ command: "on", label: "Enable compression", description: "Enable compression this session and check the external proxy." },
	{ command: "off", label: "Disable compression", description: "Disable compression this session; leave the proxy running." },
	{ command: "health", label: "Check proxy health", description: "Check proxy reachability now and open the health result." },
	{ command: "stats", label: "Show proxy statistics", description: "Fetch proxy statistics now and open a read-only result." },
	{ command: "token", label: "Set proxy token", description: "Open visible input; saving replaces the token and checks proxy health." },
	{ command: "init", label: "Choose files to initialize", description: "Choose files next; ask per overwrite. Skips do not undo other writes." },
] as const;
const HEADROOM_INIT_MENU = [
	{ target: "config", label: "Initialize config", description: "Write default Headroom config; ask before overwriting the existing file." },
	{ target: "glyphs", label: "Initialize glyphs", description: "Write glyphs; ask per overwrite. Skips do not undo other writes." },
	{ target: "all", label: "Initialize config and glyphs", description: "Write config and glyphs; ask per overwrite. No rollback on skips or errors." },
] as const;

type Subcommand = (typeof SUBCOMMANDS)[number];
type ParsedCommand = { command: Subcommand | "invalid"; initTarget?: HeadroomInitTarget };

type HeadroomRuntimeState = {
	enabled: boolean;
	sessionEnabledOverride: boolean | undefined;
	proxyOnline: boolean | null;
	compressionAvailable: boolean | null;
	/** Short reason (HTTP status) while Compression Unavailable. */
	unavailableReason: string | undefined;
	/** Health retries since the last successful compression; indexes BACKOFF_MS. */
	retryAttempts: number;
	/** Epoch ms; the next `context` event re-checks health once this passes. */
	nextRetryAt: number | undefined;
	pendingHealth: Promise<void> | undefined;
	proxyStarting: boolean;
	proxyStartAttempted: boolean;
	remoteWarningShown: boolean;
	offlineWarningShown: boolean;
	/**
	 * Agent Session scope: id sent to Headroom, toolCallId -> text already forwarded compressed, and every
	 * candidate toolCallId the server has already answered for (a superset of memo keys).
	 */
	session: { id: string | undefined; memo: Map<string, string>; sent: Set<string> };
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
	let runtime: HeadroomRuntime | undefined;
	const getRuntime = (): HeadroomRuntime => {
		runtime ??= createRuntime({
			...options,
			configPath,
			warn,
			env: options.env ?? process.env,
		});
		return runtime;
	};
	const events = (pi as unknown as { events?: unknown }).events;
	if (isHeadroomRootConfigPath(configPath) && isEventBus(events)) {
		events.on(CODESOOK_OMP_CONFIG_CHANGED, data => {
			if (!runtime) return;
			const next = loadEventConfig(data, runtime);
			if (!next) return;
			applyLiveConfig(runtime, next, activeContext);
		});
	}

	const startSession = (preserveSession: boolean) => (_event: unknown, ctx: ExtensionContext): void => {
		activeContext = ctx;
		for (const message of pendingWarnings) {
			if (ctx.hasUI) ctx.ui.notify(message, "warning");
		}
		pendingWarnings.clear();
		resetSession(getRuntime(), pi, ctx, { ...options, configPath, warn, env: options.env ?? process.env }, preserveSession);
	};
	pi.on("session_start", startSession(false));
	pi.on("session_switch", startSession(false));
	pi.on("session_branch", startSession(true));
	pi.on("session_shutdown", (_event, ctx) => {
		activeContext = ctx;
		if (runtime) disposePublisher(runtime);
		activeContext = undefined;
	});
	pi.on("context", (event, ctx) => handleContextCompression(getRuntime(), event, ctx));

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
		handler: async (args, ctx) => {
			let parsed = parseCommand(args);
			if (!args.trim()) {
				if (!ctx.hasUI) {
					notify(ctx, `${HEADROOM_USAGE}\nUse status for current state, on/off for session compression, health/stats for proxy results, token for visible token input, or init config/glyphs/all to write defaults.`, "info");
					return;
				}
				const choice = await ctx.ui.select("Headroom", HEADROOM_MENU.map(({ label, description }) => ({ label, description })));
				if (choice === undefined) return;
				const selected = HEADROOM_MENU.find(option => option.label === choice);
				if (!selected) return;
				if (selected.command === "init") {
					const targetChoice = await ctx.ui.select("Headroom files to initialize", HEADROOM_INIT_MENU.map(({ label, description }) => ({ label, description })));
					const target = HEADROOM_INIT_MENU.find(option => option.label === targetChoice)?.target;
					if (!target) return;
					parsed = { command: "init", initTarget: target };
				} else {
					parsed = { command: selected.command };
				}
			}
			if (parsed.command === "invalid") {
				notify(ctx, HEADROOM_USAGE, "warning");
				return;
			}
			if (parsed.command === "init") {
				await handleInitCommand(ctx, parsed.initTarget, options.initPaths);
				return;
			}
			await handleCommand(getRuntime(), parsed.command, ctx);
		},
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
		compressionAvailable: null,
		unavailableReason: undefined,
		retryAttempts: 0,
		nextRetryAt: undefined,
		pendingHealth: undefined,
		proxyStarting: false,
		proxyStartAttempted: false,
		remoteWarningShown: false,
		offlineWarningShown: false,
		session: { id: undefined, memo: new Map(), sent: new Set() },
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
	preserveSession: boolean,
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
	runtime.state.enabled = preserveSession ? runtime.state.enabled : nextConfig.enabled;
	if (!preserveSession) {
		runtime.state.sessionEnabledOverride = undefined;
		runtime.state.session = { id: undefined, memo: new Map(), sent: new Set() };
		runtime.state.stats = emptyStats();
	}
	clearAvailability(runtime.state);
	runtime.state.pendingHealth = undefined;
	runtime.state.proxyStarting = false;
	runtime.state.proxyStartAttempted = false;
	runtime.state.remoteWarningShown = false;
	runtime.state.offlineWarningShown = false;
	const events = (pi as unknown as { events?: unknown }).events;
	runtime.publisher = connectSharedDisplay(isEventBus(events) ? events : undefined, "headroom");
	const blocked = isRemoteBlocked(runtime.config);
	// Start the health check first so the first render shows "loading", not "idle".
	if (!blocked && runtime.state.enabled) void checkHealthInBackground(runtime, ctx);
	runtime.refreshStatus(ctx);
	if (blocked) {
		notify(ctx, `Headroom remote URL is blocked by default: ${runtime.config.baseUrl}\nSet PI_HEADROOM_ALLOW_REMOTE=1 only if you trust that proxy with full context.`, "warning");
	}
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
		clearAvailability(runtime.state);
	}
	runtime.state.enabled = runtime.state.sessionEnabledOverride ?? next.enabled;
	if (!wasEnabled && runtime.state.enabled) clearAvailability(runtime.state);
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

const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000];
/** HTTP statuses that mean "misconfigured", not "busy": stop calling until health succeeds. */
const UNAVAILABLE_STATUSES = [400, 401, 404];

function clearAvailability(state: HeadroomRuntimeState): void {
	state.compressionAvailable = null;
	state.unavailableReason = undefined;
	state.retryAttempts = 0;
	state.nextRetryAt = undefined;
}

function scheduleRetry(state: HeadroomRuntimeState): void {
	state.nextRetryAt = Date.now() + BACKOFF_MS[Math.min(state.retryAttempts++, BACKOFF_MS.length - 1)];
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
	if (!online) scheduleRetry(runtime.state);
	else if (runtime.state.compressionAvailable === false) {
		runtime.state.compressionAvailable = null;
		runtime.state.unavailableReason = undefined;
	}
	return online;
}

/** One shared in-flight health check; `context` awaits it, bounded by the client timeout. */
function checkHealthInBackground(runtime: HeadroomRuntime, ctx: ExtensionContext): Promise<void> {
	if (runtime.state.pendingHealth) return runtime.state.pendingHealth;
	const generation = runtime.healthGeneration;
	const client = runtime.client;
	const tracked: Promise<void> = (async () => {
		try {
			await updateHealthState(runtime, undefined, generation, client);
		} catch {
			if (generation === runtime.healthGeneration && client === runtime.client) runtime.state.proxyOnline = false;
		}
		if (generation === runtime.healthGeneration && client === runtime.client) runtime.refreshStatus(ctx);
	})().finally(() => {
		if (runtime.state.pendingHealth === tracked) runtime.state.pendingHealth = undefined;
	});
	runtime.state.pendingHealth = tracked;
	return tracked;
}

async function ensureProxy(runtime: HeadroomRuntime, ctx: ExtensionContext): Promise<boolean> {
	const healthy = await runtime.updateHealth(ctx);
	runtime.state.proxyStarting = false;
	runtime.state.proxyStartAttempted = false;
	runtime.refreshStatus(ctx);
	return healthy;
}

/** Lazy recovery: no timers, the next `context` event after the backoff re-checks health. */
async function proxyReady(runtime: HeadroomRuntime, ctx: ExtensionContext): Promise<boolean> {
	const state = runtime.state;
	if (state.pendingHealth) await state.pendingHealth;
	const down = state.proxyOnline === false || state.compressionAvailable === false;
	if (state.proxyOnline === null || (down && Date.now() >= (state.nextRetryAt ?? 0))) await checkHealthInBackground(runtime, ctx);
	return state.proxyOnline === true && state.compressionAvailable !== false;
}

async function handleContextCompression(
	runtime: HeadroomRuntime,
	event: ContextEvent,
	ctx: ExtensionContext,
): Promise<{ messages?: AgentMessage[] } | undefined> {
	if (shouldSkipBeforePayload(runtime, ctx)) return undefined;
	const { state } = runtime;
	const { memo, sent } = state.session;
	const contextTokens = ctx.getContextUsage()?.tokens ?? undefined;
	const payload = buildCompressionPayload(event.messages, runtime.config.minMessageChars);
	// The server session freezes every result it already returned, so re-sending one cannot change it.
	const hasNewCandidate = payload.mappings.some(({ applyTo, toolCallId }) => applyTo && toolCallId && !sent.has(toolCallId));
	const requested =
		hasNewCandidate && !(contextTokens !== undefined && contextTokens < runtime.config.minContextTokens) && (await proxyReady(runtime, ctx))
			? await requestCompression(runtime, ctx, payload)
			: undefined;

	// Replay invariant: a result the server already answered for keeps the bytes first forwarded on every
	// later call, whether or not this call reached the server.
	let newMessages = 0;
	for (const [id, text] of requested?.replacements ?? []) {
		if (sent.has(id)) continue;
		memo.set(id, text);
		newMessages++;
	}
	if (requested) {
		for (const { applyTo, toolCallId } of payload.mappings) if (applyTo && toolCallId) sent.add(toolCallId);
	}
	const anchorIndex = findUsageAnchor(event.messages);
	const out = replaceToolResultTexts(event.messages, memo, anchorIndex);

	const stats = state.stats;
	const savedTokens = Math.max(0, estimateTokens(out.originalChars) - estimateTokens(out.forwardedChars));
	// Headroom Savings is the share of the whole request. OMP's context estimate is the provider-reported
	// prompt of the last response (results up to the anchor already counted compressed) plus original text
	// after it, so only savings at or before the anchor are added back to get the size without Headroom.
	const anchoredSaved = Math.max(0, estimateTokens(out.anchoredChars.original) - estimateTokens(out.anchoredChars.forwarded));
	const beforeTokens =
		contextTokens === undefined ? estimateTokens(payload.chars) : Math.max(contextTokens + anchoredSaved, savedTokens);
	stats.calls++;
	stats.beforeTokens += beforeTokens;
	stats.savedTokens += savedTokens;
	if (newMessages > 0) stats.applied++;
	stats.last = {
		beforeTokens,
		savedTokens,
		newMessages,
		replayedMessages: out.replaced - newMessages,
		transformsApplied: requested?.result.transformsApplied ?? [],
		ccrHashes: requested?.result.ccrHashes ?? [],
		session: requested?.result.session ?? stats.last?.session,
	};
	runtime.refreshStatus(ctx);
	return out.messages === event.messages ? undefined : { messages: out.messages };
}

async function requestCompression(
	runtime: HeadroomRuntime,
	ctx: ExtensionContext,
	payload: CompressionPayload,
): Promise<{ result: CompressResult; replacements: Map<string, string> } | undefined> {
	const { state, client } = runtime;
	state.session.id ??= ctx.sessionManager.getSessionId();
	const sessionId = state.session.id;
	const send = () => client.compress(payload.messages, ctx.model?.id, sessionId);
	state.stats.attempts++;
	let result: CompressResult;
	try {
		// A 503 is a busy/timed-out session; the retry lands on consistent server state.
		result = await send().catch(error => {
			if (error instanceof HeadroomHttpError && error.status === 503) return send();
			throw error;
		});
	} catch (error) {
		recordCompressionError(runtime, ctx, error);
		return undefined;
	}
	if (result.skipReason) {
		state.stats.lastError = `compression skipped: ${result.skipReason}`;
		return undefined;
	}
	state.compressionAvailable = true;
	state.proxyOnline = true;
	state.unavailableReason = undefined;
	state.retryAttempts = 0;
	state.nextRetryAt = undefined;
	state.stats.lastError = undefined;
	const applied = applyCompressionResult(payload.mappings, result.messages);
	if (!applied.ok) {
		recordGuardSkip(state.stats, applied.reason);
		return undefined;
	}
	state.stats.lastSkipReason = applied.rejected[0];
	if (applied.rejected.length > 0) state.stats.guardSkips++;
	return { result, replacements: applied.replacements };
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
	return false;
}

function recordGuardSkip(stats: HeadroomStats, reason: string): void {
	stats.guardSkips++;
	stats.lastSkipReason = reason;
}

/** Memo-only for this call unless the error says the proxy or its configuration is unusable. */
function recordCompressionError(runtime: HeadroomRuntime, ctx: ExtensionContext, error: unknown): void {
	const state = runtime.state;
	state.stats.lastError = getErrorMessage(error);
	if (!isAbortOrTimeoutError(error)) {
		if (error instanceof HeadroomHttpError) {
			if (UNAVAILABLE_STATUSES.includes(error.status)) {
				state.compressionAvailable = false;
				state.unavailableReason = String(error.status);
				scheduleRetry(state);
			}
		} else {
			state.proxyOnline = false;
			scheduleRetry(state);
			if (!state.offlineWarningShown) {
				state.offlineWarningShown = true;
				notify(
					ctx,
					`Headroom proxy unavailable. Compression retries automatically; already compressed results stay stable.\n${state.stats.lastError}`,
					"warning",
				);
			}
		}
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

async function setupProxyToken(runtime: HeadroomRuntime, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI || typeof ctx.ui.input !== "function") {
		notify(ctx, "Headroom token setup requires interactive UI.", "warning");
		return;
	}

	let token: string | undefined;
	try {
		token = await ctx.ui.input("Headroom proxy token (visible)", "Paste token");
	} catch (error) {
		notify(ctx, `Headroom token setup failed: ${getErrorMessage(error)}`, "error");
		return;
	}
	if (token === undefined) {
		notify(ctx, "Headroom token setup cancelled.", "info");
		return;
	}

	try {
		const tokenPath = writeHeadroomProxyToken(token, runtime.config.proxyTokenFile);
		runtime.healthGeneration++;
		runtime.client = createClient(runtime.config);
		runtime.state.proxyOnline = null;
		clearAvailability(runtime.state);
		runtime.state.remoteWarningShown = false;
		runtime.state.offlineWarningShown = false;
		const healthy = await runtime.updateHealth(ctx);
		notify(
			ctx,
			healthy
				? `Headroom proxy token saved: ${tokenPath}\nProxy online: ${runtime.config.baseUrl}`
				: `Headroom proxy token saved: ${tokenPath}\nProxy not reachable: ${runtime.config.baseUrl}`,
			healthy ? "info" : "warning",
		);
	} catch (error) {
		notify(ctx, `Headroom token setup failed: ${getErrorMessage(error)}`, "error");
	}
}

async function handleCommand(
	runtime: HeadroomRuntime,
	command: Exclude<Subcommand, "init">,
	ctx: ExtensionContext,
): Promise<void> {
	if (command === "token") {
		await setupProxyToken(runtime, ctx);
		return;
	}
	if (command === "on") {
		runtime.state.sessionEnabledOverride = true;
		runtime.state.enabled = true;
		runtime.state.offlineWarningShown = false;
		const healthy = await runtime.ensureProxy(ctx);
		notify(ctx, healthy ? "Headroom compression enabled. Start proxy separately if needed." : proxyStartHint(runtime.config), healthy ? "info" : "warning");
		return;
	}
	if (command === "off") {
		runtime.state.sessionEnabledOverride = false;
		runtime.state.enabled = false;
		runtime.refreshStatus(ctx);
		notify(ctx, "Headroom compression disabled for this Pi session. The proxy process is left running.", "info");
		return;
	}
	if (command === "health") {
		await showProxyHealth(runtime, ctx);
		return;
	}
	if (command === "stats") {
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
	const state = widgetState({
		enabled: runtime.state.enabled,
		blocked: isRemoteBlocked(runtime.config),
		starting: runtime.state.proxyStarting,
		online: runtime.state.proxyOnline,
		unavailable: runtime.state.compressionAvailable === false,
		checking: runtime.state.pendingHealth !== undefined,
		saved: runtime.state.stats.savedTokens > 0,
	});
	const fallback = resolveThemeGlyph(ctx.ui.theme, state) || DEFAULT_GLYPHS[state];
	try {
		const stats = runtime.state.stats;
		const values = {
			label: "Headroom",
			compressionPercent: savingsPercent(stats.savedTokens, stats.beforeTokens),
			tokensSaved: stats.savedTokens,
			tokensBefore: stats.beforeTokens,
			tokensAfter: stats.beforeTokens - stats.savedTokens,
			lastPercent: savingsPercent(stats.last?.savedTokens ?? 0, stats.last?.beforeTokens ?? 0),
			lastSaved: stats.last?.savedTokens ?? 0,
			proxyStatus:
				runtime.state.proxyOnline === true
					? "online"
					: runtime.state.proxyStarting
						? "starting"
						: runtime.state.proxyOnline === false
							? "offline"
							: "unknown",
			error: stats.lastError ?? "",
			reason: runtime.state.unavailableReason ?? stats.lastError ?? "",
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
		`  Compression: ${!state.enabled ? "disabled" : state.compressionAvailable === false ? "unavailable" : state.compressionAvailable === true ? "available" : "unknown"}`,
		"  Proxy start: manual",
		"  Shutdown: proxy is left running after Pi exits",
		`  Remote:  ${isRemoteBlocked(config) ? "blocked" : config.allowRemote ? "allowed" : "local-only"}`,
		`  Thresholds: context >= ${config.minContextTokens.toLocaleString()} tokens, toolResult >= ${config.minMessageChars.toLocaleString()} chars`,
		`  Config: ${configPath}`,
		"",
		"Session stats:",
		`  Agent Session: ${state.session.id ?? "not started"}`,
		`  Headroom Savings: ${savingsPercent(stats.savedTokens, stats.beforeTokens)}% (${formatCompact(stats.savedTokens)} of ${formatCompact(stats.beforeTokens)} tokens saved over ${stats.calls} calls)`,
		`  Compressed results replayed: ${state.session.memo.size}`,
		`  Compress requests: ${stats.attempts}`,
		`  Calls with new compression: ${stats.applied}`,
		`  Guard skips:  ${stats.guardSkips}`,
	];
	if (stats.last) {
		lines.push(
			"",
			"Last call:",
			`  ${formatCompact(stats.last.savedTokens)} of ${formatCompact(stats.last.beforeTokens)} tokens saved (${savingsPercent(stats.last.savedTokens, stats.last.beforeTokens)}%)`,
			`  New compressed results: ${stats.last.newMessages}, replayed from memo: ${stats.last.replayedMessages}`,
			`  Transforms: ${stats.last.transformsApplied.join(", ") || "none"}`,
			`  CCR hashes: ${stats.last.ccrHashes.length}`,
			stats.last.session
				? `  Server session: ${stats.last.session.id} (frozen ${stats.last.session.frozenMessageCount}, prefix replayed: ${stats.last.session.cachedPrefixReplayed ? "yes" : "no"})`
				: "  Server session: none returned",
		);
	}
	if (state.unavailableReason) lines.push("", `Unavailable reason: ${state.unavailableReason}`);
	if (stats.lastSkipReason) lines.push("", `Last guard skip: ${stats.lastSkipReason}`);
	if (stats.lastError) lines.push("", `Last error: ${stats.lastError}`);
	if (state.nextRetryAt !== undefined && (state.proxyOnline === false || state.compressionAvailable === false)) {
		const seconds = Math.max(0, Math.ceil((state.nextRetryAt - Date.now()) / 1000));
		lines.push("", `Next health retry: on the next request after ${seconds}s`);
	}
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
	if (command === "init") {
		if (tokens.length === 1) return { command: "init", initTarget: "all" };
		return tokens.length === 2 && INIT_TARGETS.includes(tokens[1] as HeadroomInitTarget)
			? { command: "init", initTarget: tokens[1] as HeadroomInitTarget }
			: { command: "invalid" };
	}
	return tokens.length === 1 ? { command: command as Subcommand } : { command: "invalid" };
}

function savingsPercent(saved: number, before: number): number {
	return before > 0 ? Math.round((saved / before) * 100) : 0;
}

function emptyStats(): HeadroomStats {
	return { attempts: 0, applied: 0, guardSkips: 0, calls: 0, beforeTokens: 0, savedTokens: 0 };
}

function notify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error"): void {
	ctx.ui.notify(message, type);
}


export const __test__ = {
	isAbortOrTimeoutError,
	parseCommand,
};
