import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { matchesKey, truncateToWidth, type Component } from "@oh-my-pi/pi-tui";
import { connectSharedDisplay, type SharedDisplayPublisher } from "@codesook/omp-shared-display/client";
import { CODESOOK_OMP_CONFIG_CHANGED, isRecord } from "@codesook/omp-shared-display/config-store";
import { loadRtkConfig, normalizeRtkConfig } from "./config.ts";
import { renderRtkFrames, formatCompact } from "./display.ts";
import { detectRtk, rewriteCommand, withSessionEnv } from "./rewrite.ts";
import { SESSIONS_ROOT, openSessionStore, pruneSessions, readSavings, type Savings } from "./store.ts";

const PROMPT_LINE =
	"rtk may filter shell command output to save tokens. Prefix a command with `RTK_DISABLED=1` to get raw output, or run `rtk recall <hash>` (hash from the recovery hint; `rtk recall --list` lists entries) for the full output.";

export type RtkOptions = { configPath?: string; sessionsRoot?: string };

/** Rewrite bash commands through `rtk rewrite`, keep per-session RTK history, publish RTK Savings. */
export default function rtkExtension(pi: ExtensionAPI, options: RtkOptions = {}): void {
	const root = options.sessionsRoot ?? SESSIONS_ROOT;
	const exec = (command: string, args: string[], execOptions: { timeout: number }) => pi.exec(command, args, execOptions);
	let config = loadRtkConfig(options.configPath);
	let publisher: SharedDisplayPublisher | undefined;
	let version: string | undefined;
	let checked = false;
	let availability: Promise<boolean> = Promise.resolve(false);
	let savings: Savings = { commands: 0, tokensInput: 0, tokensSaved: 0 };
	let rewrites = 0;
	const skips = new Map<string, number>();
	const pending = new Set<string>();

	const storeFor = (ctx: ExtensionContext) => openSessionStore(ctx.sessionManager.getSessionId(), root);
	const publish = (): void => {
		if (!publisher) return;
		const state = !config.enabled ? "off" : checked && !version ? "missing" : "active";
		publisher.publish(config.display.visible ? renderRtkFrames(state, savings, config.display) : null);
	};
	const startAvailability = (): void => {
		version = undefined;
		checked = false;
		availability = config.enabled
			? detectRtk(exec).then(found => {
					version = found;
					checked = true;
					publish();
					return found !== undefined;
				})
			: Promise.resolve(false);
	};
	const refreshSavings = (ctx: ExtensionContext): void => {
		try {
			savings = readSavings(storeFor(ctx).historyDb);
		} catch {
			// Keep the last known savings when the database is busy or unreadable.
		}
		publish();
	};
	const startSession = (ctx: ExtensionContext): void => {
		publisher?.publish(null);
		publisher?.dispose();
		publisher = connectSharedDisplay(pi.events, "rtk");
		config = loadRtkConfig(options.configPath);
		rewrites = 0;
		skips.clear();
		pending.clear();
		try {
			pruneSessions(root, storeFor(ctx).dir, config.retentionDays);
		} catch {
			// Retention is best effort; a locked directory must not block the session.
		}
		savings = { commands: 0, tokensInput: 0, tokensSaved: 0 };
		startAvailability();
		refreshSavings(ctx);
	};

	pi.on("session_start", (_event, ctx) => startSession(ctx));
	pi.on("session_switch", (_event, ctx) => startSession(ctx));
	pi.on("session_branch", (_event, ctx) => startSession(ctx));
	pi.on("session_shutdown", () => {
		unsubscribeConfig();
		publisher?.publish(null);
		publisher?.dispose();
		publisher = undefined;
	});
	const unsubscribeConfig = pi.events.on(CODESOOK_OMP_CONFIG_CHANGED, data => {
		const next = isRecord(data) && isRecord(data.config) && data.config.version === 1 ? data.config : undefined;
		if (!next) return;
		const wasEnabled = config.enabled;
		config = normalizeRtkConfig(next);
		if (config.enabled && !wasEnabled) startAvailability();
		publish();
	});

	pi.on("tool_call", async (event, ctx) => {
		const input = event.input as { command?: unknown };
		if (event.toolName !== "bash" || !config.enabled || typeof input.command !== "string") return;
		if (!(await availability)) return;
		const outcome = await rewriteCommand(exec, input.command);
		let command = input.command;
		if (outcome.kind === "rewritten") {
			command = outcome.command;
			rewrites++;
		} else if (outcome.kind === "skipped") {
			// Commands that already run rtk (`rtk recall`) still need the session databases.
			if (outcome.reason !== "already-rtk") return void skips.set(outcome.reason, (skips.get(outcome.reason) ?? 0) + 1);
		} else {
			return;
		}
		const store = storeFor(ctx);
		input.command = withSessionEnv(command, store.historyDb, store.recallDb);
		pending.add(event.toolCallId);
	});
	pi.on("tool_execution_end", (event, ctx) => {
		if (pending.delete(event.toolCallId)) refreshSavings(ctx);
	});
	pi.on("before_agent_start", async event => {
		if (!config.enabled || !(await availability)) return;
		return { systemPrompt: [...event.systemPrompt, PROMPT_LINE] };
	});

	const formatStatus = (ctx: ExtensionContext): string => {
		const store = storeFor(ctx);
		let current = savings;
		try {
			current = readSavings(store.historyDb);
		} catch {
			// Fall back to the last published numbers.
		}
		const percent = current.tokensInput > 0 ? Math.round((current.tokensSaved / current.tokensInput) * 100) : 0;
		const skipTotal = [...skips.values()].reduce((sum, count) => sum + count, 0);
		const reasons = [...skips].map(([reason, count]) => `${reason} ${count}`).join(", ");
		return [
			`RTK: ${!config.enabled ? "off" : version ? "active" : "missing"}`,
			`  Binary: ${version ?? "missing or older than 0.51.0"}`,
			`  Session dir: ${store.dir}`,
			`  RTK Savings: ${percent}% (${formatCompact(current.tokensSaved)} saved of ${formatCompact(current.tokensInput)}, ${current.commands} commands)`,
			`  Rewrites: ${rewrites}`,
			`  Guard skips: ${skipTotal}${reasons ? ` (${reasons})` : ""}`,
		].join("\n");
	};
	const showStatus = async (ctx: ExtensionContext): Promise<void> => {
		const text = formatStatus(ctx);
		if (!ctx.hasUI || typeof ctx.ui.custom !== "function") {
			ctx.ui.notify(text, "info");
			return;
		}
		await ctx.ui.custom<void>((_tui, theme, _keys, done) => {
			const component: Component = {
				render: width => [theme.fg("accent", theme.bold("RTK Status")), ...text.split("\n").map(line => truncateToWidth(line, width)), "", theme.fg("dim", "Enter/Esc close")],
				handleInput: data => {
					if (matchesKey(data, "enter") || matchesKey(data, "escape")) done(undefined);
				},
				invalidate() {},
			};
			return component;
		}, { overlay: true });
	};
	pi.registerCommand("rtk", {
		description: "RTK shell output filtering. Usage: /rtk [status]",
		getArgumentCompletions: prefix => ("status".startsWith(prefix.trim().toLowerCase()) ? [{ value: "status", label: "status" }] : []),
		handler: async (args, ctx) => {
			const operation = args.trim().toLowerCase();
			if (operation === "" || operation === "status") await showStatus(ctx);
			else ctx.ui.notify("Usage: /rtk [status]", "warning");
		},
	});
}
