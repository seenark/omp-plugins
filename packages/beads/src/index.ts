import { lstatSync, readdirSync, realpathSync } from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { matchesKey, truncateToWidth, type Component } from "@oh-my-pi/pi-tui";
import { connectSharedDisplay, type SharedDisplayPublisher } from "@codesook/omp-shared-display/client";
import { CODESOOK_OMP_CONFIG_CHANGED, isRecord, readCodesookOmpConfig } from "@codesook/omp-shared-display/config-store";
import { readIntegrationSettings, resolveIntegrationProject, setProjectIntegrationPolicy, type IntegrationPolicy, type IntegrationVisibility } from "@codesook/omp-shared-display/project-integrations";
import { inspectBeads, type BeadsInspection } from "./status";

const COMMAND_CHOICES = [
	{ operation: "status", label: "Show status", description: "Open read-only workspace status; Enter or Esc closes it." },
	{ operation: "init", label: "Initialize project workspace", description: "Reuse a ready workspace, or continue to mode and hooks choices; standard initialization may make a Git commit." },
	{ operation: "auto", label: "Enable project guidance", description: "Save project permission now for Beads guidance when ready; do not perform issue operations." },
	{ operation: "off", label: "Disable project guidance", description: "Save project suppression now for this plugin's guidance; leave issue data, hooks, and other instructions unchanged." },
];

export type BeadsOptions = { globalConfigPath?: string };
export type BeadsStatus = Omit<BeadsInspection, "state"> & {
	state: BeadsInspection["state"] | "suppressed";
	workspaceState: BeadsInspection["state"];
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

function existsForInitialization(file: string): boolean {
	try { lstatSync(file); return true; } catch (error) {
		if (isRecord(error) && error.code === "ENOENT") return false;
		throw error;
	}
}

/** On-demand guidance and explicit initialization; no issue operations or tool registration. */
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
				workspaceState: inspected.state,
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
			status = { state: "error", workspaceState: "error", initialized: false, operatingDirectory: cwd, policySource: "unresolved", visibility: visibility === "always" || visibility === "never" ? visibility : "ready", errors: [], detail: error instanceof Error ? error.message : String(error) };
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
	const initialize = async (ctx: ExtensionContext): Promise<void> => {
		const cwd = ctx.cwd;
		try {
			let current = await refresh(ctx);
			if (!current) throw new Error("Project changed during inspection; run /beads init again.");
			if (!current.integrationProject || current.errors.length || (current.workspaceState !== "ready" && current.workspaceState !== "uninitialized")) throw new Error(formatBeadsStatus(current));
			const project = realpathSync(current.integrationProject);
			let stealth = false;
			let installHooks = false;
			if (current.workspaceState === "uninitialized") {
				const ensureEmpty = (): void => {
					if (current!.workspacePath || existsForInitialization(path.join(project, ".beads"))) throw new Error("Existing Beads data is not usable. Inspect or repair it with bd before initialization; no data will be replaced.");
					if (process.env.BEADS_DIR || process.env.BEADS_DB) throw new Error("The native BEADS_DIR/BEADS_DB override has no usable workspace. Repair or unset the override before creating data in the Integration Project; the plugin will not redirect or ignore it.");
				};
				ensureEmpty();
				if (!ctx.hasUI || typeof ctx.ui.select !== "function") throw new Error("Run /beads init in interactive OMP to choose mode and approve hooks, or use bd init directly with --skip-agents and --skip-hooks.");
				const modes = [
					{ label: "Standard/team", description: "Continue to a hooks choice before creating a team workspace; native initialization may make a Git commit." },
					{ label: "Stealth (personal, no Git hooks)", description: "Continue to a no-hooks choice before creating a personal workspace without native setup commits." },
				];
				const mode = await ctx.ui.select(`Initialize Beads: ${project}`, modes);
				if (mode === undefined) { ctx.ui.notify("Beads initialization cancelled; no files changed.", "info"); return; }
				if (!modes.some(value => value.label === mode)) throw new Error("Unknown Beads initialization mode; no files changed.");
				stealth = mode === modes[1]!.label;
				const hookChoices = stealth
					? [{ label: "No hooks (stealth mode)", description: "Initialize the personal workspace now without installing Git hooks; leave existing hooks unchanged." }]
					: [
						{ label: "No hooks", description: "Initialize the team workspace now without installing Git hooks; native setup may commit files." },
						{ label: "Install supported Git hooks", description: "Initialize the team workspace now and install native supported hooks; may migrate hooks and make a setup commit." },
					];
				const hooks = await ctx.ui.select("Beads Git hooks (Esc cancels initialization)", hookChoices);
				if (hooks === undefined) { ctx.ui.notify("Beads initialization cancelled; no files changed.", "info"); return; }
				if (!hookChoices.some(value => value.label === hooks)) throw new Error("Unknown Git-hook choice; no files changed.");
				installHooks = !stealth && hooks === hookChoices[1]!.label;
				if (ctx.cwd !== cwd) throw new Error("Project changed during initialization choices; run /beads init again.");
				current = await refresh(ctx);
				if (!current || !current.integrationProject || realpathSync(current.integrationProject) !== project || current.errors.length || (current.workspaceState !== "ready" && current.workspaceState !== "uninitialized")) throw new Error(current ? formatBeadsStatus(current) : "Project changed during inspection; run /beads init again.");
				if (current.workspaceState === "uninitialized") ensureEmpty();
			}
			if (current.workspaceState === "ready") {
				ctx.ui.notify(`Reusing existing Beads workspace; data and hooks unchanged.\n${formatBeadsStatus(current)}`, "info");
				return;
			}
			const git = await pi.exec("env", ["LC_ALL=C", "LANG=C", "git", "rev-parse", "--is-inside-work-tree"], { cwd: project, timeout: 5000 });
			const outsideGit = git.code === 128 && /^fatal: not a git repository(?: |\r?\n|$)/u.test(git.stderr.trim());
			if (git.code !== 0 && !outsideGit) throw new Error(`Cannot inspect Git before Beads initialization: ${git.stderr || git.stdout}`);
			let linkedWorktree = false;
			if (!outsideGit) {
				const [directory, common] = await Promise.all([
					pi.exec("git", ["rev-parse", "--absolute-git-dir"], { cwd: project, timeout: 5000 }),
					pi.exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: project, timeout: 5000 }),
				]);
				const gitDirectory = directory.stdout.replace(/\r?\n$/u, "");
				const commonDirectory = common.stdout.replace(/\r?\n$/u, "");
				if (directory.code !== 0 || common.code !== 0 || !path.isAbsolute(gitDirectory) || !path.isAbsolute(commonDirectory)) throw new Error(`Cannot inspect native Git worktree scope: ${directory.stderr || common.stderr || "Git did not return absolute directories."}`);
				linkedWorktree = gitDirectory !== commonDirectory;
			}
			if (!stealth) {
				// bd 1.3.1 auto-stages setup files even with --skip-agents, then commits the whole index.
				// ponytail: guard root Markdown because native agents.file can come from global config; narrow when bd exposes a config query without a database.
				const setupPaths = [".claude/settings.json", ".agents", ".codex", ".cursor", ".gitignore"];
				const markdown = readdirSync(project).filter(file => /\.md$/iu.test(file));
				if (outsideGit) {
					if ([...setupPaths, ...markdown].some(file => existsForInitialization(path.join(project, file)))) throw new Error("Native bd init would commit existing setup or Markdown files when creating Git. Save these files in Git first, or choose stealth after initializing Git. No files changed.");
				} else {
					const staged = await pi.exec("git", ["--no-optional-locks", "diff", "--cached", "--name-only", "-z"], { cwd: project, timeout: 5000 });
					if (staged.code !== 0) throw new Error(`Cannot inspect staged files: ${staged.stderr || staged.stdout}`);
					if (staged.stdout) throw new Error("Native bd init would commit your staged files. Commit or unstage them first, or choose stealth. No files changed.");
					const dirty = await pi.exec("git", ["--literal-pathspecs", "--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all", "-z", "--", ...setupPaths, ...markdown], { cwd: project, timeout: 5000 });
					if (dirty.code !== 0) throw new Error(`Cannot inspect files native bd init may commit: ${dirty.stderr || dirty.stdout}`);
					if (dirty.stdout) throw new Error("Native bd init may stage and commit existing setup or root Markdown changes even with --skip-agents. Commit these files first, or choose stealth. No files changed.");
				}
			}
			const args = ["init", "--skip-agents", "--non-interactive", "--sandbox", "--init-if-missing"];
			if (stealth) args.push("--stealth");
			if (!installHooks) args.push("--skip-hooks");
			if (ctx.cwd !== cwd) throw new Error("Project changed before initialization; run /beads init again.");
			// Native bd defaults new worktree data to the main tree; scope only this new-init child to the Integration Project.
			const result = await pi.exec(linkedWorktree ? "env" : "bd", linkedWorktree ? [`BEADS_DIR=${path.join(project, ".beads")}`, "bd", ...args] : args, { cwd: project, timeout: 120_000 });
			const after = await refresh(ctx);
			const diagnostic = [result.stdout, result.stderr].filter(text => text.trim()).join("\n").trim();
			if (result.code !== 0) throw new Error(`bd init refused or failed (exit ${result.code}). ${diagnostic}\n${after ? formatBeadsStatus(after) : "Project changed; run /beads status."}`);
			if (!after || !after.integrationProject || realpathSync(after.integrationProject) !== project || after.workspaceState !== "ready" || after.errors.length) throw new Error(`bd init completed, but resulting workspace is not ready. ${diagnostic}\n${after ? formatBeadsStatus(after) : "Project changed; run /beads status."}`);
			ctx.ui.notify(`Beads workspace initialized; project policy unchanged. Issue operations still require an explicit request.\n${formatBeadsStatus(after)}${result.stderr.trim() ? `\nNative diagnostics:\n${result.stderr.trim()}` : ""}`, result.stderr.trim() ? "warning" : "info");
		} catch (error) {
			await refresh(ctx);
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	};
	pi.registerCommand("beads", {
		description: "Choose a Beads action, or use init|status|auto|off",
		getArgumentCompletions(argumentPrefix) {
			const prefix = argumentPrefix.trim().toLowerCase();
			return COMMAND_CHOICES.filter(choice => choice.operation !== prefix && choice.operation.startsWith(prefix)).map(choice => ({
				value: choice.operation,
				label: `${choice.operation}: ${choice.label}`,
				description: `Tab inserts; Enter runs: ${choice.description}`,
			}));
		},
		handler: async (args, ctx) => {
			let operation = args.trim().toLowerCase();
			if (!operation) {
				if (!ctx.hasUI || typeof ctx.ui.select !== "function") {
					ctx.ui.notify("Beads commands:\n/beads status — Show read-only workspace status.\n/beads init — Reuse a ready workspace, or choose initialization mode and hooks in interactive OMP; standard initialization may commit files.\n/beads auto — Enable project guidance when ready.\n/beads off — Disable only this plugin's project guidance.", "info");
					return;
				}
				const selected = await ctx.ui.select("Beads", COMMAND_CHOICES);
				if (selected === undefined) return;
				const choice = COMMAND_CHOICES.find(value => value.label === selected);
				if (!choice) return;
				operation = choice.operation;
			}
			if (operation === "status") { await showStatus(ctx); return; }
			if (operation === "init") { await initialize(ctx); return; }
			if (operation !== "auto" && operation !== "off") {
				await refresh(ctx);
				ctx.ui.notify("Usage: /beads [init|status|auto|off].", "warning");
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
