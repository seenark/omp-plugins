import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { connectSharedDisplay } from "@codesook/omp-shared-display/client";
import { suspendInstructionModes, type SuspendableInstructionMode } from "@codesook/omp-shared-display/instruction-mode";
import {
	buildPotetoPrompt,
	DEFAULT_POTETO_DIRECTORY,
	isPanelSkillInput,
	isPanelSkillPrompt,
	POTETO_SKILL,
	REMINDER_MESSAGE_TYPE,
	ROSTER_MESSAGE_TYPE,
	rosterText,
	taskOfSkillInput,
	taskOfSkillPrompt,
} from "./activation.ts";
import { blocksEnabled, createBehaviorStore, type BehaviorStoreOptions } from "./behavior.ts";
import { diagnose, doctorLevel, doctorReport } from "./doctor.ts";
import { reminderText, segmentText, statusReport } from "./display.ts";
import { blockingFinding, spawnFinding, toolCallResult } from "./guards/blocking.ts";
import { DROPOUT_ENTRY_TYPE, watchDropouts } from "./dropouts.ts";
import { playbookOpenedBy, progressFromTodo } from "./observe.ts";
import { activeSeats, guardSeatSpawn } from "./panel.ts";
import { createRunStore } from "./run-state.ts";
import { loadSetupSettings, runPresetCommand, runSetupCommand, type SetupOptions } from "./setup/index.ts";
import { createWarningGuards } from "./warn-guards.ts";

const COMMAND_USAGE = "Usage: /pstack [status|setup|preset <name>|doctor]";

function notify(pi: ExtensionAPI, ctx: ExtensionContext, level: "info" | "warning" | "error", message: string): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
	else pi.logger[level === "warning" ? "warn" : level](message);
}

export interface PstackExtensionOptions extends Pick<BehaviorStoreOptions, "configPath" | "homeDirectory"> {
	/** Directory of the vendored poteto-mode skill. Tests point it at a fixture. */
	skillDirectory?: string;
	/** Seams for `/pstack setup`: tests inject a fake settings writer and model probe. */
	setup?: SetupOptions;
}

export default function pstackExtension(pi: ExtensionAPI, options: PstackExtensionOptions = {}): void {
	const behavior = createBehaviorStore(pi.events, { ...options, onWarning: message => pi.logger.warn(message) });
	const runs = createRunStore((customType, data) => pi.appendEntry(customType, data));
	const publisher = connectSharedDisplay(pi.events, "pstack");
	let stopDropouts: (() => void) | undefined;
	let disposed = false;

	runs.subscribe((state, change) => {
		if (disposed) return;
		if (state.active && (change === "activated" || change === "restored")) {
			const { suspendCaveman, suspendPonytail } = behavior.current();
			const modes: SuspendableInstructionMode[] = [];
			if (suspendCaveman) modes.push("caveman");
			if (suspendPonytail) modes.push("ponytail");
			suspendInstructionModes(pi.events, modes);
		}
		const text = segmentText(state);
		publisher.publish(text === undefined ? null : { frames: [[text]] });
	});

	const warnings = createWarningGuards({ behavior, runs, skillDirectory: options.skillDirectory ?? DEFAULT_POTETO_DIRECTORY });
	const restore = (ctx: ExtensionContext): void => {
		warnings.reset();
		runs.restore(ctx.sessionManager.getBranch());
	};

	/** Start the run and tell the session which panel seats exist. False when it was already active. */
	const activate = (ctx: ExtensionContext, task: string): boolean => {
		const seats = activeSeats(ctx.models, behavior.current().maxPanelSize);
		if (!runs.activate({ task, seats: seats.map(seat => seat.seat) })) return false;
		pi.sendMessage({ customType: ROSTER_MESSAGE_TYPE, content: rosterText(seats), display: false }, { deliverAs: "nextTurn" });
		return true;
	};

	/** A panel skill started outside a run has no activation roster, so tell the session its seats now. */
	let panelInputSeen = false;
	const announceSeats = (ctx: ExtensionContext): void => {
		if (runs.state().active) return;
		const seats = activeSeats(ctx.models, behavior.current().maxPanelSize);
		pi.sendMessage({ customType: ROSTER_MESSAGE_TYPE, content: rosterText(seats), display: false }, { deliverAs: "nextTurn" });
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
		else if (event.source !== "extension" && isPanelSkillInput(event.text)) {
			panelInputSeen = true;
			announceSeats(ctx);
		}
		return undefined;
	});
	pi.on("message_start", (event, ctx) => {
		const task = taskOfSkillPrompt(event.message);
		if (task !== undefined) activate(ctx, task);
		else if (isPanelSkillPrompt(event.message)) {
			if (!panelInputSeen) announceSeats(ctx);
			panelInputSeen = false;
		}
	});

	pi.on("tool_result", (event, ctx) => {
		const state = runs.state();
		if (state.active) {
			const playbook = playbookOpenedBy(event, state.playbook);
			if (playbook !== undefined) runs.setPlaybook(playbook);
			const progress = progressFromTodo(event);
			if (progress !== undefined) runs.setProgress(progress);
		}
		return warnings.onToolResult(event, ctx);
	});
	pi.on("session_stop", (event, ctx) => warnings.onSessionStop(event, ctx));

	// The run state is rebuilt from custom entries, which compaction keeps; the model only needs to be told where it is.
	// Compaction can summarize away the activation roster, and panel verdicts need each seat's model, so it is sent again.
	pi.on("session_compact", (_event, ctx) => {
		const state = runs.state();
		if (!state.active) return;
		pi.sendMessage({ customType: REMINDER_MESSAGE_TYPE, content: reminderText(state), display: false }, { deliverAs: "nextTurn" });
		const seats = activeSeats(ctx.models, behavior.current().maxPanelSize);
		pi.sendMessage({ customType: ROSTER_MESSAGE_TYPE, content: rosterText(seats), display: false }, { deliverAs: "nextTurn" });
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
			const [subcommand = "", ...rest] = args.trim().split(/\s+/);
			const report = (level: "info" | "warning" | "error", message: string): void => notify(pi, ctx, level, message);
			if (subcommand === "" || subcommand === "status") notify(pi, ctx, "info", statusReport(runs.state()));
			else if (subcommand === "setup") await runSetupCommand(pi, ctx, report, options.setup);
			else if (subcommand === "preset") await runPresetCommand(pi, ctx, report, rest[0] ?? "", options.setup);
			else if (subcommand === "doctor") {
				try {
					const findings = diagnose({
						models: ctx.models,
						settings: await loadSetupSettings(pi, options.setup),
						behavior: behavior.current(),
						commands: pi.getCommands(),
						skillsRoot: path.dirname(options.skillDirectory ?? DEFAULT_POTETO_DIRECTORY),
						displayHostAvailable: publisher.hostAvailable,
					});
					notify(pi, ctx, doctorLevel(findings), doctorReport(findings));
				} catch (error) {
					notify(pi, ctx, "error", `pstack doctor could not run: ${String(error)}`);
				}
			} else notify(pi, ctx, "warning", `Unknown /pstack subcommand. ${COMMAND_USAGE}`);
		},
	});
}
