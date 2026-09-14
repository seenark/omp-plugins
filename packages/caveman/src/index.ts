import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { connectSharedDisplay } from "@codesook/omp-shared-display/client";
import {
	loadCavemanConfig,
	seedMissingCavemanGlyphs,
	validateCavemanConfig,
	writeCavemanConfigAtomic,
} from "./config.ts";
import { openCavemanDialog } from "./dialog.ts";
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
	expandHomePath,
	type CavemanConfig,
	type CavemanLevel,
} from "./types.ts";

export * from "./config.ts";
export * from "./display.ts";
export * from "./instructions.ts";
export * from "./session.ts";
export * from "./types.ts";

const COMMAND_LEVELS = [
	"config",
	"status",
	...CAVEMAN_ACTIVE_LEVELS,
	"off",
] as const;
const COMMAND_USAGE =
	"Usage: /caveman [config|status|off|lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra]";

export interface CavemanExtensionOptions {
	configPath?: string;
	legacyConfigPath?: string;
	homeDirectory?: string;
	skillPath?: string;
	packageAssetDirectory?: string;
}

function isEnter(data: string): boolean {
	return data === "\r" || data === "\n";
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
				description: value === "config" ? "Open staged settings" : value === "status" ? "Show current state" : "Set current level",
			}))
		: null;
}

export default function cavemanExtension(pi: ExtensionAPI, options: CavemanExtensionOptions = {}): void {
	const configPath = options.configPath ?? CONFIG_PATH;
	const skillPath = options.skillPath ?? DEFAULT_SKILL_PATH;
	const packageAssetDirectory = options.packageAssetDirectory ?? PACKAGE_ASSET_DIRECTORY;
	const warnings = new Set<string>();
	const publisher = connectSharedDisplay(pi.events, "caveman");
	let config = cloneCavemanConfig(DEFAULT_CAVEMAN_CONFIG);
	let level: CavemanLevel = "off";
	let active = false;
	let hasSessionState = false;
	let disposed = false;
	let configLoad: Promise<void> | undefined;
	let skillLoad: Promise<string> | undefined;
	let syncVersion = 0;

	const loadConfig = async (ctx?: ExtensionContext, force = false): Promise<void> => {
		if (force) configLoad = undefined;
		if (!configLoad) {
			configLoad = (async () => {
				const loaded = await loadCavemanConfig({
					configPath,
					legacyConfigPath: options.legacyConfigPath,
					homeDirectory: options.homeDirectory,
					packageAssetDirectory,
					onWarning: message => reportWarning(pi, warnings, message, ctx),
				});
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

	const rehydrateSession = async (ctx: ExtensionContext): Promise<void> => {
		hasSessionState = true;
		await loadConfig(ctx, true);
		const entries = ctx.sessionManager.getBranch();
		level = resolveCavemanSessionLevelFromConfig(entries, config);
		active = false;
		await syncDisplay(ctx);
	};

	const applyConfig = async (draft: CavemanConfig, ctx: ExtensionContext): Promise<void> => {
		const error = validateCavemanConfig(draft);
		if (error) throw new Error(error);
		const previousDefault = config.defaultLevel;
		await writeCavemanConfigAtomic(draft, configPath);
		config = cloneCavemanConfig(draft);
		if (draft.defaultLevel !== previousDefault) {
			level = draft.defaultLevel;
			pi.appendEntry("caveman-level", { level });
		}
		await syncDisplay(ctx);
	};

	const openConfig = async (ctx: ExtensionContext): Promise<void> => {
		await loadConfig(ctx);
		if (!ctx.hasUI) {
			notifyError(pi, ctx, "Caveman settings require an interactive UI.");
			return;
		}
		await openCavemanDialog({
			ctx,
			config,
			configPath,
			skillPath,
			glyphPath: expandHomePath(config.display.glyphDirectory, options.homeDirectory),
			onApply: draft => applyConfig(draft, ctx),
			onReload: async () => {
				const loaded = await loadCavemanConfig({
					configPath,
					legacyConfigPath: options.legacyConfigPath,
					homeDirectory: options.homeDirectory,
					packageAssetDirectory,
					onWarning: message => reportWarning(pi, warnings, message, ctx),
				});
				return loaded.config;
			},
			onInitialize: draft =>
				seedMissingCavemanGlyphs(draft, {
					homeDirectory: options.homeDirectory,
					packageAssetDirectory,
				}),
		});
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
		active = true;
		await syncDisplay(ctx);
	});
	pi.on("agent_end", async (event, ctx) => {
		if (event.willContinue) return;
		active = false;
		await syncDisplay(ctx);
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		disposed = true;
		active = false;
		syncVersion += 1;
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
			if (argument === "" || argument === "config") {
				await openConfig(ctx);
				return;
			}
			await loadConfig(ctx);
			if (argument === "status") {
				reportInfo(
					pi,
					ctx,
					`Caveman ${level}; default ${config.defaultLevel}; native ${config.nativeVisible ? "on" : "off"}; display ${
						config.display.visible ? "on" : "off"
					}; config ${configPath}`,
				);
				return;
			}
			if (!CAVEMAN_LEVELS.includes(argument as CavemanLevel)) {
				notifyError(pi, ctx, `Unknown Caveman command: ${argument || "(empty)"}. ${COMMAND_USAGE}`);
				return;
			}
			level = argument as CavemanLevel;
			pi.appendEntry("caveman-level", { level });
			await syncDisplay(ctx);
			reportInfo(pi, ctx, level === "off" ? "Caveman off." : `Caveman ${level}.`);
		},
	});
}
