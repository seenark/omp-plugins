import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isRecord } from "@codesook/omp-shared-display/config-store";
import { PANEL_ROLES } from "./roles.ts";
import { diversityNote, type SeatStatus } from "./panel.ts";

export const POTETO_SKILL = "poteto-mode";
export const DEFAULT_POTETO_DIRECTORY = path.join(import.meta.dirname, "..", "skills", POTETO_SKILL);

/** Custom message types for the hidden notes pstack sends to the model. */
export const ROSTER_MESSAGE_TYPE = "dev.codesook.pstack.roster";
export const REMINDER_MESSAGE_TYPE = "dev.codesook.pstack.reminder";

/** Skills that dispatch the panel seats. Invoked outside an Activation they still need the seat roster. */
export const PANEL_SKILLS = ["interrogate", "arena", "swarm", "architect", "how"] as const;

const SKILL_COMMAND = new RegExp(`^\\s*/skill:${POTETO_SKILL}(?=\\s|$)`);
const PANEL_SKILL_COMMAND = new RegExp(`^\\s*/skill:(?:${PANEL_SKILLS.join("|")})(?=\\s|$)`);
// OMP's own custom message type for an expanded `/skill:<name>` (SKILL_PROMPT_MESSAGE_TYPE).
const SKILL_PROMPT_TYPE = "skill-prompt";

/** The task typed after `/skill:poteto-mode`, or undefined when the input does not start poteto-mode. `""` means no task. */
export function taskOfSkillInput(text: string): string | undefined {
	const match = SKILL_COMMAND.exec(text);
	return match ? text.slice(match[0].length).trim() : undefined;
}

/** The task of an expanded, user-invoked poteto-mode skill prompt, or undefined for any other message. */
export function taskOfSkillPrompt(message: unknown): string | undefined {
	if (!isRecord(message) || message.role !== "custom" || message.customType !== SKILL_PROMPT_TYPE || message.attribution !== "user") return undefined;
	if (!isRecord(message.details) || message.details.name !== POTETO_SKILL) return undefined;
	return typeof message.details.args === "string" ? message.details.args.trim() : "";
}

/** True when the input starts a panel skill. */
export function isPanelSkillInput(text: string): boolean {
	return PANEL_SKILL_COMMAND.test(text);
}

/** True for an expanded, user-invoked panel skill prompt. */
export function isPanelSkillPrompt(message: unknown): boolean {
	if (!isRecord(message) || message.role !== "custom" || message.customType !== SKILL_PROMPT_TYPE || message.attribution !== "user") return false;
	return isRecord(message.details) && PANEL_SKILLS.includes(message.details.name as (typeof PANEL_SKILLS)[number]);
}

/**
 * The message `/skill:poteto-mode` would produce: OMP does not expand `/skill:` sent by an extension,
 * so `/poteto` sends the skill body itself.
 */
export async function buildPotetoPrompt(skillDirectory: string, task: string): Promise<string> {
	const source = await fs.readFile(path.join(skillDirectory, "SKILL.md"), "utf8");
	const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
	return [
		`[IMPORTANT: User invoked the "${POTETO_SKILL}" skill; follow its instructions. Full skill below.]`,
		body,
		"---",
		`[Skill directory: ${skillDirectory}]\nResolve relative paths in this skill against this absolute directory.`,
		...(task ? [`User: ${task}`] : []),
	].join("\n\n");
}

/** Tells the session which panel seats can be spawned. `seats` holds the seats that have a model, in seat order. */
export function rosterText(seats: readonly SeatStatus[]): string {
	const configured = seats.map(seat => `${seat.seat.toUpperCase()} (${seat.role.id}: ${seat.model}, vendor ${seat.vendor})`);
	const note = diversityNote(seats.flatMap(seat => seat.vendor ?? []));
	const absent = PANEL_ROLES.filter(role => !seats.some(seat => seat.seat === role.seat)).map(role => role.seat.toUpperCase());
	return [
		configured.length > 0 ? `pstack panel seats configured: ${configured.join(", ")}.` : "pstack has no panel seats configured.",
		note ? `Every configured seat is one vendor: each panel verdict states "${note}".` : undefined,
		absent.length > 0 ? `Absent seats: ${absent.join(", ")}. An absent seat is not a failure: skip it and do not spawn its agents.` : undefined,
	]
		.filter(Boolean)
		.join(" ");
}
