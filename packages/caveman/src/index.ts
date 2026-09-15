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
import {
	appendCavemanSystemPrompt,
	filterCavemanSkill,
	readCavemanSkill,
} from "./instructions.ts";
import { resolveCavemanSessionLevelFromConfig } from "./session.ts";
import {
	CAVEMAN_ACTIVE_LEVELS,
	CAVEMAN_LEVELS,
	CONFIG_PATH,
	DEFAULT_CAVEMAN_CONFIG,
	DEFAULT_SKILL_PATH,
	PACKAGE_ASSET_DIRECTORY,
	cloneCavemanConfig,
	getCodesookOmpConfigPath,
	isCavemanLevel,
	isRecord,
	type CavemanConfig,
	type CavemanLevel,
} from "./types.ts";

export * from "./config.ts";
export * from "./display.ts";
export * from "./instructions.ts";
export * from "./session.ts";
export * from "./types.ts";
const COMMAND_LEVELS = [
	"status",
	...CAVEMAN_ACTIVE_LEVELS,
	"off",
] as const;
const COMMAND_USAGE =
	"Usage: /caveman [status|off|lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra]";

export interface CavemanExtensionOptions {
	configPath?: string;
	legacyConfigPath?: string;
	legacyPackageConfigPath?: string;
	homeDirectory?: string;
	skillPath?: string;
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
function hasSessionLevelEntry(entries: readonly unknown[]): boolean {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== "caveman-level") continue;
		const data = entry.data;
		if (isRecord(data) && isCavemanLevel(data.level)) return true;
	}
	return false;
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
	const matches = COMMAND_LEVELS.filter(value => value.startsWith(normalized));
	return matches.length > 0
		? matches.map(value => ({
				value,
				label: value,
				description: value === "status" ? "Show current state" : "Set current level",
			}))
		: null;
}
async function showCavemanStatus(
	ctx: ExtensionContext,
	level: CavemanLevel,
	config: CavemanConfig,
	configPath: string,
): Promise<void> {
	const content = [
		`Level: ${level}`,
		`Default: ${config.defaultLevel}`,
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
	const skillPath = options.skillPath ?? DEFAULT_SKILL_PATH;
	const packageAssetDirectory = options.packageAssetDirectory ?? PACKAGE_ASSET_DIRECTORY;
	const warnings = new Set<string>();
	const publisher = connectSharedDisplay(pi.events, "caveman");
	let config = cloneCavemanConfig(DEFAULT_CAVEMAN_CONFIG);
	let level: CavemanLevel = "off";
	let active = false;
	let hasSessionState = false;
	let sessionLevelExplicit = false;
	let activeContext: ExtensionContext | undefined;
	let disposed = false;
	let configLoad: Promise<void> | undefined;
	let skillLoad: Promise<string> | undefined;
	let syncVersion = 0;

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
				if (!hasSessionState) level = config.defaultLevel;
			})();
		}
		try {
			await configLoad;
		} catch (error) {
			configLoad = undefined;
			reportWarning(pi, warnings, `Unable to load Caveman config: ${String(error)}`, ctx);
		}
	};

	const loadSkill = async (): Promise<string> => {
		if (!skillLoad) skillLoad = readCavemanSkill(skillPath);
		return skillLoad;
	};

	const syncDisplay = async (ctx: ExtensionContext): Promise<void> => {
		const version = ++syncVersion;
		if (disposed) return;
		if (level === "off") {
			publisher.publish(null);
			ctx.ui.setStatus("caveman", undefined);
			return;
		}
		try {
			const asset = await loadCavemanSequence(level, config, {
				homeDirectory: options.homeDirectory,
				packageAssetDirectory,
			});
			const packageAsset = await loadPackageCavemanSequence(level, packageAssetDirectory);
			if (version !== syncVersion || disposed) return;
			publisher.publish(renderCavemanFrameSequence(level, asset, config, active, ctx.ui.theme));
			const native = renderNativeCavemanStatus(
				level,
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
		if (!sessionLevelExplicit) level = next.defaultLevel;
		if (activeContext) void syncDisplay(activeContext);
	};
	const unsubscribeConfig = rootConfig ? pi.events.on(CODESOOK_OMP_CONFIG_CHANGED, applyLiveConfig) : undefined;

	const rehydrateSession = async (ctx: ExtensionContext): Promise<void> => {
		activeContext = ctx;
		hasSessionState = true;
		await loadConfig(ctx, true);
		const entries = ctx.sessionManager.getBranch();
		sessionLevelExplicit = hasSessionLevelEntry(entries);
		level = resolveCavemanSessionLevelFromConfig(entries, config);
		active = false;
		await syncDisplay(ctx);
	};


	pi.on("session_start", async (_event, ctx) => {
		await rehydrateSession(ctx);
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
		if (level === "off") return undefined;
		let skill: string;
		try {
			skill = await loadSkill();
		} catch (error) {
			reportWarning(pi, warnings, `Unable to read vendored Caveman skill; skipping injection: ${String(error)}`);
			return undefined;
		}
		const addition = filterCavemanSkill(skill, level);
		if (!addition) {
			reportWarning(pi, warnings, "Vendored Caveman skill is malformed; skipping injection.");
			return undefined;
		}
		return { systemPrompt: appendCavemanSystemPrompt(event.systemPrompt, addition) };
	});

	pi.registerCommand("caveman", {
		description: COMMAND_USAGE,
		getArgumentCompletions: commandCompletions,
		handler: async (args, ctx) => {
			const argument = args.trim().toLowerCase();
			await loadConfig(ctx);
			if (argument === "status") {
				await showCavemanStatus(ctx, level, config, configPath);
				return;
			}
			if (!CAVEMAN_LEVELS.includes(argument as CavemanLevel)) {
				notifyError(pi, ctx, `Unknown Caveman command: ${argument || "(empty)"}. ${COMMAND_USAGE}`);
				return;
			}
			sessionLevelExplicit = true;
			level = argument as CavemanLevel;
			pi.appendEntry("caveman-level", { level });
			await syncDisplay(ctx);
			reportInfo(pi, ctx, level === "off" ? "Caveman off." : `Caveman ${level}.`);
		},
	});
}
