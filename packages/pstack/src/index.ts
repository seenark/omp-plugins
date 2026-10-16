import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { connectSharedDisplay } from "@codesook/omp-shared-display/client";
import {
	buildPotetoPrompt,
	DEFAULT_POTETO_DIRECTORY,
	POTETO_SKILL,
	REMINDER_MESSAGE_TYPE,
	ROSTER_MESSAGE_TYPE,
	rosterText,
	taskOfSkillInput,
	taskOfSkillPrompt,
} from "./activation.ts";
import { blocksEnabled, createBehaviorStore, type BehaviorStoreOptions } from "./behavior.ts";
import { reminderText, segmentText, statusReport } from "./display.ts";
import { blockingFinding, spawnFinding, toolCallResult } from "./guards/blocking.ts";
import { DROPOUT_ENTRY_TYPE, watchDropouts } from "./dropouts.ts";
import { playbookOpenedBy, progressFromTodo } from "./observe.ts";
import { activeSeats, guardSeatSpawn } from "./panel.ts";
import { createRunStore } from "./run-state.ts";

const COMMAND_USAGE = "Usage: /pstack [status]";

function notify(pi: ExtensionAPI, ctx: ExtensionContext, level: "info" | "warning" | "error", message: string): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
	else pi.logger[level === "warning" ? "warn" : level](message);
}

export interface PstackExtensionOptions extends Pick<BehaviorStoreOptions, "configPath" | "homeDirectory"> {
	/** Directory of the vendored poteto-mode skill. Tests point it at a fixture. */
	skillDirectory?: string;
}

export default function pstackExtension(pi: ExtensionAPI, options: PstackExtensionOptions = {}): void {
	const behavior = createBehaviorStore(pi.events, { ...options, onWarning: message => pi.logger.warn(message) });
	const runs = createRunStore((customType, data) => pi.appendEntry(customType, data));
	const publisher = connectSharedDisplay(pi.events, "pstack");
	let stopDropouts: (() => void) | undefined;
	let disposed = false;

	runs.subscribe(state => {
		if (disposed) return;
		const text = segmentText(state);
		publisher.publish(text === undefined ? null : { frames: [[text]] });
	});

	const restore = (ctx: ExtensionContext): void => runs.restore(ctx.sessionManager.getBranch());

	/** Start the run and tell the session which panel seats exist. False when it was already active. */
	const activate = (ctx: ExtensionContext, task: string): boolean => {
		const seats = activeSeats(ctx.models, behavior.current().maxPanelSize);
		if (!runs.activate({ task, seats: seats.map(seat => seat.seat) })) return false;
		pi.sendMessage({ customType: ROSTER_MESSAGE_TYPE, content: rosterText(seats), display: false }, { deliverAs: "nextTurn" });
		return true;
	};

	pi.on("session_start", (_event, ctx) => {
		behavior.reload();
		stopDropouts?.();
		stopDropouts = watchDropouts(
			pi.events,
			dropout => {
				pi.appendEntry(DROPOUT_ENTRY_TYPE, dropout);
				runs.noteDropout(dropout);
			},
			receipt => runs.recordReceipt(receipt),
		);
		restore(ctx);
	});
	// session_switch (/new, resume) and session_branch replace the branch; session_tree moves within one.
	pi.on("session_switch", (_event, ctx) => restore(ctx));
	pi.on("session_branch", (_event, ctx) => restore(ctx));
	pi.on("session_tree", (_event, ctx) => restore(ctx));
	pi.on("session_shutdown", () => {
		disposed = true;
		stopDropouts?.();
		stopDropouts = undefined;
		behavior.dispose();
		publisher.dispose();
	});
	pi.on("before_subagent_spawn", (event, ctx) => {
		const finding = spawnFinding(ctx.agent.name);
		if (finding && blocksEnabled(behavior.current().guardStrictness)) return { block: true, reason: finding.reason };
		return guardSeatSpawn(event, ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		const strictness = behavior.current().guardStrictness;
		if (strictness === "off") return undefined;
		const finding = await blockingFinding({
			toolName: event.toolName,
			input: event.input,
			agentName: ctx.agent.name,
			runActive: runs.state().active,
			cwd: ctx.cwd,
		});
		return toolCallResult(finding, strictness);
	});

	// Interactive and RPC modes emit `input` before skill dispatch; print and ACP modes only reach the skill-prompt message.
	pi.on("input", (event, ctx) => {
		const task = event.source === "extension" ? undefined : taskOfSkillInput(event.text);
		if (task !== undefined) activate(ctx, task);
		return undefined;
	});
	pi.on("message_start", (event, ctx) => {
		const task = taskOfSkillPrompt(event.message);
		if (task !== undefined) activate(ctx, task);
	});

	pi.on("tool_result", event => {
		const state = runs.state();
		if (!state.active) return;
		const playbook = playbookOpenedBy(event, state.playbook);
		if (playbook !== undefined) runs.setPlaybook(playbook);
		const progress = progressFromTodo(event);
		if (progress !== undefined) runs.setProgress(progress);
	});

	// The run state is rebuilt from custom entries, which compaction keeps; the model only needs to be told where it is.
	pi.on("session_compact", () => {
		const state = runs.state();
		if (state.active) pi.sendMessage({ customType: REMINDER_MESSAGE_TYPE, content: reminderText(state), display: false }, { deliverAs: "nextTurn" });
	});

	pi.registerCommand("poteto", {
		description: "Start pstack's poteto-mode on a task",
		handler: async (args, ctx) => {
			const task = args.trim();
			let prompt: string;
			try {
				prompt = await buildPotetoPrompt(options.skillDirectory ?? DEFAULT_POTETO_DIRECTORY, task);
			} catch (error) {
				notify(pi, ctx, "error", `Unable to read the vendored ${POTETO_SKILL} skill: ${String(error)}`);
				return;
			}
			activate(ctx, task);
			if (ctx.isIdle()) {
				pi.sendUserMessage(prompt);
				return;
			}
			pi.sendUserMessage(prompt, { deliverAs: "followUp" });
			notify(pi, ctx, "info", "poteto-mode queued as follow-up.");
		},
	});

	pi.registerCommand("pstack", {
		description: "pstack: show the run state of this Agent Session",
		handler: async (args, ctx) => {
			const subcommand = args.trim().split(/\s+/)[0] ?? "";
			if (subcommand === "" || subcommand === "status") notify(pi, ctx, "info", statusReport(runs.state()));
			else notify(pi, ctx, "warning", `Unknown /pstack subcommand. ${COMMAND_USAGE}`);
		},
	});
}
