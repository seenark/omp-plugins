import { expect, test } from "bun:test";
import { type BeadsCommandResult, inspectBeads } from "./status";

const location = { path: "/external/project/.beads", database_path: "/external/data/embeddeddolt" };
const result = (data: unknown, code = 0, stderr = "") => ({ code, stdout: JSON.stringify(data), stderr });

// Fixtures model the native CLI boundary, not directory discovery by the plugin.
test("native location is ready only after a usable database query", async () => {
	const inspect = (query: BeadsCommandResult) => inspectBeads(async (_command, args) => args[0] === "where" ? result(location) : query, "/policy/project/subdir");
	const ready = await inspect(result({ count: 0, schema_version: 1 }));
	expect(ready).toMatchObject({ state: "ready", initialized: true, workspacePath: location.path, databasePath: location.database_path });
	const broken = await inspect(result({ error: "query failed: table issues not found" }, 1));
	expect(broken.state).toBe("error");
	expect(broken.detail).toContain("table issues not found");
	expect(broken.workspacePath).toBe(location.path);
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
	for (const stdout of ["not JSON", '{"count":-1}', '{"count":"0"}', '{"count":0.5}', '{"count":0,"error":"query failed"}']) {
		const status = await inspectBeads(async (_command, args) => args[0] === "where" ? result(location) : { code: 0, stdout, stderr: "" }, "/project");
		expect(status.state).toBe("error");
	}
});

test("missing CLI and backend differ from inspection failures at either stage", async () => {
	for (const stage of ["where", "count"]) {
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
