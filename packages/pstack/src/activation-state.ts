import { isRecord } from "@codesook/omp-shared-display/config-store";
import { instructionModeEntryType, type SuspendableInstructionMode } from "@codesook/omp-shared-display/instruction-mode";
import { DROPOUT_ENTRY_TYPE, type Dropout, type SeatSettled } from "./dropouts.ts";
import { PANEL_SEATS, type PanelSeat } from "./roles.ts";

/** Reverse-domain custom session entry types under which the activation state is persisted. */
export const ACTIVATION_ENTRY_TYPE = "dev.codesook.pstack.activation";
export const RECEIPT_ENTRY_TYPE = "dev.codesook.pstack.receipt";

export interface ActivationProgress {
	done: number;
	total: number;
	/** Content of the todo item in progress. */
	current?: string;
}

/** A panel seat's run reached a terminal state. Only `completed` counts as attendance. */
export type PanelReceipt = SeatSettled;

/**
 * What the session knows about the current pstack Activation. Rebuilt from the session branch's custom entries,
 * so it survives compaction, resume and branch switches. Guards, warnings, suspension and doctor read it through {@link ActivationReader}.
 */
export interface ActivationState {
	/** True from the moment the user starts pstack until the session ends. */
	active: boolean;
	task?: string;
	/** Kebab-case playbook title, e.g. `feature`; set when the model opens a playbook file. */
	playbook?: string;
	/** Progress through the session's todo list. */
	progress?: ActivationProgress;
	/** Panel seats that had a model when pstack started. */
	seats: readonly PanelSeat[];
	receipts: readonly PanelReceipt[];
	/** Seats whose run fell back to another model. Subset of the session's `dev.codesook.pstack.dropout` entries. */
	dropouts: readonly Dropout[];
}

export const INACTIVE_ACTIVATION: ActivationState = { active: false, seats: [], receipts: [], dropouts: [] };

/** Payload of a `ACTIVATION_ENTRY_TYPE` entry. */
export type ActivationEntry =
	| { kind: "activated"; task?: string; seats: PanelSeat[] }
	| { kind: "playbook"; playbook: string }
	| { kind: "progress"; done: number; total: number; current?: string };

export type ActivationChange = "activated" | "restored" | "updated";
export type ActivationListener = (state: ActivationState, change: ActivationChange) => void;

/** The read side of the activation state: what guards, suspension and doctor consume. */
export interface ActivationReader {
	state(): ActivationState;
	/** Called after every change, including a rebuild from the session branch. Returns the unsubscribe function. */
	subscribe(listener: ActivationListener): () => void;
}

export interface ActivationStore extends ActivationReader {
	/** Rebuild from the session branch. Notifies with `restored`. */
	restore(entries: readonly unknown[]): void;
	/** Start the Activation. False, with nothing recorded, when it is already active. */
	activate(input: { task?: string; seats: readonly PanelSeat[] }): boolean;
	setPlaybook(playbook: string): void;
	setProgress(progress: ActivationProgress): void;
	/** Count a finished seat run. Ignored while inactive. */
	recordReceipt(receipt: PanelReceipt): void;
	/** Count a dropout already persisted by the dropout watcher. Ignored while inactive. */
	noteDropout(dropout: Dropout): void;
}

const isSeat = (value: unknown): value is PanelSeat => PANEL_SEATS.includes(value as PanelSeat);
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

function parseActivationEntry(data: unknown): ActivationEntry | undefined {
	if (!isRecord(data)) return undefined;
	if (data.kind === "activated" && Array.isArray(data.seats) && data.seats.every(isSeat)) {
		return { kind: "activated", ...(typeof data.task === "string" ? { task: data.task } : {}), seats: data.seats };
	}
	if (data.kind === "playbook" && typeof data.playbook === "string" && data.playbook !== "") {
		return { kind: "playbook", playbook: data.playbook };
	}
	if (data.kind === "progress" && isCount(data.done) && isCount(data.total) && data.done <= data.total) {
		return { kind: "progress", done: data.done, total: data.total, ...(typeof data.current === "string" ? { current: data.current } : {}) };
	}
	return undefined;
}

function parseReceipt(data: unknown): PanelReceipt | undefined {
	if (!isRecord(data) || !isSeat(data.seat) || typeof data.agent !== "string" || typeof data.id !== "string") return undefined;
	if (data.status !== "completed" && data.status !== "failed" && data.status !== "aborted") return undefined;
	return { seat: data.seat, agent: data.agent, id: data.id, status: data.status };
}

function parseDropout(data: unknown): Dropout | undefined {
	if (!isRecord(data) || !isSeat(data.seat)) return undefined;
	const { agent, id, from, to, reason } = data;
	if (typeof agent !== "string" || typeof id !== "string" || typeof from !== "string" || typeof to !== "string") return undefined;
	return { seat: data.seat, agent, id, from, to, ...(typeof reason === "string" ? { reason } : {}) };
}

function sameProgress(a: ActivationProgress | undefined, b: ActivationProgress): boolean {
	return a !== undefined && a.done === b.done && a.total === b.total && a.current === b.current;
}

/**
 * Apply one session entry. Returns `state` itself when the entry changes nothing, so live updates and the
 * rebuild share one rule set: entries that do not belong to a run (before activation, malformed) are ignored.
 */
export function applyEntry(state: ActivationState, customType: string, data: unknown): ActivationState {
	if (customType === ACTIVATION_ENTRY_TYPE) {
		const entry = parseActivationEntry(data);
		if (!entry) return state;
		if (entry.kind === "activated") {
			return state.active ? state : { ...INACTIVE_ACTIVATION, active: true, ...(entry.task === undefined ? {} : { task: entry.task }), seats: entry.seats };
		}
		if (!state.active) return state;
		if (entry.kind === "playbook") return state.playbook === entry.playbook ? state : { ...state, playbook: entry.playbook };
		const progress: ActivationProgress = { done: entry.done, total: entry.total, ...(entry.current === undefined ? {} : { current: entry.current }) };
		return sameProgress(state.progress, progress) ? state : { ...state, progress };
	}
	if (!state.active) return state;
	if (customType === RECEIPT_ENTRY_TYPE) {
		const receipt = parseReceipt(data);
		return receipt ? { ...state, receipts: [...state.receipts, receipt] } : state;
	}
	if (customType === DROPOUT_ENTRY_TYPE) {
		const dropout = parseDropout(data);
		return dropout ? { ...state, dropouts: [...state.dropouts, dropout] } : state;
	}
	return state;
}

/** Fold a session branch (`ctx.sessionManager.getBranch()`) into the activation state it recorded. */
export function rebuildActivationState(entries: readonly unknown[]): ActivationState {
	let state = INACTIVE_ACTIVATION;
	for (const entry of entries) {
		if (isRecord(entry) && entry.type === "custom" && typeof entry.customType === "string") {
			state = applyEntry(state, entry.customType, entry.data);
		}
	}
	return state;
}

/** Modes whose latest Session Override after the activation entry is not `off`: the user switched them back on. */
export function reenabledInstructionModes(entries: readonly unknown[], modes: readonly SuspendableInstructionMode[]): SuspendableInstructionMode[] {
	let activated = false;
	const latest = new Map<SuspendableInstructionMode, unknown>();
	for (const entry of entries) {
		if (!isRecord(entry) || entry.type !== "custom" || typeof entry.customType !== "string") continue;
		if (!activated) {
			activated = entry.customType === ACTIVATION_ENTRY_TYPE && parseActivationEntry(entry.data)?.kind === "activated";
			continue;
		}
		const mode = modes.find(candidate => instructionModeEntryType(candidate) === entry.customType);
		if (mode && isRecord(entry.data)) latest.set(mode, entry.data.mode);
	}
	return modes.filter(mode => latest.has(mode) && latest.get(mode) !== "off");
}

/** Seats that sat on the panel (at least one completed run) out of the seats that had a model at activation. */
export function panelAttendance(state: ActivationState): { attended: number; seats: number } {
	const completed = new Set(state.receipts.filter(receipt => receipt.status === "completed").map(receipt => receipt.seat));
	return { attended: state.seats.filter(seat => completed.has(seat)).length, seats: state.seats.length };
}

export function createActivationStore(appendEntry: (customType: string, data: unknown) => void): ActivationStore {
	let state: ActivationState = INACTIVE_ACTIVATION;
	const listeners = new Set<ActivationListener>();

	const commit = (next: ActivationState, change: ActivationChange): boolean => {
		if (next === state) return false;
		state = next;
		for (const listener of [...listeners]) listener(state, change);
		return true;
	};
	const record = (customType: string, data: unknown, change: ActivationChange): boolean => {
		const next = applyEntry(state, customType, data);
		if (next === state) return false;
		appendEntry(customType, data);
		return commit(next, change);
	};

	return {
		state: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		restore(entries) {
			state = rebuildActivationState(entries);
			for (const listener of [...listeners]) listener(state, "restored");
		},
		activate: ({ task, seats }) =>
			record(ACTIVATION_ENTRY_TYPE, { kind: "activated", ...(task ? { task } : {}), seats: [...seats] } satisfies ActivationEntry, "activated"),
		setPlaybook: playbook => void record(ACTIVATION_ENTRY_TYPE, { kind: "playbook", playbook } satisfies ActivationEntry, "updated"),
		setProgress: progress => void record(ACTIVATION_ENTRY_TYPE, { kind: "progress", ...progress } satisfies ActivationEntry, "updated"),
		recordReceipt: receipt => void record(RECEIPT_ENTRY_TYPE, receipt, "updated"),
		noteDropout: dropout => void commit(applyEntry(state, DROPOUT_ENTRY_TYPE, dropout), "updated"),
	};
}
