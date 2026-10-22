import * as path from "node:path";
import { isRecord } from "@codesook/omp-shared-display/config-store";

export type BeadsCounts = { ready: number; open: number; inProgress: number };
export type BeadsInspection = {
	state: "ready" | "uninitialized" | "missing-prerequisite" | "error";
	initialized: boolean;
	workspacePath?: string;
	databasePath?: string;
	counts?: BeadsCounts;
	detail: string;
};
export const DEFAULT_BEADS_TEMPLATE = "Beads: {ready} ready · {open} open";
export type BeadsCommandResult = { code: number; stdout: string; stderr: string };
export type BeadsExecute = (command: string, args: string[], options: { cwd: string; timeout: number }) => Promise<BeadsCommandResult>;

export function resolveBeadsTemplate(display: unknown): string {
	const template = isRecord(display) ? display.template : undefined;
	return typeof template === "string" && template.trim() !== "" && !/[\r\n]/u.test(template) ? template : DEFAULT_BEADS_TEMPLATE;
}

/** The one place segment text is decided: counts replace the state word only for a Ready Integration with open issues. */
export function renderBeadsSegment(state: string, counts: BeadsCounts | undefined, template: string): string {
	if (state !== "ready" || !counts || counts.open === 0) return `Beads: ${state}`;
	return template.replace(/\{(ready|open|inProgress)\}/g, (_match, token: keyof BeadsCounts) => String(counts[token]));
}

function parseCounts(data: unknown): BeadsCounts | undefined {
	const summary = isRecord(data) && isRecord(data.summary) ? data.summary : undefined;
	if (!summary) return undefined;
	const numbers = ["total_issues", "closed_issues", "deferred_issues", "in_progress_issues", "ready_issues"].map(key => summary[key]);
	if (!numbers.every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) return undefined;
	const [total, closed, deferred, inProgress, ready] = numbers as number[];
	const open = total! - closed! - deferred!;
	return open < 0 ? undefined : { ready: ready!, open, inProgress: inProgress! };
}

/** Let bd resolve ancestors, environment overrides, redirects and worktrees. */
export async function inspectBeads(execute: BeadsExecute, cwd: string): Promise<BeadsInspection> {
	const scope: Pick<BeadsInspection, "initialized" | "workspacePath" | "databasePath"> = { initialized: false };
	let counts: BeadsCounts | undefined;
	// `info` suppresses query errors; `status` propagates them and also carries every count the Status Segment needs.
	for (const [command, ...extra] of [["where"], ["status", "--no-activity"]] as const) {
		let result: BeadsCommandResult;
		try {
			result = await execute("bd", [command, "--json", ...extra, "--readonly", "--sandbox"], { cwd, timeout: 10_000 });
		} catch (error) {
			const missing = isRecord(error) && (error.code === "ENOENT" || error.code === "EACCES");
			return {
				...scope,
				state: missing ? "missing-prerequisite" : "error",
				detail: `Beads ${command} inspection failed: ${error instanceof Error ? error.message : String(error)}.${missing ? " Ensure bd is executable in PATH." : ""}`,
			};
		}
		let data: unknown;
		try { data = JSON.parse(result.stdout); } catch { /* Native failures can be plain text; malformed success fails closed. */ }
		if (result.code !== 0) {
			const diagnostic = `${result.stderr}\n${isRecord(data) && typeof data.error === "string" ? data.error : result.stdout}`.trim();
			if (result.code === 126 || result.code === 127) {
				return { ...scope, state: "missing-prerequisite", detail: "Beads CLI is missing or not executable. Ensure bd is executable in PATH." };
			}
			if ((isRecord(data) && data.error === "no_beads_directory") || /^(?:Error: )?no beads database found(?:\r?\n|$)/imu.test(diagnostic)) {
				return { ...scope, state: scope.workspacePath ? "error" : "uninitialized", initialized: false, detail: scope.workspacePath ? "Native Beads workspace exists, but its database is not usable. Inspect or repair it with bd; initialization will not replace existing data." : "No initialized Beads workspace. Run /beads init for explicit mode and hook choices, or initialize directly with bd init." };
			}
			const missingBackend = /\bdolt(?: binary| executable)?(?: is)? (?:not (?:found|installed)|missing)|exec: ["']?dolt["']?: executable file not found|(?:dial (?:tcp|unix)[^\n]*|connect:) connection refused/iu.test(diagnostic);
			return {
				...scope,
				state: missingBackend ? "missing-prerequisite" : "error",
				detail: `Beads ${command} inspection failed (exit ${result.code}): ${diagnostic}${missingBackend ? " Make the configured Beads backend available; this plugin never installs or provisions it." : ""}`,
			};
		}
		if (command === "where") {
			if (!isRecord(data) || data.error !== undefined || typeof data.path !== "string" || !path.isAbsolute(data.path) || (data.database_path !== undefined && (typeof data.database_path !== "string" || !path.isAbsolute(data.database_path)))) {
				return { ...scope, state: "error", detail: "Beads where returned an unsupported workspace response." };
			}
			scope.workspacePath = data.path;
			scope.databasePath = typeof data.database_path === "string" ? data.database_path : undefined;
			scope.initialized = Boolean(scope.databasePath);
		} else {
			counts = parseCounts(data);
			if (!isRecord(data) || data.error !== undefined || !counts) {
				return { ...scope, state: "error", detail: "Beads status returned an unsupported database response." };
			}
		}
	}
	return { ...scope, state: "ready", initialized: true, counts, detail: "Native Beads workspace resolved and read-only database query succeeded." };
}
