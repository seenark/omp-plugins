import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { connectSharedDisplay, type SharedDisplayPublisher } from "@codesook/omp-shared-display/client";
import { CODESOOK_OMP_CONFIG_CHANGED, isRecord } from "@codesook/omp-shared-display/config-store";
import { collectSnapshot, killProcess, type Exec } from "./collect.ts";
import { loadProcessMonitorDisplay, normalizeProcessMonitorDisplay, renderSegment } from "./display.ts";
import { clearEndedSessions, endedSessionsDir, readEndedSessions, recordEndedSession } from "./ended-sessions.ts";
import { isKillable, leftoverPortCount, withSessionMarker, type Snapshot, type TrackedProcess } from "./snapshot.ts";
import { DEFAULT_ROW_WIDTH, formatRow, formatSnapshotText, procsOverlay, type ProcsChoice, type ViewState } from "./view.ts";

export const REFRESH_MS = 30_000;
const STATUS_KEY = "process-monitor";

export type Timers = {
	setInterval(handler: () => void, ms: number): unknown;
	clearInterval(handle: unknown): void;
};

export type ProcessMonitorOptions = {
	configPath?: string;
	homeDir?: string;
	platform?: NodeJS.Platform;
	timers?: Timers;
	/** Pause after a signal so the refreshed list can show the process gone. */
	settleMs?: number;
};

const defaultTimers: Timers = {
	setInterval: (handler, ms) => {
		const handle = setInterval(handler, ms);
		handle.unref();
		return handle;
	},
	clearInterval: handle => clearInterval(handle as NodeJS.Timeout),
};

const describe = (process: TrackedProcess): string => `  ${formatRow(process, undefined, DEFAULT_ROW_WIDTH - 2)}`;

/** Lists processes OMP started, tags bash commands with their Agent Session, and publishes the leftover-port count. */
export default function processMonitorExtension(pi: ExtensionAPI, options: ProcessMonitorOptions = {}): void {
	const homeDir = options.homeDir ?? os.homedir();
	const platform = options.platform ?? process.platform;
	const timers = options.timers ?? defaultTimers;
	const endedDir = endedSessionsDir(homeDir);
	const exec: Exec = (command, args, execOptions) => pi.exec(command, args, execOptions);

	let display = loadProcessMonitorDisplay(options.configPath);
	let publisher: SharedDisplayPublisher | undefined;
	let unsubscribeHost: (() => void) | undefined;
	let timer: unknown;
	let activeContext: ExtensionContext | undefined;
	let session: string | undefined;
	let leftoverPorts = 0;
	let refreshing = false;

	const publish = (): void => {
		const sequence = renderSegment(leftoverPorts, display);
		publisher?.publish(sequence);
		activeContext?.ui.setStatus(STATUS_KEY, publisher?.hostAvailable ? undefined : sequence?.frames[0]?.[0]);
	};
	const inspect = async (ctx: ExtensionContext): Promise<Snapshot> => {
		const snapshot = await collectSnapshot(exec, { platform, homeDir, currentSession: ctx.sessionManager.getSessionId(), currentProject: ctx.cwd });
		if (publisher) {
			leftoverPorts = leftoverPortCount(snapshot.processes);
			publish();
		}
		return snapshot;
	};
	const refresh = async (ctx: ExtensionContext): Promise<Snapshot | undefined> => {
		if (refreshing) return undefined;
		refreshing = true;
		try {
			return await inspect(ctx);
		} catch {
			// Keep the last published count when a refresh fails.
			return undefined;
		} finally {
			refreshing = false;
		}
	};
	const stopTimer = (): void => {
		if (timer !== undefined) timers.clearInterval(timer);
		timer = undefined;
	};

	const announceEndedSessions = (ctx: ExtensionContext, snapshot: Snapshot): void => {
		const recorded = readEndedSessions(endedDir);
		if (recorded.length === 0) return;
		const rows = snapshot.processes.filter(process => isKillable(process) && process.session !== undefined && recorded.includes(process.session));
		clearEndedSessions(endedDir, recorded);
		if (rows.length === 0) return;
		ctx.ui.notify(
			[`${rows.length} process${rows.length === 1 ? "" : "es"} started by an earlier OMP session ${rows.length === 1 ? "is" : "are"} still running:`, ...rows.map(describe), "Run /procs to review or stop them."].join("\n"),
			"warning",
		);
	};

	const startSession = (ctx: ExtensionContext): void => {
		stopTimer();
		unsubscribeHost?.();
		publisher?.publish(null);
		publisher?.dispose();
		publisher = connectSharedDisplay(pi.events, "process-monitor");
		unsubscribeHost = publisher.onHostAvailabilityChange(publish);
		display = loadProcessMonitorDisplay(options.configPath);
		activeContext = ctx;
		session = ctx.sessionManager.getSessionId();
		leftoverPorts = 0;
		timer = timers.setInterval(() => {
			if (activeContext?.isIdle()) void refresh(activeContext);
		}, REFRESH_MS);
		void refresh(ctx).then(snapshot => snapshot && announceEndedSessions(ctx, snapshot));
	};

	/** The process may outlive its owner's confirmation, so the target is re-checked just before the signal. */
	const stop = async (ctx: ExtensionContext, target: TrackedProcess): Promise<string | undefined> => {
		const current = (await inspect(ctx)).processes.find(process => process.pid === target.pid);
		if (!current || current.command !== target.command || !isKillable(current)) return `pid ${target.pid} is gone or no longer the same process; nothing was stopped.`;
		return killProcess(exec, target.pid);
	};
	const settle = async (): Promise<void> => {
		const ms = options.settleMs ?? 300;
		if (ms <= 0) return;
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, ms);
		await promise;
	};

	const offerToClose = async (ctx: ExtensionContext, previous: string): Promise<void> => {
		let snapshot: Snapshot;
		try {
			snapshot = await inspect(ctx);
		} catch {
			return;
		}
		const rows = snapshot.processes.filter(process => process.session === previous && isKillable(process));
		if (rows.length === 0) return;
		const choice = await ctx.ui.select(
			[`The previous session left ${rows.length} process${rows.length === 1 ? "" : "es"} running:`, ...rows.map(describe)].join("\n"),
			["Close all", "Keep"],
		);
		if (choice !== "Close all") return;
		const failures: string[] = [];
		for (const row of rows) {
			const failure = await killProcess(exec, row.pid);
			if (failure) failures.push(`pid ${row.pid}: ${failure}`);
		}
		if (failures.length > 0) ctx.ui.notify(`Could not stop every process.\n${failures.join("\n")}`, "error");
		await settle();
		await refresh(ctx);
	};

	const showProcs = async (ctx: ExtensionContext): Promise<void> => {
		activeContext = ctx;
		const currentSession = ctx.sessionManager.getSessionId();
		let snapshot: Snapshot;
		try {
			snapshot = await inspect(ctx);
		} catch (error) {
			ctx.ui.notify(`/procs failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			return;
		}
		if (!ctx.hasUI || typeof ctx.ui.custom !== "function") {
			ctx.ui.notify(formatSnapshotText(snapshot, currentSession), "info");
			return;
		}
		const state: ViewState = { expanded: new Set() };
		for (;;) {
			const choice = await ctx.ui.custom<ProcsChoice>((tui, theme, _keys, done) => procsOverlay(snapshot, currentSession, state, done, tui, theme), { overlay: true });
			if (choice?.kind !== "kill") return;
			const target = snapshot.processes.find(process => process.pid === choice.pid);
			if (!target) return;
			const confirmed = await ctx.ui.confirm(
				`Stop pid ${target.pid}?`,
				[`Send SIGTERM to pid ${target.pid}.`, `Command: ${target.command}`, `Ports: ${target.ports.length > 0 ? target.ports.join(", ") : "none"}`].join("\n"),
			);
			state.notice = undefined;
			if (confirmed) {
				const failure = await stop(ctx, target);
				if (failure) {
					state.notice = `Could not stop pid ${target.pid}: ${failure}`;
					ctx.ui.notify(state.notice, "error");
				} else {
					await settle();
				}
			}
			try {
				snapshot = await inspect(ctx);
			} catch (error) {
				ctx.ui.notify(`/procs failed: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
		}
	};

	pi.on("tool_call", (event, ctx) => {
		const input = event.input as { command?: unknown };
		if (event.toolName !== "bash" || typeof input.command !== "string") return;
		input.command = withSessionMarker(input.command, ctx.sessionManager.getSessionId());
	});
	pi.on("session_start", (_event, ctx) => startSession(ctx));
	pi.on("session_switch", async (_event, ctx) => {
		const previous = session;
		session = ctx.sessionManager.getSessionId();
		activeContext = ctx;
		if (previous && previous !== session && ctx.hasUI) await offerToClose(ctx, previous);
		else void refresh(ctx);
	});
	pi.on("session_branch", (_event, ctx) => {
		session = ctx.sessionManager.getSessionId();
		activeContext = ctx;
	});
	pi.on("before_agent_start", (_event, ctx) => {
		activeContext = ctx;
		void refresh(ctx);
	});
	pi.on("session_shutdown", () => {
		stopTimer();
		unsubscribeConfig();
		unsubscribeHost?.();
		publisher?.publish(null);
		publisher?.dispose();
		publisher = undefined;
		activeContext?.ui.setStatus(STATUS_KEY, undefined);
		activeContext = undefined;
		try {
			if (session) recordEndedSession(endedDir, session);
		} catch {
			// Without a record the next start simply has nothing to report.
		}
	});
	const unsubscribeConfig = pi.events.on(CODESOOK_OMP_CONFIG_CHANGED, data => {
		const next = isRecord(data) && isRecord(data.config) && data.config.version === 1 ? data.config : undefined;
		if (!next) return;
		display = normalizeProcessMonitorDisplay(next);
		publish();
	});

	pi.registerCommand("procs", {
		description: "List processes OMP started, with their ports and sessions. Usage: /procs",
		handler: async (_args, ctx) => showProcs(ctx),
	});
}
