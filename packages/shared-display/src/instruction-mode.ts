/** EventBus channel on which a workflow plugin (pstack) asks Instruction Modes to switch off for the Agent Session. */
export const INSTRUCTION_MODE_SUSPENSION_CHANNEL = "codesook/instruction-mode-suspension/v1";

export const SUSPENDABLE_INSTRUCTION_MODES = ["caveman", "ponytail"] as const;
export type SuspendableInstructionMode = (typeof SUSPENDABLE_INSTRUCTION_MODES)[number];

/** Session entry type under which an Instruction Mode records its Session Override (`data: { mode }`). */
export const instructionModeEntryType = (mode: SuspendableInstructionMode): string => `${mode}-mode`;

export interface InstructionModeSuspension {
	readonly protocol: 1;
	readonly source: "pstack";
	readonly modes: readonly SuspendableInstructionMode[];
}

export interface InstructionModeEvents {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

/** Ask the named Instruction Modes to apply a Session Override at Mode Level off. Nothing is emitted for an empty list. */
export function suspendInstructionModes(events: Pick<InstructionModeEvents, "emit">, modes: readonly SuspendableInstructionMode[]): void {
	if (modes.length === 0) return;
	events.emit(INSTRUCTION_MODE_SUSPENSION_CHANNEL, { protocol: 1, source: "pstack", modes: [...modes] } satisfies InstructionModeSuspension);
}

/** True when `data` is a version 1 suspension message that names `mode`. Anything else is ignored. */
export function isSuspensionFor(data: unknown, mode: SuspendableInstructionMode): boolean {
	if (typeof data !== "object" || data === null) return false;
	const { protocol, modes } = data as { protocol?: unknown; modes?: unknown };
	return protocol === 1 && Array.isArray(modes) && modes.includes(mode);
}

/** Subscribe `onSuspend` to suspensions naming `mode`. Returns the unsubscribe function. */
export function onInstructionModeSuspension(events: Pick<InstructionModeEvents, "on">, mode: SuspendableInstructionMode, onSuspend: () => void): () => void {
	return events.on(INSTRUCTION_MODE_SUSPENSION_CHANNEL, data => {
		if (isSuspensionFor(data, mode)) onSuspend();
	});
}
