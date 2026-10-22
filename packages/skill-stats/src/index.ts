import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { isRecord } from "@codesook/omp-shared-display/config-store";
import { resolveIntegrationProject } from "@codesook/omp-shared-display/project-integrations";
import { SKILL_USE_EVENT, parseSkillUseEvent } from "@codesook/omp-shared-display/skill-use";
import { skillNamesInToolCall, skillPromptSource, toolCallSource } from "./detect.ts";
import { scanSessionHistory } from "./history.ts";
import { showReportOverlay } from "./overlay.ts";
import { renderReport } from "./report.ts";
import { classifySkillPath, describeSkill, projectScope, sameScope, skillEnv } from "./skills.ts";
import {
	GLOBAL_STORE_DIR,
	appendUse,
	commitImports,
	ensureStore,
	projectStoreDir,
	readMeta,
	readUses,
	resetStore,
	type ImportBatch,
} from "./store.ts";
import type { Scope, SkillInfo, SkillUse, SkillUseSource } from "./types.ts";

export type SkillStatsOptions = {
	home?: string;
	globalStoreDir?: string;
	sessionsRoot?: string;
	now?: () => Date;
	/** Project folder a `/skill-stats project` dashboard covers; default is the Integration Project of the cwd. */
	resolveProject?: (cwd: string) => Promise<string>;
};

const USAGE = "Usage: /skill-stats [project] | [project] reset [skill] | import";
const SKILL_COMMAND_PREFIX = "skill:";
const SKILL_PROMPT_TYPE = "skill-prompt";
const GLOBAL_SCOPE: Scope = { kind: "global" };

/** Record every Skill Use (user, agent, subagent) and show `/skill-stats` dashboards. */
export default function skillStatsExtension(pi: ExtensionAPI, options: SkillStatsOptions = {}): void {
	const home = options.home ?? os.homedir();
	const globalDir = options.globalStoreDir ?? GLOBAL_STORE_DIR;
	const sessionsRoot = options.sessionsRoot ?? path.join(home, ".omp", "agent", "sessions");
	const clock = options.now ?? (() => new Date());
	const resolveProject = options.resolveProject ?? resolveIntegrationProject;
	let activeContext: ExtensionContext | undefined;
	let warned = false;

	const storeDir = (scope: Scope): string => (scope.kind === "global" ? globalDir : projectStoreDir(scope.root));

	const warnOnce = (message: string): void => {
		if (warned) return;
		warned = true;
		try {
			pi.logger.warn(message);
		} catch {
			// Recording must never take down the agent, and some hosts have no logger.
		}
	};

	const record = (ctx: ExtensionContext | undefined, name: string, skillPath: string, source: SkillUseSource): void => {
		const now = clock();
		const resolved = path.resolve(skillPath);
		const scope = classifySkillPath(resolved, home);
		try {
			const dir = storeDir(scope);
			ensureStore(dir, now, { gitignore: scope.kind === "project" });
			appendUse(dir, { at: now.toISOString(), name, path: resolved, source, session: ctx?.sessionManager.getSessionId() ?? "unknown" });
		} catch (error) {
			warnOnce(`skill-stats could not record ${name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	};

	const installedSkills = (): SkillInfo[] => {
		const env = skillEnv(home);
		try {
			return pi.getCommands().flatMap(command =>
				command.source === "skill" && command.name.startsWith(SKILL_COMMAND_PREFIX) && command.path !== undefined
					? [describeSkill(command.name.slice(SKILL_COMMAND_PREFIX.length), command.path, env)]
					: [],
			);
		} catch {
			return [];
		}
	};

	// `ctx.agent` exists from OMP 18.3.2; an older host has none, so its session counts as the main agent.
	const isSubagent = (ctx: ExtensionContext): boolean => "agent" in ctx && isRecord(ctx.agent) && ctx.agent.kind === "sub";

	pi.on("session_start", (_event, ctx) => void (activeContext = ctx));
	pi.on("session_switch", (_event, ctx) => void (activeContext = ctx));
	pi.on("session_branch", (_event, ctx) => void (activeContext = ctx));

	pi.on("message_start", (event, ctx) => {
		activeContext = ctx;
		const message: unknown = event.message;
		if (!isRecord(message) || message.customType !== SKILL_PROMPT_TYPE || !isRecord(message.details)) return;
		const { name, path: skillPath } = message.details;
		if (typeof name !== "string" || typeof skillPath !== "string") return;
		record(ctx, name, skillPath, skillPromptSource(message.attribution, isSubagent(ctx)));
	});

	pi.on("tool_call", (event, ctx) => {
		activeContext = ctx;
		const names = skillNamesInToolCall(event.toolName, event.input);
		if (names.length === 0) return;
		const installed = new Map(installedSkills().map(skill => [skill.name, skill.path]));
		for (const name of names) {
			const skillPath = installed.get(name);
			if (skillPath !== undefined) record(ctx, name, skillPath, toolCallSource(isSubagent(ctx)));
		}
	});

	const unsubscribe = pi.events.on(SKILL_USE_EVENT, data => {
		const use = parseSkillUseEvent(data);
		if (use !== undefined) record(activeContext, use.name, use.path, use.source);
	});
	pi.on("session_shutdown", () => unsubscribe());

	const notify = (ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void => ctx.ui.notify(message, level);

	const copyToClipboard = async (text: string, write: (data: string) => void): Promise<string> => {
		let osc52 = false;
		try {
			write(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`);
			osc52 = true;
		} catch {
			// Fall through to pbcopy.
		}
		let pbcopy = false;
		try {
			pbcopy = (await pi.exec("sh", ["-c", 'printf %s "$1" | pbcopy', "sh", text], { timeout: 3000 })).code === 0;
		} catch {
			// pbcopy is missing off macOS.
		}
		if (pbcopy) return "Copied with pbcopy.";
		return osc52 ? "Sent to the terminal clipboard (OSC 52); the terminal may ignore it." : "Could not copy.";
	};

	const showReport = async (ctx: ExtensionContext, project: boolean): Promise<void> => {
		const projectFolder = project ? await resolveProject(ctx.cwd) : undefined;
		const scope = projectFolder === undefined ? GLOBAL_SCOPE : projectScope(projectFolder);
		const dir = storeDir(scope);
		const report = renderReport({
			title: projectFolder === undefined ? "Skill stats: Global Skills" : `Skill stats: Project Skills of ${projectFolder}`,
			scope,
			meta: readMeta(dir),
			uses: readUses(dir),
			installed: installedSkills(),
			env: skillEnv(home),
			now: clock(),
		});
		if (!ctx.hasUI || typeof ctx.ui.custom !== "function") notify(ctx, report.lines.join("\n"));
		else await showReportOverlay(ctx, report, copyToClipboard);
	};

	const scopeOf = async (ctx: ExtensionContext, project: boolean): Promise<Scope> =>
		project ? projectScope(await resolveProject(ctx.cwd)) : GLOBAL_SCOPE;

	const reset = async (ctx: ExtensionContext, project: boolean, skill: string | undefined): Promise<void> => {
		const installed = installedSkills();
		const scope = project ? await scopeOf(ctx, true) : (installed.find(info => info.name === skill)?.scope ?? GLOBAL_SCOPE);
		const dir = storeDir(scope);
		const label = scope.kind === "global" ? "Global" : "Project";
		const known = installed.some(info => info.name === skill && sameScope(info.scope, scope)) || readUses(dir).some(use => use.name === skill);
		if (skill !== undefined && !known) {
			notify(ctx, `No ${label} Skill named "${skill}" is installed or recorded. ${USAGE}`, "warning");
			return;
		}
		const target = skill ?? `all ${label} Skills`;
		if (!(await ctx.ui.confirm("Reset skill stats?", `Start counting ${target} again from now. Recorded uses are kept.`))) {
			notify(ctx, "Reset cancelled.");
			return;
		}
		const now = clock();
		ensureStore(dir, now, { gitignore: scope.kind === "project" });
		resetStore(dir, skill, now);
		notify(ctx, `Reset point set for ${target}. No records were deleted.`);
	};

	type StorePlan = { dir: string; recordingStartedAt: number; uses: SkillUse[] };
	type StoreSkip = "project-missing" | "already-imported";

	const importHistory = async (ctx: ExtensionContext): Promise<void> => {
		const before = readMeta(globalDir);
		if (before?.importedAt !== undefined) {
			notify(ctx, `Session history was already imported on ${before.importedAt.slice(0, 10)}. Import runs once.`, "warning");
			return;
		}
		const now = clock();
		const env = skillEnv(home);
		const globalPlan: StorePlan = { dir: globalDir, recordingStartedAt: Date.parse(ensureStore(globalDir, now, { gitignore: false }).recordingStartedAt), uses: [] };
		const scan = await scanSessionHistory(sessionsRoot, new Map(installedSkills().map(skill => [skill.name, skill.path])));

		const stores = new Map<string, StorePlan | StoreSkip>([[globalDir, globalPlan]]);
		const planFor = (scope: Scope): StorePlan | StoreSkip => {
			const dir = storeDir(scope);
			let plan = stores.get(dir);
			if (plan === undefined) {
				if (scope.kind === "project" && !existsSync(scope.root)) plan = "project-missing";
				else if (readMeta(dir)?.importedAt !== undefined) plan = "already-imported";
				else plan = { dir, recordingStartedAt: Date.parse(ensureStore(dir, now, { gitignore: scope.kind === "project" }).recordingStartedAt), uses: [] };
				stores.set(dir, plan);
			}
			return plan;
		};
		const counts = { global: 0, project: 0, "project-missing": 0, "already-imported": 0, afterStart: 0 };
		for (const use of scan.uses) {
			const scope = classifySkillPath(use.path, env.home);
			const plan = planFor(scope);
			if (typeof plan === "string") counts[plan] += 1;
			else if (Date.parse(use.at) >= plan.recordingStartedAt) counts.afterStart += 1;
			else {
				plan.uses.push(use);
				counts[scope.kind] += 1;
			}
		}

		const batches: ImportBatch[] = [...stores.values()].filter((plan): plan is StorePlan => typeof plan !== "string");
		try {
			commitImports(batches, now);
		} catch (error) {
			notify(ctx, `Import failed; nothing was imported: ${error instanceof Error ? error.message : String(error)}`, "error");
			return;
		}
		const skipped = [
			[counts["project-missing"], "skipped (project folder missing)"],
			[counts["already-imported"], "skipped (already imported)"],
			[counts.afterStart, "skipped (after recording started)"],
			[scan.unresolved, "unresolved (skill:// read with no SKILL.md found)"],
			[scan.badTimestamps, "with unreadable timestamps"],
		]
			.filter(([count]) => count !== 0)
			.map(([count, label]) => `${count} ${label}`);
		notify(
			ctx,
			[
				`Imported ${counts.global + counts.project} Skill Uses from ${scan.sessions} session files (${counts.global} global, ${counts.project} project).`,
				`Skipped: ${skipped.length > 0 ? skipped.join(", ") : "none"}.`,
			].join("\n"),
		);
	};

	pi.registerCommand("skill-stats", {
		description: USAGE,
		getArgumentCompletions: prefix => {
			const typed = prefix.trimStart().toLowerCase();
			const matches = ["project", "reset", "import", "project reset"].filter(value => value.startsWith(typed));
			return matches.length > 0 ? matches.map(value => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const tokens = args.trim().split(/\s+/u).filter(Boolean);
			const project = tokens[0] === "project";
			if (project) tokens.shift();
			const [subcommand, skill, ...extra] = tokens;
			try {
				if (subcommand === undefined) await showReport(ctx, project);
				else if (subcommand === "reset" && extra.length === 0) await reset(ctx, project, skill);
				else if (subcommand === "import" && !project && skill === undefined) await importHistory(ctx);
				else notify(ctx, USAGE, "warning");
			} catch (error) {
				notify(ctx, `skill-stats failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
