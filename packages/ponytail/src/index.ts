import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { CODESOOK_OMP_CONFIG_CHANGED, isRecord } from "@codesook/omp-shared-display/config-store";
import { connectSharedDisplay } from "@codesook/omp-shared-display/client";
import {
	envDefaultMode,
	loadPonytailConfig,
	normalizePonytailRootConfig,
	writePonytailDefaultMode,
} from "./config.ts";
import { loadPonytailSequence, renderNativePonytailStatus, renderPonytailFrameSequence } from "./display.ts";
import {
	PONYTAIL_HELPER_SKILLS,
	buildHelperSkillPrompt,
	buildPonytailInstructions,
	readPonytailSkill,
} from "./instructions.ts";
import { PONYTAIL_SESSION_ENTRY, isPonytailDeactivationCommand, parsePonytailCommand, readPonytailSessionMode } from "./session.ts";
import {
	DEFAULT_PONYTAIL_CONFIG,
	DEFAULT_SKILL_DIRECTORY,
	PACKAGE_ASSET_DIRECTORY,
	PONYTAIL_RUNTIME_MODES,
	clonePonytailConfig,
	getCodesookOmpConfigPath,
	type PonytailMode,
	type PonytailRuntimeMode,
} from "./types.ts";

export * from "./config.ts";
export * from "./display.ts";
export * from "./instructions.ts";
export * from "./session.ts";
export * from "./types.ts";

const COMMAND_VALUES = ["status", ...PONYTAIL_RUNTIME_MODES, ...PONYTAIL_RUNTIME_MODES.map(mode => `default ${mode}`)];
const COMMAND_USAGE = `Usage: /ponytail [${PONYTAIL_RUNTIME_MODES.join("|")}|status|default <${PONYTAIL_RUNTIME_MODES.join("|")}>]`;

// Live Ponytail Mode Level per agent id. OMP rebinds the parent's extension factories into every subagent
// session in the same process, so this module state is shared: a child reads its parent's Mode Level at session_start.
const agentModes = new Map<string, () => PonytailMode>();

export interface PonytailExtensionOptions {
	/** Root config path; default `~/.config/codesook-omp/config.json`. Only the default path follows live config events. */
	configPath?: string;
	homeDirectory?: string;
	env?: NodeJS.ProcessEnv;
	skillDirectory?: string;
	packageAssetDirectory?: string;
}

// `ctx.agent` exists from OMP 18.3.2; older hosts report undefined and skip subagent inheritance.
function agentIdentity(ctx: ExtensionContext): { id: string; parentId?: string } | undefined {
	if (!("agent" in ctx) || !isRecord(ctx.agent) || typeof ctx.agent.id !== "string") return undefined;
	return { id: ctx.agent.id, parentId: typeof ctx.agent.parentId === "string" ? ctx.agent.parentId : undefined };
}

function notify(pi: ExtensionAPI, ctx: ExtensionContext | undefined, level: "info" | "warning" | "error", message: string): void {
	if (ctx?.hasUI) {
		ctx.ui.notify(message, level);
		return;
	}
	try {
		pi.logger[level === "warning" ? "warn" : level](message);
	} catch {
		// Some test harnesses provide only a partial ExtensionAPI logger.
	}
}

export default function ponytailExtension(pi: ExtensionAPI, options: PonytailExtensionOptions = {}): void {
	const env = options.env ?? process.env;
	const skillDirectory = options.skillDirectory ?? DEFAULT_SKILL_DIRECTORY;
	const packageAssetDirectory = options.packageAssetDirectory ?? PACKAGE_ASSET_DIRECTORY;
	const warnings = new Set<string>();
	const publisher = connectSharedDisplay(pi.events, "ponytail");
	let config = clonePonytailConfig(DEFAULT_PONYTAIL_CONFIG);
	let configPath = options.configPath ?? getCodesookOmpConfigPath(options.homeDirectory);
	let mode: PonytailMode = "off";
	let active = false;
	let sessionModeExplicit = false;
	let activeContext: ExtensionContext | undefined;
	let disposed = false;
	let syncVersion = 0;
	let agentId: string | undefined;
	let skillLoad: Promise<string> | undefined;
	const currentMode = (): PonytailMode => mode;
	// Upstream documents PONYTAIL_DEFAULT_MODE as the highest-priority default.
	const defaultMode = (): PonytailRuntimeMode => envDefaultMode(env) ?? config.defaultMode;

	const warn = (message: string, ctx?: ExtensionContext): void => {
		if (warnings.has(message)) return;
		warnings.add(message);
		notify(pi, ctx, "warning", message);
	};

	const syncDisplay = async (ctx: ExtensionContext): Promise<void> => {
		const version = ++syncVersion;
		if (disposed) return;
		if (mode === "off") {
			publisher.publish(null);
			ctx.ui.setStatus("ponytail", undefined);
			return;
		}
		try {
			const asset = await loadPonytailSequence(mode, config, { homeDirectory: options.homeDirectory, packageAssetDirectory });
			if (version !== syncVersion || disposed) return;
			publisher.publish(renderPonytailFrameSequence(mode, asset, config, active));
			ctx.ui.setStatus("ponytail", renderNativePonytailStatus(mode, asset, config, active));
		} catch (error) {
			if (version !== syncVersion || disposed) return;
			warn(`Unable to render Ponytail display: ${String(error)}`, ctx);
			publisher.publish(null);
			ctx.ui.setStatus("ponytail", undefined);
		}
	};

	const unsubscribeConfig =
		options.configPath === undefined
			? pi.events.on(CODESOOK_OMP_CONFIG_CHANGED, data => {
					if (disposed || !isRecord(data)) return;
					const next = normalizePonytailRootConfig(data.config);
					if (!next) return;
					config = next;
					if (!sessionModeExplicit) mode = defaultMode();
					if (activeContext) void syncDisplay(activeContext);
				})
			: undefined;

	const rehydrateSession = async (ctx: ExtensionContext, inheritFromParent = false): Promise<void> => {
		activeContext = ctx;
		const loaded = loadPonytailConfig({
			configPath: options.configPath,
			homeDirectory: options.homeDirectory,
			onWarning: message => warn(message, ctx),
		});
		config = loaded.config;
		configPath = loaded.configPath;
		const entryMode = readPonytailSessionMode(ctx.sessionManager.getBranch());
		sessionModeExplicit = entryMode !== undefined;
		mode = entryMode ?? defaultMode();
		const agent = agentIdentity(ctx);
		const parentMode = inheritFromParent && !sessionModeExplicit && agent?.parentId ? agentModes.get(agent.parentId)?.() : undefined;
		if (parentMode !== undefined) {
			sessionModeExplicit = true;
			mode = parentMode;
			pi.appendEntry(PONYTAIL_SESSION_ENTRY, { mode });
		}
		if (agent) {
			agentModes.set(agent.id, currentMode);
			agentId = agent.id;
		}
		active = false;
		await syncDisplay(ctx);
	};

	const setSessionMode = async (next: PonytailRuntimeMode, ctx: ExtensionContext): Promise<void> => {
		sessionModeExplicit = true;
		mode = next;
		pi.appendEntry(PONYTAIL_SESSION_ENTRY, { mode });
		await syncDisplay(ctx);
		notify(pi, ctx, "info", `Ponytail mode set to ${mode}.`);
	};

	pi.on("session_start", async (_event, ctx) => {
		await rehydrateSession(ctx, true);
	});
	// OMP emits session_switch (/new, resume) and session_branch; session_tree moves within one session file.
	pi.on("session_switch", async (_event, ctx) => {
		await rehydrateSession(ctx);
	});
	pi.on("session_branch", async (_event, ctx) => {
		await rehydrateSession(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => {
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
		ctx.ui.setStatus("ponytail", undefined);
		publisher.publish(null);
		publisher.dispose();
	});

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent): Promise<BeforeAgentStartEventResult | undefined> => {
		if (mode === "off") return undefined;
		let skill = "";
		if (mode !== "review") {
			try {
				skillLoad ??= readPonytailSkill(skillDirectory);
				skill = await skillLoad;
			} catch (error) {
				skillLoad = undefined;
				warn(`Unable to read vendored Ponytail skill; skipping injection: ${String(error)}`);
				return undefined;
			}
		}
		const addition = buildPonytailInstructions(mode, skill);
		// OMP's systemPrompt is a string[]: append one element, never stringify the array.
		return addition === undefined ? undefined : { systemPrompt: [...event.systemPrompt, addition] };
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension" || mode === "off" || !isPonytailDeactivationCommand(event.text)) return;
		await setSessionMode("off", ctx);
	});

	pi.registerCommand("ponytail", {
		description: COMMAND_USAGE,
		getArgumentCompletions: prefix => {
			const typed = prefix.trimStart().toLowerCase();
			const matches = COMMAND_VALUES.filter(value => value.startsWith(typed));
			return matches.length > 0 ? matches.map(value => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const command = parsePonytailCommand(args, defaultMode(), mode);
			switch (command.type) {
				case "status":
					notify(pi, ctx, "info", `Ponytail: current ${mode} • default ${defaultMode()}`);
					return;
				case "set-mode":
					await setSessionMode(command.mode, ctx);
					return;
				case "set-default":
					try {
						writePonytailDefaultMode(command.mode, configPath);
						config = { ...config, defaultMode: command.mode };
						notify(
							pi,
							ctx,
							"info",
							defaultMode() === command.mode
								? `Default Ponytail mode set to ${command.mode}.`
								: `Saved default ${command.mode}, but env override keeps default at ${defaultMode()}.`,
						);
					} catch (error) {
						notify(pi, ctx, "error", `Failed to save default mode: ${error instanceof Error ? error.message : String(error)}`);
					}
					return;
				case "invalid":
					notify(pi, ctx, "warning", `Unknown or unsupported /ponytail mode. ${COMMAND_USAGE}`);
			}
		},
	});

	// OMP does not expand "/skill:<name>" sent by an extension, so each helper command sends the vendored skill itself.
	for (const name of PONYTAIL_HELPER_SKILLS) {
		pi.registerCommand(name, {
			description: `Run the ${name} skill`,
			handler: async (args, ctx) => {
				let skill: string;
				try {
					skill = await readPonytailSkill(skillDirectory, name);
				} catch (error) {
					notify(pi, ctx, "error", `Unable to read vendored ${name} skill: ${String(error)}`);
					return;
				}
				const message = buildHelperSkillPrompt(name, skill, args);
				if (ctx.isIdle()) {
					pi.sendUserMessage(message);
					return;
				}
				pi.sendUserMessage(message, { deliverAs: "followUp" });
				notify(pi, ctx, "info", `${name} queued as follow-up.`);
			},
		});
	}
}
