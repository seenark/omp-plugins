import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolCallEventResult } from "@oh-my-pi/pi-coding-agent";
import { isRecord } from "@codesook/omp-shared-display/config-store";
import { blocksEnabled, warningsEnabled, type GuardStrictness } from "../behavior.ts";
import { findLaneAgent } from "../roles.ts";
import { findInPlaceEdits } from "./shell.ts";

/** Tools that change state outside `local://`, whatever their arguments. `write` and `lsp` are judged by their input. */
const MUTATING_TOOLS: ReadonlySet<string> = new Set(["edit", "ast_edit", "bash", "eval", "debug", "memory_edit", "manage_skill"]);
const SCRATCH_PREFIX = "local://";

export type BlockingGuard = "read-only-lane" | "lane-spawn" | "in-place-edit";

/** An action a blocking guard stops. `reason` goes back to the model and names the tool to use instead. */
export interface GuardFinding {
	guard: BlockingGuard;
	reason: string;
}

/** What the guards need to know about one `tool_call`. */
export interface GuardCall {
	toolName: string;
	input: unknown;
	/** Lowercased agent definition name from `ctx.agent.name`. */
	agentName: string;
	/** pstack is active in this session (run state). */
	runActive: boolean;
	/** Working directory of the session. */
	cwd: string;
}

/** Asks git whether a path belongs to a repository. Injectable so tests need no repository. */
export interface RepositoryProbe {
	/** `pattern` (absolute path or pathspec glob) names a file git tracks or would track: inside a work tree and not ignored. */
	containsFile(pattern: string): Promise<boolean>;
	/** `directory` is inside a git work tree. */
	isInside(directory: string): Promise<boolean>;
}

function git(directory: string, args: string[]): Promise<string | undefined> {
	return new Promise(resolve => {
		execFile("git", ["-C", directory, ...args], { timeout: 5000 }, (error, stdout) => resolve(error ? undefined : stdout));
	});
}

function nearestExistingDirectory(target: string): string {
	let directory = path.dirname(target);
	while (!fs.existsSync(directory) && path.dirname(directory) !== directory) directory = path.dirname(directory);
	return directory;
}

export const gitRepositoryProbe: RepositoryProbe = {
	async containsFile(pattern) {
		const listed = await git(nearestExistingDirectory(pattern), ["ls-files", "--cached", "--others", "--exclude-standard", "--", pattern]);
		return listed !== undefined && listed.trim() !== "";
	},
	async isInside(directory) {
		return (await git(directory, ["rev-parse", "--is-inside-work-tree"]))?.trim() === "true";
	},
};

function stringField(input: unknown, key: string): string | undefined {
	return isRecord(input) && typeof input[key] === "string" ? input[key] : undefined;
}

function mutatesState(call: GuardCall): boolean {
	if (MUTATING_TOOLS.has(call.toolName)) return true;
	if (call.toolName === "write") return !(stringField(call.input, "path") ?? "").startsWith(SCRATCH_PREFIX);
	if (call.toolName === "lsp") {
		const action = stringField(call.input, "action");
		return action === "rename" || action === "rename_file" || (isRecord(call.input) && call.input.apply === true);
	}
	return false;
}

function readOnlyLaneFinding(call: GuardCall): GuardFinding | undefined {
	if (findLaneAgent(call.agentName)?.access !== "read-only" || !mutatesState(call)) return undefined;
	return {
		guard: "read-only-lane",
		reason: `${call.agentName} is a read-only pstack lane, so \`${call.toolName}\` is blocked. Do not change files or state: put the change you propose in your report. \`write\` is allowed only for local:// scratch files.`,
	};
}

function laneSpawnFinding(call: Pick<GuardCall, "agentName">): GuardFinding | undefined {
	if (findLaneAgent(call.agentName) === undefined) return undefined;
	return {
		guard: "lane-spawn",
		reason: `${call.agentName} is a pstack lane and may not spawn agents. Do the assigned work yourself with your own tools and report back to the parent.`,
	};
}

async function inPlaceEditFinding(call: GuardCall, probe: RepositoryProbe): Promise<GuardFinding | undefined> {
	if (call.toolName !== "bash") return undefined;
	if (!call.runActive && findLaneAgent(call.agentName) === undefined) return undefined;
	const command = stringField(call.input, "command");
	if (command === undefined) return undefined;
	const cwd = path.resolve(call.cwd, stringField(call.input, "cwd") ?? ".");
	for (const edit of findInPlaceEdits(command, cwd)) {
		const inRepository = edit.unresolved ? await probe.isInside(cwd) : await anyFile(edit.files, probe);
		if (inRepository) {
			return {
				guard: "in-place-edit",
				reason: `\`${edit.tool} -i\` rewrites repository source behind the editor's back. Use the \`edit\` tool for a text change, or \`ast_edit\` for a structural one.`,
			};
		}
	}
	return undefined;
}

async function anyFile(files: readonly string[], probe: RepositoryProbe): Promise<boolean> {
	for (const file of files) if (await probe.containsFile(file)) return true;
	return false;
}

/** The first blocking guard `call` trips, or undefined. Guards run in pstack lanes always and elsewhere only while pstack is active. */
export async function blockingFinding(call: GuardCall, probe: RepositoryProbe = gitRepositoryProbe): Promise<GuardFinding | undefined> {
	if (call.toolName === "task") {
		const spawn = laneSpawnFinding(call);
		if (spawn) return spawn;
	}
	return readOnlyLaneFinding(call) ?? (await inPlaceEditFinding(call, probe));
}

/** `before_subagent_spawn` fails open on timeout, so the lane's `task` tool call is guarded as well. */
export function spawnFinding(agentName: string): GuardFinding | undefined {
	return laneSpawnFinding({ agentName });
}

/** What strictness does with a finding: block it, let it through with a warning, or ignore it. */
export function toolCallResult(finding: GuardFinding | undefined, strictness: GuardStrictness): ToolCallEventResult | undefined {
	if (!finding) return undefined;
	if (blocksEnabled(strictness)) return { block: true, reason: finding.reason };
	if (warningsEnabled(strictness)) return { additionalContext: `pstack guard (warning, not blocked): ${finding.reason}` };
	return undefined;
}
