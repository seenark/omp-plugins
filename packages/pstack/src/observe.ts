import { isRecord } from "@codesook/omp-shared-display/config-store";
import type { ActivationProgress } from "./activation-state.ts";

const PLAYBOOK_PATH = /(?:^|\/)poteto-mode\/playbooks\/([a-z0-9][a-z0-9-]*)\.md(?:[:#?].*)?$/;
/** Every other playbook ends by running this one, so reading it does not change which playbook the Activation is in. */
const CLOSING_PLAYBOOK = "opening-a-pr";
const MAX_CURRENT_LENGTH = 120;

/** The playbook a successful `read` of a poteto-mode playbook file opened. */
export function playbookOpenedBy(event: { toolName: string; input: unknown; isError: boolean }, current: string | undefined): string | undefined {
	if (event.toolName !== "read" || event.isError || !isRecord(event.input) || typeof event.input.path !== "string") return undefined;
	const playbook = PLAYBOOK_PATH.exec(event.input.path)?.[1];
	if (playbook === CLOSING_PLAYBOOK && current !== undefined) return undefined;
	return playbook;
}

/** Progress through the todo list that a successful `todo` call left behind. Abandoned items count as done. */
export function progressFromTodo(event: { toolName: string; details: unknown; isError: boolean }): ActivationProgress | undefined {
	if (event.toolName !== "todo" || event.isError || !isRecord(event.details) || !Array.isArray(event.details.phases)) return undefined;
	let done = 0;
	let total = 0;
	let current: string | undefined;
	for (const phase of event.details.phases) {
		if (!isRecord(phase) || !Array.isArray(phase.tasks)) return undefined;
		for (const task of phase.tasks) {
			if (!isRecord(task) || typeof task.content !== "string") return undefined;
			total += 1;
			if (task.status === "completed" || task.status === "abandoned") done += 1;
			else if (task.status === "in_progress" && current === undefined) current = task.content.slice(0, MAX_CURRENT_LENGTH);
		}
	}
	return total === 0 ? undefined : { done, total, ...(current === undefined ? {} : { current }) };
}
