import * as fs from "node:fs";
import * as path from "node:path";
import { FINDING_SEVERITIES, LANE_AGENTS, VERDICTS, type LaneAgent } from "./roles.ts";

export const AGENTS_DIRECTORY = path.resolve(import.meta.dir, "..", "agents");

/** Agent files with this prefix are generated; other files in `agents/` (vendored agents) are never touched. */
const GENERATED_PREFIX = "pstack-";

const CRITIC_OUTPUT = {
	properties: {
		verdict: { metadata: { description: "Overall verdict for the reviewed work" }, enum: [...VERDICTS] },
		summary: { metadata: { description: "One to three plain sentences backing the verdict" }, type: "string" },
		findings: {
			metadata: { description: "Every issue found; empty when the verdict is approve" },
			elements: {
				properties: {
					severity: { metadata: { description: "How bad the issue is" }, enum: [...FINDING_SEVERITIES] },
					file: { metadata: { description: "Path of the affected file" }, type: "string" },
					line: { metadata: { description: "First affected line, 1-indexed" }, type: "number" },
					claim: { metadata: { description: "What is wrong, in one sentence" }, type: "string" },
					evidence: { metadata: { description: "What you read or ran that proves the claim" }, type: "string" },
				},
			},
		},
	},
};

const READ_ONLY_RULE =
	"You are a read-only lane. Your tool allowlist is a hard boundary. Never modify a file, never run a command that changes state, and never reach for another tool to do either. If the task needs a change, describe it in your report instead.";

const NO_SPAWN_RULE =
	"Do not spawn agents, choose another model, or start a pstack workflow. Execute only the task and path scope the parent assigned, and read the grounding artifacts it names by path.";

function body(agent: LaneAgent): string {
	const parts: string[] = [`# ${agent.name}`, agent.description, NO_SPAWN_RULE];
	if (agent.access === "read-only") parts.push(READ_ONLY_RULE);
	if (agent.kind === "critic") {
		parts.push(
			"Judge the work you were pointed at on its merits. Support every finding with a file, a line and evidence you actually read. Finish by yielding the structured verdict: approve when you found nothing worth blocking, concerns when the work can ship with fixes, reject when it must not ship as is.",
		);
	}
	if (agent.kind === "builder") {
		parts.push(
			"Work only inside the isolated worktree the parent gave you. If it is not isolated, stop and say so. Return what you built and how you checked it, so the parent can compare it with the other builders.",
		);
	}
	if (agent.kind === "work" && agent.access === "write") {
		parts.push("Make the change, run the checks the parent named, and report what you changed and what you observed.");
	}
	return parts.join("\n\n");
}

export function renderAgent(agent: LaneAgent): string {
	const lines = [
		"---",
		`name: ${agent.name}`,
		`description: ${JSON.stringify(agent.description)}`,
		`model: ${JSON.stringify(agent.model)}`,
		`tools: ${agent.tools.join(", ")}`,
	];
	if (agent.kind === "critic") {
		lines.push("structured: true", `output: ${JSON.stringify(CRITIC_OUTPUT)}`);
	}
	lines.push("---", "", body(agent), "");
	return lines.join("\n");
}

export function generatedAgents(): Map<string, string> {
	return new Map(LANE_AGENTS.map(agent => [`${agent.name}.md`, renderAgent(agent)]));
}

/** True for a package-relative path (`agents/pstack-build.md`) that the role table owns, not sync. */
export function isGeneratedAgent(file: string): boolean {
	const name = path.posix.basename(file);
	return path.posix.dirname(file) === "agents" && name.startsWith(GENERATED_PREFIX) && name.endsWith(".md");
}

function ownedFiles(directory: string): string[] {
	if (!fs.existsSync(directory)) return [];
	return fs.readdirSync(directory).filter(file => file.startsWith(GENERATED_PREFIX) && file.endsWith(".md"));
}

/** Describe every way `directory` differs from the role table; empty when it matches. */
export function agentDrift(directory: string = AGENTS_DIRECTORY): string[] {
	const expected = generatedAgents();
	const problems: string[] = [];
	for (const [file, content] of expected) {
		const target = path.join(directory, file);
		if (!fs.existsSync(target)) problems.push(`missing ${file}`);
		else if (fs.readFileSync(target, "utf8") !== content) problems.push(`differs from role table: ${file}`);
	}
	for (const file of ownedFiles(directory)) {
		if (!expected.has(file)) problems.push(`not in role table: ${file}`);
	}
	return problems;
}

/** Make `directory` match the role table. Returns the files it changed; a second call returns none. */
export function writeAgents(directory: string = AGENTS_DIRECTORY): string[] {
	const expected = generatedAgents();
	const changed: string[] = [];
	fs.mkdirSync(directory, { recursive: true });
	for (const [file, content] of expected) {
		const target = path.join(directory, file);
		if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === content) continue;
		fs.writeFileSync(target, content);
		changed.push(file);
	}
	for (const file of ownedFiles(directory)) {
		if (expected.has(file)) continue;
		fs.rmSync(path.join(directory, file));
		changed.push(file);
	}
	return changed;
}
