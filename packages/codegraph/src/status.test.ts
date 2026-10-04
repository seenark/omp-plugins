import { expect, test } from "bun:test";
import { inspectCodeGraph } from "./status";

const initialized = JSON.stringify({ initialized: true, projectPath: "/tools/project", indexPath: "/data/codegraph", index: { state: "complete" }, fileCount: 2 });
const tools = [{ name: "mcp__codegraph_explore", sourceInfo: { source: "mcp" } }];

test("usable native project data requires an active configured MCP exploration tool", async () => {
	const execute = async () => ({ code: 0, stdout: initialized, stderr: "" });
	const missing = await inspectCodeGraph(execute, "/policy/project", tools, []);
	expect(missing.state).toBe("missing-prerequisite");
	expect(missing.initialized).toBe(true);
	expect(missing.projectPath).toBe("/tools/project");
	const ready = await inspectCodeGraph(execute, "/policy/project", tools, [tools[0]!.name]);
	expect(ready.state).toBe("ready");
	expect(ready.toolName).toBe("mcp__codegraph_explore");
});

test("missing CLI is a missing prerequisite, not an inspection failure", async () => {
	const status = await inspectCodeGraph(async () => ({ code: 127, stdout: "", stderr: "codegraph: command not found" }), "/project", tools, [tools[0]!.name]);
	expect(status.state).toBe("missing-prerequisite");
	expect(status.detail).toContain("PATH");
});

test("folder-only data, incomplete indexes and malformed inspection do not authorize guidance", async () => {
	for (const [stdout, expected] of [
		[JSON.stringify({ initialized: false, projectPath: "/project", indexPath: "/project/.codegraph" }), "uninitialized"],
		[JSON.stringify({ initialized: true, projectPath: "/project", indexPath: "/project/.codegraph", index: { state: "building" } }), "error"],
		[JSON.stringify({ initialized: true }), "error"],
		["not JSON", "error"],
	] as const) {
		const status = await inspectCodeGraph(async () => ({ code: 0, stdout, stderr: "" }), "/project", tools, [tools[0]!.name]);
		expect(status.state).toBe(expected);
		if (expected === "uninitialized") expect(status.toolName).toBe("mcp__codegraph_explore");
	}
	const extensionTool = [{ name: "mcp__codegraph_explore", sourceInfo: { source: "extension" } }];
	const impostor = await inspectCodeGraph(async () => ({ code: 0, stdout: initialized, stderr: "" }), "/project", extensionTool, [extensionTool[0]!.name]);
	expect(impostor.state).toBe("missing-prerequisite");
});
