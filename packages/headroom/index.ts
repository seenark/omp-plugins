import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import { applyCompressionResult, buildCompressionPayload } from "./bridge.ts";
import { HeadroomHttpClient } from "./client.ts";
import { isRemoteBlocked, loadHeadroomConfig } from "./config.ts";
import {
	DISPLAY_CONFIG_PATH,
	isDisplayVisible,
	loadDisplayConfig,
	loadGlyphAsset,
	renderDisplay,
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
import type { AgentMessage, CompressResult, HeadroomConfig, HeadroomStats } from "./types.ts";

const STATUS_KEY = "headroom";
const SUBCOMMANDS = ["status", "on", "off", "display", "health", "stats", "init"] as const;
const INIT_TARGETS = ["config", "display", "glyphs", "all"] as const;
const HEADROOM_USAGE = "Usage: /headroom [on|off|status|display|health|stats|init [config|display|glyphs|all]]";

type Subcommand = (typeof SUBCOMMANDS)[number];

interface ParsedCommand {
	command: Subcommand;
	initTarget?: HeadroomInitTarget;
}

interface HeadroomRuntimeState {
	enabled: boolean;
	displayVisible: boolean;
	proxyOnline: boolean | null;
	proxyStarting: boolean;
	proxyStartAttempted: boolean;
	remoteWarningShown: boolean;
	offlineWarningShown: boolean;
	stats: HeadroomStats;
}

interface HeadroomRuntime {
	config: HeadroomConfig;
	client: HeadroomHttpClient;
	state: HeadroomRuntimeState;
	refreshStatus(ctx: ExtensionContext): void;
	updateHealth(ctx: ExtensionContext): Promise<boolean>;
	ensureProxy(ctx: ExtensionContext): Promise<boolean>;
}

export interface HeadroomExtensionOptions {
	initPaths?: HeadroomInitPaths;
	displayConfigPath?: string;
}

export default function headroomExtension(pi: ExtensionAPI, options: HeadroomExtensionOptions = {}) {
	const runtime = createRuntime(options.displayConfigPath);

	pi.on("session_start", (_event, ctx) => {
		if (isRemoteBlocked(runtime.config)) {
			runtime.refreshStatus(ctx);
			ctx.ui.notify(
				`Headroom remote URL is blocked by default: ${runtime.config.baseUrl}\nSet PI_HEADROOM_ALLOW_REMOTE=1 only if you trust that proxy with full context.`,
				"warning",
			);
			return;
		}
		runtime.refreshStatus(ctx);
		if (!runtime.state.enabled) return;
		void ensureProxyInBackground(runtime, ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setWidget(STATUS_KEY, undefined);
	});

	pi.on("context", (event, ctx) => handleContextCompression(runtime, event, ctx));

	pi.registerCommand("headroom", {
		description: `Headroom token compression. ${HEADROOM_USAGE}`,
		getArgumentCompletions(argumentPrefix) {
			const normalized = argumentPrefix.toLowerCase();
			const tokens = normalized.trim().split(/\s+/).filter(Boolean);
			if (/\s/.test(normalized)) {
				const command = tokens[0] ?? "";
				if (command === "init" && tokens.length <= 2) {
					const targetPrefix = tokens[1] ?? "";
					return INIT_TARGETS.filter((target) => target.startsWith(targetPrefix)).map((target) => ({
						value: target,
						label: target,
					}));
				}
				if (tokens.length > 1) return [];
				return SUBCOMMANDS.filter((candidate) => candidate.startsWith(command)).map((candidate) => ({
					value: candidate,
					label: candidate,
				}));
			}
			const prefix = normalized.trim();
			return SUBCOMMANDS.filter((command) => command.startsWith(prefix)).map((command) => ({
				value: command,
				label: command,
			}));
		},
		handler: async (args, ctx) => handleCommand(runtime, parseCommand(args), ctx, options.initPaths),
	});

	pi.registerCommand("headroom-health", {
		description: "Check Headroom proxy health",
		handler: async (_args, ctx) => {
			await handleCommand(runtime, { command: "health" }, ctx, options.initPaths);
		},
	});
}

function createRuntime(displayConfigPath = DISPLAY_CONFIG_PATH): HeadroomRuntime {
	const config = loadHeadroomConfig();
	const client = new HeadroomHttpClient({ baseUrl: config.baseUrl, timeoutMs: config.timeoutMs });
	const state: HeadroomRuntimeState = {
		enabled: config.enabled,
		displayVisible: isDisplayVisible(loadDisplayConfig(displayConfigPath)),
		proxyOnline: null,
		proxyStarting: false,
		proxyStartAttempted: false,
		remoteWarningShown: false,
		offlineWarningShown: false,
		stats: { attempts: 0, applied: 0, guardSkips: 0, tokensSaved: 0 },
	};

	const runtime: HeadroomRuntime = {
		config,
		client,
		state,
		refreshStatus(ctx) {
			refreshStatus(ctx, runtime.config, runtime.state, displayConfigPath);
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
		// The session may have been reloaded/replaced while background health was in flight.
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
			ctx.ui.notify("Headroom compression skipped because remote proxy is blocked.", "warning");
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
		ctx.ui.notify(
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
	if (
		typeof candidate.message === "string" &&
		/aborted due to timeout|operation was aborted/i.test(candidate.message)
	) {
		return true;
	}
	return candidate.cause !== undefined && candidate.cause !== error && isAbortOrTimeoutError(candidate.cause);
}

async function handleCommand(runtime: HeadroomRuntime, parsed: ParsedCommand, ctx: ExtensionContext, initPaths?: HeadroomInitPaths): Promise<void> {
	const command = parsed.command;
	if (command === "init") {
		await handleInitCommand(ctx, parsed.initTarget, initPaths);
		return;
	}
	if (command === "on") {
		runtime.state.enabled = true;
		runtime.state.offlineWarningShown = false;
		runtime.state.proxyStartAttempted = false;
		const healthy = await runtime.ensureProxy(ctx);
		ctx.ui.notify(
			healthy
				? "Headroom compression enabled. Proxy will keep running after Pi exits."
				: proxyStartHint(runtime.config),
			healthy ? "info" : "warning",
		);
		return;
	}
	if (command === "off") {
		runtime.state.enabled = false;
		runtime.refreshStatus(ctx);
		ctx.ui.notify("Headroom compression disabled for this Pi session. The proxy process is left running.", "info");
		return;
	}
	if (command === "display") {
		runtime.state.displayVisible = !runtime.state.displayVisible;
		runtime.refreshStatus(ctx);
		ctx.ui.notify(
			runtime.state.displayVisible
				? "Headroom display shown for this Pi session."
				: "Headroom display hidden for this Pi session.",
			"info",
		);
		return;
	}
	if (command === "health") {
		runtime.state.proxyStartAttempted = false;
		const healthy = await runtime.ensureProxy(ctx);
		ctx.ui.notify(
			healthy ? `Headroom proxy online: ${runtime.config.baseUrl}` : proxyStartHint(runtime.config),
			healthy ? "info" : "warning",
		);
		return;
	}
	if (command === "stats") {
		await showProxyStats(ctx, runtime.client, runtime.config);
		return;
	}
	ctx.ui.notify(renderStatus(runtime.config, runtime.state), "info");
}

async function handleInitCommand(ctx: ExtensionContext, target: HeadroomInitTarget | undefined, initPaths?: HeadroomInitPaths): Promise<void> {
	if (!target) {
		ctx.ui.notify(HEADROOM_USAGE, "warning");
		return;
	}
	const files = buildHeadroomInitFiles(target, ctx.ui.theme, initPaths);
	const result = await writeHeadroomInitFiles(files, async (file) =>
		ctx.ui.confirm("Overwrite Headroom file?", `${file.path} already exists. Overwrite it?`),
	);
	ctx.ui.notify(
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
			result.failed.length > 0
				? [
						`Failed (${result.failed.length}):`,
						...result.failed.map((failure) => `  ${failure.path}: ${failure.message}`),
					].join("\n")
				: "",
		].filter(Boolean);
		ctx.ui.notify(`Headroom initialization issues.\n${issues.join("\n")}`, result.failed.length > 0 ? "error" : "warning");
	}
}

function formatInitSummary(label: string, files: readonly string[]): string {
	return files.length > 0 ? `${label} (${files.length}):\n${files.map((file) => `  ${file}`).join("\n")}` : `${label}: none`;
}
function refreshStatus(
	ctx: ExtensionContext,
	config: HeadroomConfig,
	state: HeadroomRuntimeState,
	displayConfigPath: string,
): void {
	if (!ctx.hasUI) return;
	if (!state.displayVisible) {
		ctx.ui.setWidget(STATUS_KEY, undefined);
		return;
	}

	const compressed = Boolean(state.stats.last);
	const displayState = widgetState(
		state.enabled,
		isRemoteBlocked(config),
		state.proxyStarting,
		state.proxyOnline,
		compressed,
	);
	const displayConfig = loadDisplayConfig(displayConfigPath);
	const glyphAsset = loadGlyphAsset(displayState, displayConfig);
	const values = {
		label: "Headroom",
		compressionPercent: state.stats.last ? Math.round((1 - state.stats.last.compressionRatio) * 100) : 0,
		tokensSaved: state.stats.last?.tokensSaved ?? 0,
		tokensBefore: state.stats.last?.tokensBefore ?? 0,
		tokensAfter: state.stats.last?.tokensAfter ?? 0,
		proxyStatus: state.proxyOnline === true ? "online" : state.proxyStarting ? "starting" : state.proxyOnline === false ? "offline" : "unknown",
		error: state.stats.lastError ?? "",
	};
	const fallbackGlyph = resolveThemeGlyph(ctx.ui.theme, displayState);
	ctx.ui.setWidget(
		STATUS_KEY,
		(tui) => {
			let frame = 0;
			let timer: Timer | undefined;
			let disposed = false;
			const component = {
				dispose() {
					if (disposed) return;
					disposed = true;
					if (timer) {
						ctx.clearTimer(timer);
						timer = undefined;
					}
				},
				invalidate() {},
				render(width: number): readonly string[] {
					const text = renderDisplay(displayState, values, displayConfig, fallbackGlyph, frame, glyphAsset.frames);
					const clipped = truncateToWidth(text, width, "", false);
					return [" ".repeat(Math.max(0, width - visibleWidth(clipped))) + clipped];
				},
			};

			if (glyphAsset.fps !== undefined && glyphAsset.frames.length >= 2) {
				const intervalMs = Math.max(1, Math.round(1000 / glyphAsset.fps));
				timer = ctx.setInterval(() => {
					if (disposed) return;
					frame = (frame + 1) % glyphAsset.frames.length;
					tui.requestComponentRender(component);
				}, intervalMs);
			}
			return component;
		},
		{ placement: "belowEditor" },
	);
}



async function showProxyStats(
	ctx: ExtensionContext,
	client: HeadroomHttpClient,
	config: HeadroomConfig,
): Promise<void> {
	if (isRemoteBlocked(config)) {
		ctx.ui.notify(renderRemoteBlocked(config), "warning");
		return;
	}
	try {
		const stats = await client.stats();
		ctx.ui.notify(
			`Headroom proxy stats (${config.baseUrl}):\n${JSON.stringify(stats, null, 2).slice(0, 4000)}`,
			"info",
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Could not read Headroom stats: ${message}`, "warning");
	}
}

function renderStatus(config: HeadroomConfig, state: HeadroomRuntimeState): string {
	const stats = state.stats;
	const lines = [
		"Headroom token compression",
		`  Enabled: ${state.enabled ? "yes" : "no"}`,
		`  Display: ${state.displayVisible ? "shown" : "hidden"}`,
		`  Proxy:   ${config.baseUrl} (${state.proxyOnline === true ? "online" : state.proxyStarting ? "starting" : state.proxyOnline === false ? "not running" : "unknown"})`,
		`  Auto-start: ${config.autoStart ? `yes (${config.command})` : "no"}`,
		`  Shutdown: proxy is left running after Pi exits`,
		`  Remote:  ${isRemoteBlocked(config) ? "blocked" : config.allowRemote ? "allowed" : "local-only"}`,
		`  Thresholds: context >= ${config.minContextTokens.toLocaleString()} tokens, toolResult >= ${config.minMessageChars.toLocaleString()} chars`,
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
	const command = tokens[0];
	if (!command || !SUBCOMMANDS.includes(command as Subcommand)) return { command: "status" };
	if (command !== "init") return { command: command as Subcommand };
	const target = tokens[1];
	if (!target && tokens.length === 1) return { command: "init", initTarget: "all" };
	if (tokens.length === 2 && INIT_TARGETS.includes(target as HeadroomInitTarget)) {
		return { command: "init", initTarget: target as HeadroomInitTarget };
	}
	return { command: "init" };
}

export const __test__ = {
	isAbortOrTimeoutError,
};
