import { expect, test } from "bun:test";
import { type BeadsCommandResult, inspectBeads } from "./status";

const location = { path: "/external/project/.beads", database_path: "/external/data/embeddeddolt" };
const result = (data: unknown, code = 0, stderr = "") => ({ code, stdout: JSON.stringify(data), stderr });
const summary = (fields: Record<string, number> = {}) => ({ schema_version: 1, summary: { total_issues: 0, closed_issues: 0, deferred_issues: 0, in_progress_issues: 0, ready_issues: 0, ...fields } });

// Fixtures model the native CLI boundary, not directory discovery by the plugin.
test("native location is ready only after a usable database query", async () => {
	const inspect = (query: BeadsCommandResult) => inspectBeads(async (_command, args) => args[0] === "where" ? result(location) : query, "/policy/project/subdir");
	const ready = await inspect(result(summary()));
	expect(ready).toMatchObject({ state: "ready", initialized: true, workspacePath: location.path, databasePath: location.database_path });
	const broken = await inspect(result({ error: "query failed: table issues not found" }, 1));
	expect(broken.state).toBe("error");
	expect(broken.detail).toContain("table issues not found");
	expect(broken.workspacePath).toBe(location.path);
});

test("counts exclude closed and deferred issues and keep in-progress and blocked ones open", async () => {
	const calls: string[][] = [];
	const inspected = await inspectBeads(async (_command, args) => {
		calls.push(args);
		return args[0] === "where" ? result(location) : result(summary({ total_issues: 12, closed_issues: 4, deferred_issues: 2, in_progress_issues: 3, ready_issues: 5 }));
	}, "/project");
	expect(inspected.counts).toEqual({ ready: 5, open: 6, inProgress: 3 });
	expect(calls).toHaveLength(2);
	for (const args of calls) expect(args).toEqual(expect.arrayContaining(["--json", "--readonly", "--sandbox"]));
});

test("only known missing workspace diagnostics mean uninitialized", async () => {
	for (const failure of [
		result({ error: "no_beads_directory", message: "No active beads workspace found." }, 1),
		{ code: 1, stdout: "", stderr: "Error: no beads database found\nHint: run 'bd init'" },
	]) {
		const status = await inspectBeads(async () => failure, "/project");
		expect(status).toMatchObject({ state: "uninitialized", initialized: false });
	}
	const configError = await inspectBeads(async () => ({ code: 1, stdout: "", stderr: "Error: invalid metadata.json" }), "/project");
	expect(configError.state).toBe("error");
	expect(configError.detail).toContain("invalid metadata.json");
	const misleadingHint = await inspectBeads(async () => ({ code: 1, stdout: "", stderr: "Error: corrupt database\nHint: run bd init" }), "/project");
	expect(misleadingHint.state).toBe("error");
});

test("malformed native responses never authorize guidance or escape inspection", async () => {
	for (const stdout of ["not JSON", "null", "[]", '{"path":"relative/.beads"}', '{"path":"/project/.beads","database_path":5}']) {
		const status = await inspectBeads(async () => ({ code: 0, stdout, stderr: "" }), "/project");
		expect(status.state).toBe("error");
	}
	for (const stdout of ["not JSON", '{"count":0}', '{"summary":{}}', JSON.stringify(summary({ total_issues: -1 })), JSON.stringify(summary({ total_issues: 1, closed_issues: 2 })), JSON.stringify(summary({ ready_issues: 0.5 })), JSON.stringify({ ...summary(), error: "query failed" })]) {
		const status = await inspectBeads(async (_command, args) => args[0] === "where" ? result(location) : { code: 0, stdout, stderr: "" }, "/project");
		expect(status.state).toBe("error");
	}
});

test("missing CLI and backend differ from inspection failures at either stage", async () => {
	for (const stage of ["where", "status"]) {
		for (const failure of [
			{ code: 127, stdout: "", stderr: "bd: command not found" },
			{ code: 126, stdout: "", stderr: "bd: permission denied" },
			result({ error: 'exec: "dolt": executable file not found in $PATH' }, 1),
			result({ error: "dial tcp 127.0.0.1:3307: connect: connection refused" }, 1),
		]) {
			const status = await inspectBeads(async (_command, args) => args[0] === stage ? failure : result(location), "/project");
			expect(status.state).toBe("missing-prerequisite");
		}
		for (const [code, state] of [["ENOENT", "missing-prerequisite"], ["EACCES", "missing-prerequisite"], ["ETIMEDOUT", "error"]] as const) {
			const status = await inspectBeads(async (_command, args) => {
				if (args[0] === stage) throw Object.assign(new Error("cannot inspect"), { code });
				return result(location);
			}, "/project");
			expect(status.state).toBe(state);
			expect(status.detail).toContain("cannot inspect");
		}
	}
});

test("warnings do not hide native backend errors", async () => {
	const missingBackend = await inspectBeads(async (_command, args) => args[0] === "where" ? result(location) : result({
		error: "dial tcp 127.0.0.1:3307: connect: connection refused",
	}, 1, "Warning: workspace permissions"), "/project");
	expect(missingBackend.state).toBe("missing-prerequisite");
	expect(missingBackend.detail).toContain("connection refused");
});
