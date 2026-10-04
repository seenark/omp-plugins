import * as path from "node:path";
import { isRecord } from "@codesook/omp-shared-display/config-store";

export type CodeGraphInspection = {
	state: "ready" | "uninitialized" | "missing-prerequisite" | "error";
	initialized: boolean;
	projectPath?: string;
	indexPath?: string;
	toolName?: string;
	detail: string;
};
type CommandResult = { code: number; stdout: string; stderr: string };
type Execute = (command: string, args: string[], options: { cwd: string; timeout: number }) => Promise<CommandResult>;
type ConfiguredTool = { name: string; sourceInfo?: { source: string } };

/** Inspect native CLI-selected data. Listing a tool never claims connection health. */
export async function inspectCodeGraph(
	execute: Execute,
	cwd: string,
	tools: readonly ConfiguredTool[],
	activeTools: readonly string[],
): Promise<CodeGraphInspection> {
	let result: CommandResult;
	try {
		result = await execute("codegraph", ["status", "--json", cwd], { cwd, timeout: 10_000 });
	} catch (error) {
		const missing = isRecord(error) && (error.code === "ENOENT" || error.code === "EACCES");
		return { state: missing ? "missing-prerequisite" : "error", initialized: false, detail: `CodeGraph CLI inspection failed: ${error instanceof Error ? error.message : String(error)}. Install CodeGraph and ensure codegraph is executable in PATH.` };
	}
	if (result.code === 126 || result.code === 127) {
		return { state: "missing-prerequisite", initialized: false, detail: "CodeGraph CLI is missing or not executable. Install CodeGraph and ensure codegraph is executable in PATH." };
	}
	if (result.code !== 0) {
		return { state: "error", initialized: false, detail: `CodeGraph project inspection failed (exit ${result.code}): ${(result.stderr || result.stdout).trim()}` };
	}
	let data: unknown;
	try { data = JSON.parse(result.stdout); } catch {
		return { state: "error", initialized: false, detail: "CodeGraph status did not return valid JSON. Check the installed CLI version." };
	}
	if (!isRecord(data) || typeof data.initialized !== "boolean" || typeof data.projectPath !== "string" || !path.isAbsolute(data.projectPath) || typeof data.indexPath !== "string" || !path.isAbsolute(data.indexPath)) {
		return { state: "error", initialized: false, detail: "CodeGraph status returned an unsupported project-data response." };
	}
	const tool = tools.find(candidate => candidate.sourceInfo?.source === "mcp" && /(?:^|__)codegraph_explore$|^mcp_[\w-]+_codegraph_explore$/u.test(candidate.name) && activeTools.includes(candidate.name));
	const scope = { initialized: data.initialized, projectPath: data.projectPath, indexPath: data.indexPath, toolName: tool?.name };
	if (!data.initialized) return { ...scope, state: "uninitialized", detail: "No initialized CodeGraph Tool Workspace. Initialize explicitly with codegraph init; this plugin never initializes projects." };
	if (isRecord(data.index) && data.index.state !== undefined && data.index.state !== "complete") {
		return { ...scope, state: "error", detail: `CodeGraph index is not complete (${String(data.index.state)}). Inspect the project with the CodeGraph CLI.` };
	}
	if (!tool) return { ...scope, state: "missing-prerequisite", detail: "Project data is initialized, but the configured CodeGraph exploration MCP tool is missing or inactive. Configure and enable codegraph_explore in OMP." };
	return { ...scope, state: "ready", toolName: tool.name, detail: "Project-data inspection succeeded; configured CodeGraph exploration MCP tool is active." };
}
