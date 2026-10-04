import * as path from "node:path";
import { isRecord } from "@codesook/omp-shared-display/config-store";

export type BeadsInspection = {
	state: "ready" | "uninitialized" | "missing-prerequisite" | "error";
	initialized: boolean;
	workspacePath?: string;
	databasePath?: string;
	detail: string;
};
export type BeadsCommandResult = { code: number; stdout: string; stderr: string };
export type BeadsExecute = (command: string, args: string[], options: { cwd: string; timeout: number }) => Promise<BeadsCommandResult>;

/** Let bd resolve ancestors, environment overrides, redirects and worktrees. */
export async function inspectBeads(execute: BeadsExecute, cwd: string): Promise<BeadsInspection> {
	const scope: Pick<BeadsInspection, "initialized" | "workspacePath" | "databasePath"> = { initialized: false };
	// `info` suppresses query errors; `count` propagates them and returns no issue content.
	for (const command of ["where", "count"]) {
		let result: BeadsCommandResult;
		try {
			result = await execute("bd", [command, "--json", "--readonly", "--sandbox"], { cwd, timeout: 10_000 });
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
				return { ...scope, state: "uninitialized", initialized: false, detail: "No initialized Beads workspace. Initialize explicitly with bd init; this plugin never initializes projects." };
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
		} else if (!isRecord(data) || data.error !== undefined || typeof data.count !== "number" || !Number.isSafeInteger(data.count) || data.count < 0) {
			return { ...scope, state: "error", detail: "Beads count returned an unsupported database response." };
		}
	}
	return { ...scope, state: "ready", initialized: true, detail: "Native Beads workspace resolved and read-only database query succeeded." };
}
