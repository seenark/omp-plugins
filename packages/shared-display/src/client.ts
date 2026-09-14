export const CHANNEL = "codesook/shared-display/v1";
export const SHARED_DISPLAY_CHANNEL = CHANNEL;

export type DisplaySource = "ponytail" | "caveman" | "headroom";
export type BlockFrame = readonly string[];
export type FrameSequence = {
	readonly frames: readonly BlockFrame[];
	readonly fps?: number;
};

export interface SharedDisplayEvents {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export interface SharedDisplayPublisher {
	publish(sequence: FrameSequence | null): void;
	dispose(): void;
}

export type SharedDisplayReadyMessage = {
	readonly protocol: 1;
	readonly kind: "ready";
	readonly source: DisplaySource;
};

export type SharedDisplayRequestMessage = {
	readonly protocol: 1;
	readonly kind: "request";
	readonly epoch: string;
	readonly source?: DisplaySource;
};

export type SharedDisplaySnapshotMessage = {
	readonly protocol: 1;
	readonly kind: "snapshot";
	readonly epoch: string;
	readonly source: DisplaySource;
	readonly revision: number;
	readonly sequence: FrameSequence | null;
};

export type SharedDisplayMessage =
	| SharedDisplayReadyMessage
	| SharedDisplayRequestMessage
	| SharedDisplaySnapshotMessage;

const SOURCES: readonly DisplaySource[] = ["ponytail", "caveman", "headroom"];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDisplaySource(value: unknown): value is DisplaySource {
	return typeof value === "string" && (SOURCES as readonly string[]).includes(value);
}

function validRow(value: unknown): value is string {
	return typeof value === "string" && !value.includes("\r") && !value.includes("\n");
}

export function isValidBlockFrame(value: unknown): value is BlockFrame {
	return Array.isArray(value) && value.length > 0 && value.every(validRow);
}

export function isValidFrameSequence(value: unknown): value is FrameSequence {
	if (!isRecord(value) || !Array.isArray(value.frames) || value.frames.length === 0) return false;
	if (!value.frames.every(isValidBlockFrame)) return false;
	if (value.fps === undefined) return true;
	return typeof value.fps === "number" && Number.isFinite(value.fps) && value.fps > 0;
}

export function copyFrameSequence(value: FrameSequence): FrameSequence {
	const frames = value.frames.map(frame => [...frame]);
	return value.fps === undefined ? { frames } : { frames, fps: value.fps };
}

function validEpoch(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function validRevision(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Parse and validate a wire message. Unknown fields are ignored, but every
 * protocol field and every snapshot payload is checked before a message is
 * returned.
 */
export function parseSharedDisplayMessage(value: unknown): SharedDisplayMessage | undefined {
	if (!isRecord(value) || value.protocol !== 1) return undefined;
	if (value.kind === "ready") {
		return isDisplaySource(value.source)
			? { protocol: 1, kind: "ready", source: value.source }
			: undefined;
	}
	if (value.kind === "request") {
		if (!validEpoch(value.epoch)) return undefined;
		if (value.source !== undefined && !isDisplaySource(value.source)) return undefined;
		return value.source === undefined
			? { protocol: 1, kind: "request", epoch: value.epoch }
			: { protocol: 1, kind: "request", epoch: value.epoch, source: value.source };
	}
	if (value.kind === "snapshot") {
		if (!validEpoch(value.epoch) || !isDisplaySource(value.source) || !validRevision(value.revision)) {
			return undefined;
		}
		if (value.sequence !== null && !isValidFrameSequence(value.sequence)) return undefined;
		return {
			protocol: 1,
			kind: "snapshot",
			epoch: value.epoch,
			source: value.source,
			revision: value.revision,
			sequence: value.sequence === null ? null : copyFrameSequence(value.sequence),
		};
	}
	return undefined;
}

/** Parse a package/user glyph asset into complete block frames. */
export function parseFrameSequenceAsset(text: string): FrameSequence | undefined {
	const lines = text.replace(/\r\n?/gu, "\n").split("\n");
	const firstNonEmpty = lines.findIndex(line => line.trim().length > 0);
	let fps: number | undefined;
	if (firstNonEmpty >= 0) {
		const directive = /^fps=(.*)$/u.exec(lines[firstNonEmpty]!.trim());
		if (directive) {
			const candidate = Number(directive[1]!.trim());
			if (!Number.isFinite(candidate) || candidate <= 0) return undefined;
			fps = candidate;
			lines.splice(firstNonEmpty, 1);
		}
	}

	const body = lines.join("\n");
	if (body.trim().length === 0) return undefined;

	const frames: BlockFrame[] = /\n[ \t]*\n/u.test(body)
		? body
				.split(/\n[ \t]*\n/u)
				.map(block => block.split("\n").filter(row => row.trim().length > 0))
				.filter(frame => frame.length > 0)
		: body
				.trim()
				.split(/\s+/u)
				.filter(Boolean)
				.map(row => [row]);

	if (frames.length === 0) return undefined;
	return fps === undefined ? { frames } : { frames, fps };
}

function copyPublishedSequence(sequence: FrameSequence | null): FrameSequence | null {
	if (sequence === null) return null;
	if (!isValidFrameSequence(sequence)) return null;
	return copyFrameSequence(sequence);
}

const NO_EVENTS_PUBLISHER: SharedDisplayPublisher = {
	publish() {},
	dispose() {},
};

/** Connect one producer to the versioned EventBus seam. */
export function connectSharedDisplay(
	events: SharedDisplayEvents | undefined,
	source: DisplaySource,
): SharedDisplayPublisher {
	if (events === undefined) return NO_EVENTS_PUBLISHER;

	let disposed = false;
	let revision = 0;
	let sequence: FrameSequence | null = null;
	let requestedEpoch: string | undefined;

	const emitSnapshot = (epoch: string): void => {
		if (disposed) return;
		events.emit(CHANNEL, {
			protocol: 1,
			kind: "snapshot",
			epoch,
			source,
			revision,
			sequence: copyPublishedSequence(sequence),
		});
	};

	const unsubscribe = events.on(CHANNEL, data => {
		if (disposed) return;
		const message = parseSharedDisplayMessage(data);
		if (message?.kind !== "request") return;
		if (message.source !== undefined && message.source !== source) return;
		requestedEpoch = message.epoch;
		emitSnapshot(message.epoch);
	});

	// A host that started after this producer can ask for a targeted replay.
	events.emit(CHANNEL, { protocol: 1, kind: "ready", source });

	return {
		publish(next) {
			if (disposed || (next !== null && !isValidFrameSequence(next))) return;
			revision += 1;
			sequence = next === null ? null : copyFrameSequence(next);
			if (requestedEpoch !== undefined) emitSnapshot(requestedEpoch);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			unsubscribe();
			sequence = null;
			requestedEpoch = undefined;
			revision = 0;
		},
	};
}

export const __test__ = {
	SOURCES,
	validEpoch,
	validRevision,
	validRow,
};
