import type {
	ExtensionContext,
	SessionStopEvent,
	SessionStopEventResult,
	ToolResultEvent,
	ToolResultEventResult,
} from "@oh-my-pi/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { warningsEnabled, type BehaviorStore } from "./behavior.ts";
import { findLaneAgent } from "./roles.ts";
import type { RunReader } from "./run-state.ts";
import {
	checkpointWarning,
	checkpointWritten,
	doneWithoutProofWarning,
	doneWithoutRuntimeProof,
	missingSteps,
	missingStepsWarning,
	narratingComments,
	narratingCommentsWarning,
	playbookSteps,
	requiresCheckpoint,
	todoInitItems,
} from "./warnings.ts";

export interface WarningGuards {
	/** Tool-result context for narrating comments and a todo list that skips playbook steps. */
	onToolResult(event: ToolResultEvent, ctx: ExtensionContext): Promise<ToolResultEventResult | undefined>;
	/** At most one continuation per stop: the throughput checkpoint and a done claim without runtime proof. */
	onSessionStop(event: SessionStopEvent, ctx: ExtensionContext): Promise<SessionStopEventResult | undefined>;
	/** Forget what was already said; call when the session's branch is replaced. */
	reset(): void;
}

const PLAYBOOK_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Non-blocking style signals. They speak only in sessions where the run is active, or from a pstack lane,
 * and never at strictness `off`. Strictness is read live from the Behavior Configuration.
 */
export function createWarningGuards(options: { behavior: BehaviorStore; runs: RunReader; skillDirectory: string }): WarningGuards {
	const { behavior, runs, skillDirectory } = options;
	let checkpointWarned = false;

	const readPlaybook = async (name: string): Promise<string | undefined> =>
		PLAYBOOK_NAME.test(name) ? fs.readFile(path.join(skillDirectory, "playbooks", `${name}.md`), "utf8").catch(() => undefined) : undefined;

	return {
		async onToolResult(event, ctx) {
			if (event.isError || !warningsEnabled(behavior.current().guardStrictness)) return undefined;
			const { active, playbook } = runs.state();
			const lane = findLaneAgent(ctx.agent?.name ?? "") !== undefined;
			if (!active && !lane) return undefined;

			const warnings: string[] = [];
			const comments = narratingComments(event.toolName, event.input);
			if (comments.length > 0) warnings.push(narratingCommentsWarning(comments));

			const items = event.toolName === "todo" ? todoInitItems(event.input) : undefined;
			const text = active && items !== undefined && playbook !== undefined ? await readPlaybook(playbook) : undefined;
			if (items !== undefined && playbook !== undefined && text !== undefined) {
				const missing = missingSteps(items, playbookSteps(text));
				if (missing.length > 0) warnings.push(missingStepsWarning(playbook, missing));
			}
			return warnings.length === 0 ? undefined : { additionalContext: warnings.join("\n\n") };
		},

		async onSessionStop(event, ctx) {
			const { active, playbook } = runs.state();
			// `stop_hook_active` marks the turn this hook asked for: one nudge per stop keeps clear of OMP's cap of 8 continuations.
			if (!active || event.stop_hook_active || !warningsEnabled(behavior.current().guardStrictness)) return undefined;

			const warnings: string[] = [];
			const playbookText = !checkpointWarned && playbook !== undefined ? await readPlaybook(playbook) : undefined;
			if (playbookText !== undefined && requiresCheckpoint(playbookText)) {
				const history = ctx.sessionManager.getBranch().flatMap(entry => (entry.type === "message" ? [entry.message] : []));
				if (!checkpointWritten([...history, ...event.messages])) {
					checkpointWarned = true;
					warnings.push(checkpointWarning);
				}
			}
			if (doneWithoutRuntimeProof(event.messages)) warnings.push(doneWithoutProofWarning);
			return warnings.length === 0 ? undefined : { continue: true, additionalContext: warnings.join("\n\n") };
		},

		reset() {
			checkpointWarned = false;
		},
	};
}
