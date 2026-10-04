import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { matchesKey, truncateToWidth, type Component } from "@oh-my-pi/pi-tui";
import { connectSharedDisplay, type SharedDisplayPublisher } from "@codesook/omp-shared-display/client";
import { CODESOOK_OMP_CONFIG_CHANGED, isRecord, readCodesookOmpConfig } from "@codesook/omp-shared-display/config-store";
import { readIntegrationSettings, resolveIntegrationProject, setProjectIntegrationPolicy, type IntegrationPolicy, type IntegrationVisibility } from "@codesook/omp-shared-display/project-integrations";
import { inspectBeads, type BeadsInspection } from "./status";

export type BeadsOptions = { globalConfigPath?: string };
export type BeadsStatus = Omit<BeadsInspection, "state"> & {
	state: BeadsInspection["state"] | "suppressed";
	integrationProject?: string;
	operatingDirectory?: string;
	policy?: IntegrationPolicy;
	policySource: string;
	visibility: IntegrationVisibility;
	errors: readonly string[];
};

export function formatBeadsStatus(status: BeadsStatus): string {
	return [
		`Beads: ${status.state}`,
		`Integration Project: ${status.integrationProject ?? "unresolved"}`,
		...(status.operatingDirectory ? [`Operating Directory: ${status.operatingDirectory}`] : []),
		`Tool Workspace: ${status.workspacePath ?? "not resolved"}`,
		`Database: ${status.databasePath ?? "not resolved"}`,
		`Policy: ${status.policy ?? (status.policySource === "unresolved" ? "unresolved (guidance disabled)" : "invalid (guidance disabled)")} (${status.policySource})`,
		`Visibility: ${status.visibility}`,
		status.detail,
		...status.errors,
	].join("\n");
}

/** On-demand guidance only: no initialization, issue operations or tool registration. */
export default function beadsExtension(pi: ExtensionAPI, options: BeadsOptions = {}): void {
	let status: BeadsStatus | undefined;
	let activeContext: ExtensionContext | undefined;
	let publisher: SharedDisplayPublisher | undefined;
	let unsubscribePresence: (() => void) | undefined;
	let refreshVersion = 0;
	let stopped = false;

	const syncDisplay = (): void => {
		if (!activeContext || stopped) return;
		const visible = status !== undefined && (status.visibility === "always" || (status.visibility === "ready" && status.state === "ready"));
		const text = visible ? `Beads: ${status!.state}` : undefined;
		publisher?.publish(text ? { frames: [[text]] } : null);
		activeContext.ui.setStatus("beads", publisher?.hostAvailable ? undefined : text);
	};
	const refresh = async (ctx: ExtensionContext): Promise<BeadsStatus | undefined> => {
		const version = ++refreshVersion;
		const cwd = ctx.cwd;
		if (activeContext && activeContext !== ctx) activeContext.ui.setStatus("beads", undefined);
		activeContext = ctx;
		status = undefined;
		syncDisplay();
		try {
			const integrationProject = await resolveIntegrationProject(cwd);
			const settings = readIntegrationSettings("beads", integrationProject, options.globalConfigPath);
			const inspected = await inspectBeads((command, args, execOptions) => pi.exec(command, args, execOptions), cwd);
			if (version !== refreshVersion || stopped || ctx.cwd !== cwd) return undefined;
			status = {
				...inspected,
				state: settings.errors.length > 0 ? "error" : settings.policy === "off" ? "suppressed" : inspected.state,
				integrationProject,
				policy: settings.policy,
				policySource: settings.policySource,
				visibility: settings.visibility,
				errors: settings.errors,
			};
		} catch (error) {
			if (version !== refreshVersion || stopped || ctx.cwd !== cwd) return undefined;
			const global = readCodesookOmpConfig(options.globalConfigPath);
			const display = global.valid && isRecord(global.value.display.beads) ? global.value.display.beads : undefined;
			const visibility = display?.visibility;
			status = { state: "error", initialized: false, operatingDirectory: cwd, policySource: "unresolved", visibility: visibility === "always" || visibility === "never" ? visibility : "ready", errors: [], detail: error instanceof Error ? error.message : String(error) };
		}
		syncDisplay();
		return status;
	};
	const startSession = async (ctx: ExtensionContext): Promise<void> => {
		stopped = false;
		unsubscribePresence?.();
		publisher?.dispose();
		publisher = connectSharedDisplay(pi.events, "beads");
		unsubscribePresence = publisher.onHostAvailabilityChange(syncDisplay);
		await refresh(ctx);
	};
	const showStatus = async (ctx: ExtensionContext): Promise<void> => {
		if (!ctx.hasUI || typeof ctx.ui.custom !== "function") {
			const current = await refresh(ctx);
			if (current) ctx.ui.notify(formatBeadsStatus(current), "info");
			return;
		}
		await ctx.ui.custom<void>((tui, theme, _keys, done) => {
			let text = "Loading…";
			let closed = false;
			void refresh(ctx).then(current => {
				if (closed) return;
				text = current ? formatBeadsStatus(current) : "Project changed during inspection; run /beads status again.";
				tui.requestRender();
			});
			const component: Component = {
				render: width => [theme.fg("accent", theme.bold("Beads Status")), ...text.split("\n").map(line => truncateToWidth(line, width)), "", theme.fg("dim", "Enter/Esc close")],
				handleInput: data => {
					if (matchesKey(data, "enter") || matchesKey(data, "escape")) { closed = true; done(undefined); }
				},
				invalidate() {},
			};
			return component;
		}, { overlay: true });
	};
	pi.registerCommand("beads", {
		description: "Inspect Beads integration or set project guidance policy: status|auto|off",
		handler: async (args, ctx) => {
			const operation = args.trim().toLowerCase() || "status";
			if (operation === "status") { await showStatus(ctx); return; }
			if (operation !== "auto" && operation !== "off") {
				await refresh(ctx);
				ctx.ui.notify("Usage: /beads [status|auto|off]. Initialize explicitly with the bd CLI; this plugin does not initialize projects.", "warning");
				return;
			}
			try {
				const cwd = ctx.cwd;
				const project = await resolveIntegrationProject(cwd);
				if (ctx.cwd !== cwd) throw new Error("Project changed before the policy update; run /beads again in the intended project.");
				const current = readIntegrationSettings("beads", project, options.globalConfigPath);
				if (current.errors.length) throw new Error(current.errors.join("\n"));
				setProjectIntegrationPolicy("beads", project, operation);
				pi.events.emit(CODESOOK_OMP_CONFIG_CHANGED, { projectPath: project });
				await refresh(ctx);
				ctx.ui.notify(`Beads project policy: ${operation}. ${project}`, "info");
			} catch (error) {
				await refresh(ctx);
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
	pi.on("session_start", (_event, ctx) => startSession(ctx));
	pi.on("session_switch", (_event, ctx) => startSession(ctx));
	pi.on("session_branch", (_event, ctx) => startSession(ctx));
	pi.on("before_agent_start", async (event, ctx) => {
		const current = await refresh(ctx);
		if (!current || current.state !== "ready" || current.policy !== "auto" || !current.workspacePath) return;
		return { systemPrompt: [...event.systemPrompt, `Beads integration is ready for this turn. Availability alone does not authorize issue operations. Use Beads only when the user explicitly requests issue tracking or issue operations, and only within that request's scope. Do not automatically create or update issues for unrelated work. Use the installed bd CLI with --json where supported, running with cwd: ${JSON.stringify(ctx.cwd)}. Native resolved Tool Workspace: ${JSON.stringify(current.workspacePath)}; database: ${JSON.stringify(current.databasePath ?? "native configuration")}. Respect native workspace discovery and redirects; do not select a different database. This optional plugin guidance does not replace or relax existing repository operational instructions, including task-tracking obligations. Plugin availability does not authorize setup, initialization, or remote sync; existing authorization requirements remain unchanged.`] };
	});
	const unsubscribeConfig = pi.events.on(CODESOOK_OMP_CONFIG_CHANGED, () => {
		if (activeContext && !stopped) void refresh(activeContext);
	});
	pi.on("session_shutdown", () => {
		stopped = true;
		refreshVersion += 1;
		unsubscribePresence?.();
		publisher?.dispose();
		activeContext?.ui.setStatus("beads", undefined);
		unsubscribeConfig();
		activeContext = undefined;
	});
}
