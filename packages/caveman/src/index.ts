import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { CODESOOK_OMP_CONFIG_CHANGED } from "@codesook/omp-shared-display/config-store";
import { connectSharedDisplay } from "@codesook/omp-shared-display/client";
import { loadCavemanConfig, normalizeCavemanRootConfig } from "./config.ts";
import {
	loadCavemanSequence,
	loadPackageCavemanSequence,
	renderCavemanFrameSequence,
	renderNativeCavemanStatus,
} from "./display.ts";
import { appendCavemanSystemPrompt, readCavemanSkillBody } from "./instructions.ts";
import { isCavemanDeactivationCommand, resolveCavemanSessionMode } from "./session.ts";
import {
	CAVEMAN_ACTIVE_MODES,
	CONFIG_PATH,
	DEFAULT_CAVEMAN_CONFIG,
	DEFAULT_SKILL_DIRECTORY,
	PACKAGE_ASSET_DIRECTORY,
	cloneCavemanConfig,
	getCodesookOmpConfigPath,
	isCavemanMode,
	isRecord,
	type CavemanActiveMode,
	type CavemanConfig,
	type CavemanMode,
} from "./types.ts";

export * from "./config.ts";
export * from "./display.ts";
export * from "./instructions.ts";
export * from "./session.ts";
export * from "./types.ts";
// Upstream aliases: `/caveman ultra` and `/caveman wenyan` select ultracave and megacave.
const COMMAND_ARGUMENTS = ["status", ...CAVEMAN_ACTIVE_MODES, "off", "ultra", "wenyan"] as const;
// Live Caveman mode per agent id. OMP rebinds the parent's extension factories into every subagent
// session in the same process, so this module state is shared: a child reads its parent's mode at session_start.
const agentModes = new Map<string, () => CavemanMode>();
const COMMAND_USAGE = "Usage: /caveman [status|off|caveman|ultracave|megacave] (aliases: ultra, wenyan)";
const CAVEMAN_MENU = [
	{ command: "status", label: "Show status", description: "Open current mode and display settings; leave session mode unchanged." },
	{ command: "off", label: "Off", description: "Stop Caveman rules this session; leave the saved default unchanged." },
	{ command: "caveman", label: "Caveman", description: "Terse voice: answer first, fluff gone, every technical fact kept this session." },
	{ command: "ultracave", label: "Ultracave", description: "Maximum compression: fragments, each fact once this session." },
	{ command: "megacave", label: "Megacave", description: "Classical Chinese register, technical terms verbatim this session." },
] as const;

export interface CavemanExtensionOptions {
	configPath?: string;
	legacyConfigPath?: string;
	legacyPackageConfigPath?: string;
	homeDirectory?: string;
	skillDirectory?: string;
	packageAssetDirectory?: string;
}


function reportWarning(
	pi: ExtensionAPI,
	warnings: Set<string>,
	message: string,
	ctx?: ExtensionContext,
): void {
	if (warnings.has(message)) return;
	warnings.add(message);
	if (ctx?.hasUI) {
		ctx.ui.notify(message, "warning");
		return;
	}
	try {
		pi.logger.warn(message);
	} catch {
		// Some test harnesses provide only a partial ExtensionAPI logger.
	}
}
function hasSessionModeEntry(entries: readonly unknown[]): boolean {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== "caveman-mode") continue;
		const data = entry.data;
		if (isRecord(data) && isCavemanMode(data.mode)) return true;
	}
	return false;
}

// `ctx.agent` exists from OMP 18.3.2; older hosts report undefined and skip subagent inheritance.
function agentIdentity(ctx: ExtensionContext): { id: string; parentId?: string } | undefined {
	if (!("agent" in ctx) || !isRecord(ctx.agent) || typeof ctx.agent.id !== "string") return undefined;
	return { id: ctx.agent.id, parentId: typeof ctx.agent.parentId === "string" ? ctx.agent.parentId : undefined };
}

function reportInfo(pi: ExtensionAPI, ctx: ExtensionContext, message: string): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, "info");
		return;
	}
	try {
		pi.logger.info(message);
	} catch {
		// Non-interactive hosts may not expose a logger in a minimal harness.
	}
}

function notifyError(pi: ExtensionAPI, ctx: ExtensionContext, message: string): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, "error");
		return;
	}
	try {
		pi.logger.error(message);
	} catch {
		// Non-interactive hosts may not expose a logger in a minimal harness.
	}
}

function commandCompletions(prefix: string): Array<{ value: string; label: string; description: string }> | null {
	const normalized = prefix.trim().toLowerCase();
	const matches = COMMAND_ARGUMENTS.filter(value => value.startsWith(normalized));
	return matches.length > 0
		? matches.map(value => ({
				value,
				label: value,
				description: value === "status" ? "Show current state" : "Set current mode",
			}))
		: null;
}
async function showCavemanStatus(
	ctx: ExtensionContext,
	mode: CavemanMode,
	config: CavemanConfig,
	configPath: string,
	sessionModeExplicit: boolean,
): Promise<void> {
	const content = [
		`Mode: ${mode}`,
		`Default: ${config.defaultMode}${sessionModeExplicit && mode !== config.defaultMode ? " (overridden by session mode)" : ""}`,
		`Native status: ${config.nativeVisible ? "on" : "off"}`,
		`Shared display: ${config.display.visible ? "on" : "off"}`,
		`Config: ${configPath}`,
	];
	if (!ctx.hasUI || typeof ctx.ui.custom !== "function") {
		ctx.ui.notify(["Caveman status", ...content].join("\n"), "info");
		return;
	}
	await ctx.ui.custom<void>(
		(_tui, theme, _keybindings, done) => ({
			render(width: number): readonly string[] {
				const fit = (line: string): string => (line.length > width ? line.slice(0, width) : line);
				return [
					theme.fg("accent", theme.bold("Caveman Status")),
					...content.map(fit),
					"",
					theme.fg("dim", "Enter/Esc close"),
				];
			},
			handleInput(data: string): void {
				if (data === "\r" || data === "\n" || data === "\u001b") done(undefined);
			},
			invalidate(): void {},
		}),
		{ overlay: true },
	);
}

export default function cavemanExtension(pi: ExtensionAPI, options: CavemanExtensionOptions = {}): void {
	let configPath = options.configPath ?? getCodesookOmpConfigPath(options.homeDirectory);
	const rootConfig =
		options.configPath === undefined || configPath === CONFIG_PATH || configPath === getCodesookOmpConfigPath(options.homeDirectory);
	const skillDirectory = options.skillDirectory ?? DEFAULT_SKILL_DIRECTORY;
	const packageAssetDirectory = options.packageAssetDirectory ?? PACKAGE_ASSET_DIRECTORY;
	const warnings = new Set<string>();
	const publisher = connectSharedDisplay(pi.events, "caveman");
	let config = cloneCavemanConfig(DEFAULT_CAVEMAN_CONFIG);
	let mode: CavemanMode = "off";
	let active = false;
	let hasSessionState = false;
	let sessionModeExplicit = false;
	let activeContext: ExtensionContext | undefined;
	let disposed = false;
	let configLoad: Promise<void> | undefined;
	const skillLoads = new Map<CavemanActiveMode, Promise<string | undefined>>();
	let syncVersion = 0;
	let agentId: string | undefined;
	const currentMode = (): CavemanMode => mode;

	const loadConfig = async (ctx?: ExtensionContext, force = false): Promise<void> => {
		if (force) configLoad = undefined;
		if (!configLoad) {
			configLoad = (async () => {
				const loaded = await loadCavemanConfig({
					configPath: options.configPath,
					legacyConfigPath: options.legacyConfigPath,
					legacyPackageConfigPath: options.legacyPackageConfigPath,
					homeDirectory: options.homeDirectory,
					packageAssetDirectory,
					onWarning: message => reportWarning(pi, warnings, message, ctx),
				});
				configPath = loaded.configPath;
				config = loaded.config;
				if (!hasSessionState) mode = config.defaultMode;
			})();
		}
		try {
			await configLoad;
		} catch (error) {
			configLoad = undefined;
			reportWarning(pi, warnings, `Unable to load Caveman config: ${String(error)}`, ctx);
		}
	};

	const loadSkill = (skillMode: CavemanActiveMode): Promise<string | undefined> => {
		let load = skillLoads.get(skillMode);
		if (!load) {
			load = readCavemanSkillBody(skillDirectory, skillMode);
			skillLoads.set(skillMode, load);
		}
		return load;
	};

	const syncDisplay = async (ctx: ExtensionContext): Promise<void> => {
		const version = ++syncVersion;
		if (disposed) return;
		if (mode === "off") {
			publisher.publish(null);
			ctx.ui.setStatus("caveman", undefined);
			return;
		}
		try {
			const asset = await loadCavemanSequence(mode, config, {
				homeDirectory: options.homeDirectory,
				packageAssetDirectory,
			});
			const packageAsset = await loadPackageCavemanSequence(mode, packageAssetDirectory);
			if (version !== syncVersion || disposed) return;
			publisher.publish(renderCavemanFrameSequence(mode, asset, config, active, ctx.ui.theme));
			const native = renderNativeCavemanStatus(
				mode,
				asset,
				packageAsset.frames[0]?.[0] ?? "🐴",
				config,
				active,
				ctx.ui.theme,
			);
			ctx.ui.setStatus("caveman", native);
		} catch (error) {
			if (version !== syncVersion || disposed) return;
			reportWarning(pi, warnings, `Unable to render Caveman display: ${String(error)}`, ctx);
			publisher.publish(null);
			ctx.ui.setStatus("caveman", undefined);
		}
	};
	const applyLiveConfig = (data: unknown): void => {
		if (!rootConfig || disposed || !isRecord(data)) return;
		const next = normalizeCavemanRootConfig(data.config);
		if (!next) return;
		config = next;
		if (!sessionModeExplicit) mode = next.defaultMode;
		if (activeContext) void syncDisplay(activeContext);
	};
	const unsubscribeConfig = rootConfig ? pi.events.on(CODESOOK_OMP_CONFIG_CHANGED, applyLiveConfig) : undefined;

	const rehydrateSession = async (ctx: ExtensionContext, inheritFromParent = false): Promise<void> => {
		activeContext = ctx;
		hasSessionState = true;
		await loadConfig(ctx, true);
		const entries = ctx.sessionManager.getBranch();
		sessionModeExplicit = hasSessionModeEntry(entries);
		mode = resolveCavemanSessionMode(entries, config.defaultMode);
		const agent = agentIdentity(ctx);
		const parentMode = inheritFromParent && !sessionModeExplicit && agent?.parentId ? agentModes.get(agent.parentId)?.() : undefined;
		if (parentMode !== undefined) {
			sessionModeExplicit = true;
			mode = parentMode;
			pi.appendEntry("caveman-mode", { mode });
		}
		if (agent) {
			agentModes.set(agent.id, currentMode);
			agentId = agent.id;
		}
		active = false;
		await syncDisplay(ctx);
	};

	const setSessionMode = async (next: CavemanMode, ctx: ExtensionContext): Promise<void> => {
		sessionModeExplicit = true;
		mode = next;
		pi.appendEntry("caveman-mode", { mode });
		await syncDisplay(ctx);
		reportInfo(pi, ctx, mode === "off" ? "Caveman off." : `Caveman ${mode}.`);
	};

	pi.on("session_start", async (_event, ctx) => {
		await rehydrateSession(ctx, true);
	});
	pi.on("session_switch", async (_event, ctx) => {
		await rehydrateSession(ctx);
	});
	pi.on("session_branch", async (_event, ctx) => {
		await rehydrateSession(ctx);
	});
	pi.on("agent_start", async (_event, ctx) => {
		activeContext = ctx;
		active = true;
		await syncDisplay(ctx);
	});
	pi.on("agent_end", async (event, ctx) => {
		activeContext = ctx;
		if (event.willContinue) return;
		active = false;
		await syncDisplay(ctx);
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		if (agentId !== undefined && agentModes.get(agentId) === currentMode) agentModes.delete(agentId);
		disposed = true;
		active = false;
		syncVersion += 1;
		activeContext = undefined;
		unsubscribeConfig?.();
		ctx.ui.setStatus("caveman", undefined);
		publisher.publish(null);
		publisher.dispose();
	});

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent): Promise<BeforeAgentStartEventResult | undefined> => {
		await loadConfig();
		if (mode === "off") return undefined;
		let addition: string | undefined;
		try {
			addition = await loadSkill(mode);
		} catch (error) {
			reportWarning(pi, warnings, `Unable to read vendored Caveman skill; skipping injection: ${String(error)}`);
			return undefined;
		}
		if (!addition) {
			reportWarning(pi, warnings, "Vendored Caveman skill is malformed; skipping injection.");
			return undefined;
		}
		return { systemPrompt: appendCavemanSystemPrompt(event.systemPrompt, addition) };
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension" || mode === "off" || !isCavemanDeactivationCommand(event.text)) return;
		await setSessionMode("off", ctx);
	});

	pi.registerCommand("caveman", {
		description: COMMAND_USAGE,
		getArgumentCompletions: commandCompletions,
		handler: async (args, ctx) => {
			let argument = args.trim().toLowerCase();
			if (!argument) {
				if (!ctx.hasUI) {
					reportInfo(pi, ctx, `${COMMAND_USAGE}\nUse status to inspect the current mode, off to stop Caveman rules, or a named mode to change only this session. All modes preserve your language.`);
					return;
				}
				const choice = await ctx.ui.select("Caveman", CAVEMAN_MENU.map(({ label, description }) => ({ label, description })));
				const selected = CAVEMAN_MENU.find(option => option.label === choice);
				if (!selected) return;
				argument = selected.command;
			}
			const target = argument === "ultra" ? "ultracave" : argument === "wenyan" ? "megacave" : argument;
			if (target !== "status" && !isCavemanMode(target)) {
				notifyError(pi, ctx, `Unknown Caveman command: ${argument}. ${COMMAND_USAGE}`);
				return;
			}
			await loadConfig(ctx);
			if (target === "status") {
				await showCavemanStatus(ctx, mode, config, configPath, sessionModeExplicit);
				return;
			}
			await setSessionMode(target, ctx);
		},
	});

	// Upstream: ultracave and megacave also run standalone ("Invoke only with /ultracave or /caveman ultra").
	for (const standalone of ["ultracave", "megacave"] as const) {
		pi.registerCommand(standalone, {
			description: `Set Caveman mode ${standalone} for this session`,
			handler: async (_args, ctx) => {
				await loadConfig(ctx);
				await setSessionMode(standalone, ctx);
			},
		});
	}
}
