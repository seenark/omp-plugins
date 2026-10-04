import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { matchesKey, truncateToWidth, type Component } from "@oh-my-pi/pi-tui";
import { connectSharedDisplay, type SharedDisplayPublisher } from "@codesook/omp-shared-display/client";
import { CODESOOK_OMP_CONFIG_CHANGED } from "@codesook/omp-shared-display/config-store";
import { readIntegrationSettings, resolveIntegrationProject, setProjectIntegrationPolicy, type IntegrationPolicy, type IntegrationVisibility } from "@codesook/omp-shared-display/project-integrations";
import { inspectCodeGraph, type CodeGraphInspection } from "./status";

export type CodeGraphOptions = { globalConfigPath?: string };
export type CodeGraphStatus = Omit<CodeGraphInspection, "state"> & {
	state: CodeGraphInspection["state"] | "suppressed";
	integrationProject: string;
	policy?: IntegrationPolicy;
	policySource: string;
	visibility: IntegrationVisibility;
	errors: readonly string[];
};

export function formatCodeGraphStatus(status: CodeGraphStatus): string {
	return [
		`CodeGraph: ${status.state}`,
		`Integration Project: ${status.integrationProject}`,
		`Tool Workspace: ${status.projectPath ?? "not resolved"}`,
		`Project data: ${status.indexPath ?? "not resolved"}`,
		`Policy: ${status.policy ?? "invalid (guidance disabled)"} (${status.policySource})`,
		`Visibility: ${status.visibility}`,
		`Exploration MCP tool: ${status.toolName ?? (status.projectPath ? "missing or inactive" : "not assessed")}`,
		status.detail,
		...status.errors,
		"MCP connection health was not tested.",
	].join("\n");
}

/** Runtime guidance only: no initialization, tool registration or tool activation. */
export default function codegraphExtension(pi: ExtensionAPI, options: CodeGraphOptions = {}): void {
	let status: CodeGraphStatus | undefined;
	let activeContext: ExtensionContext | undefined;
	let publisher: SharedDisplayPublisher | undefined;
	let unsubscribePresence: (() => void) | undefined;
	let refreshVersion = 0;
	let stopped = false;

	const syncDisplay = (): void => {
		if (!activeContext || stopped) return;
		const visible = status !== undefined && (status.visibility === "always" || (status.visibility === "ready" && status.state === "ready"));
		const text = visible ? `CodeGraph: ${status!.state}` : undefined;
		publisher?.publish(text ? { frames: [[text]] } : null);
		activeContext.ui.setStatus("codegraph", publisher?.hostAvailable ? undefined : text);
	};
	const refresh = async (ctx: ExtensionContext): Promise<CodeGraphStatus | undefined> => {
		const version = ++refreshVersion;
		activeContext = ctx;
		status = undefined;
		syncDisplay();
		try {
			const integrationProject = await resolveIntegrationProject(ctx.cwd);
			const settings = readIntegrationSettings("codegraph", integrationProject, options.globalConfigPath);
			const inspected = await inspectCodeGraph((command, args, execOptions) => pi.exec(command, args, execOptions), ctx.cwd, pi.getAllTools(), pi.getActiveTools());
			if (version !== refreshVersion || stopped) return undefined;
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
			if (version !== refreshVersion || stopped) return undefined;
			status = { state: "error", initialized: false, integrationProject: ctx.cwd, policySource: "unresolved", visibility: "ready", errors: [], detail: error instanceof Error ? error.message : String(error) };
		}
		syncDisplay();
		return status;
	};
	const startSession = async (ctx: ExtensionContext): Promise<void> => {
		stopped = false;
		activeContext = ctx;
		unsubscribePresence?.();
		publisher?.dispose();
		publisher = connectSharedDisplay(pi.events, "codegraph");
		unsubscribePresence = publisher.onHostAvailabilityChange(syncDisplay);
		await refresh(ctx);
	};
	const showStatus = async (ctx: ExtensionContext): Promise<void> => {
		if (!ctx.hasUI || typeof ctx.ui.custom !== "function") {
			const current = await refresh(ctx);
			if (current) ctx.ui.notify(formatCodeGraphStatus(current), "info");
			return;
		}
		await ctx.ui.custom<void>((tui, theme, _keys, done) => {
			let text = "Loading…";
			let closed = false;
			void refresh(ctx).then(current => {
				if (closed) return;
				text = current ? formatCodeGraphStatus(current) : "Status changed during inspection; run /codegraph status again.";
				tui.requestRender();
			});
			const component: Component = {
				render: width => [theme.fg("accent", theme.bold("CodeGraph Status")), ...text.split("\n").map(line => truncateToWidth(line, width)), "", theme.fg("dim", "Enter/Esc close")],
				handleInput: data => {
					if (matchesKey(data, "enter") || matchesKey(data, "escape")) { closed = true; done(undefined); }
				},
				invalidate() {},
			};
			return component;
		}, { overlay: true });
	};
	pi.registerCommand("codegraph", {
		description: "Inspect CodeGraph integration or set project guidance policy: status|auto|off",
		handler: async (args, ctx) => {
			const operation = args.trim().toLowerCase() || "status";
			if (operation === "status") { await showStatus(ctx); return; }
			if (operation !== "auto" && operation !== "off") {
				await refresh(ctx);
				ctx.ui.notify("Usage: /codegraph [status|auto|off]. Initialize explicitly with the CodeGraph CLI; this plugin does not initialize projects.", "warning");
				return;
			}
			try {
				const project = await resolveIntegrationProject(ctx.cwd);
				const current = readIntegrationSettings("codegraph", project, options.globalConfigPath);
				if (current.errors.length) throw new Error(current.errors.join("\n"));
				setProjectIntegrationPolicy("codegraph", project, operation);
				await refresh(ctx);
				pi.events.emit(CODESOOK_OMP_CONFIG_CHANGED, { projectPath: project });
				ctx.ui.notify(`CodeGraph project policy: ${operation}. ${project}`, "info");
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
		if (!current || current.state !== "ready" || current.policy !== "auto" || !current.projectPath || !current.toolName) return;
		return { systemPrompt: [...event.systemPrompt, `CodeGraph integration is ready for this turn. Use ${current.toolName} first for code exploration, flow, relationships, callers, callees, and change impact. Pass projectPath: ${JSON.stringify(current.projectPath)} explicitly. Treat returned verbatim source as already read. Use grep/read for missing coverage, missing details, or source reported stale by CodeGraph. Readiness is setup readiness, not tested MCP connection health.`] };
	});
	const unsubscribeConfig = pi.events.on(CODESOOK_OMP_CONFIG_CHANGED, () => {
		if (activeContext && !stopped) void refresh(activeContext);
	});
	pi.on("session_shutdown", () => {
		stopped = true;
		refreshVersion += 1;
		unsubscribePresence?.();
		publisher?.dispose();
		activeContext?.ui.setStatus("codegraph", undefined);
		unsubscribeConfig();
		activeContext = undefined;
	});
}
