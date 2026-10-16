import {
	CODESOOK_OMP_CONFIG_CHANGED,
	isRecord,
	readCodesookOmpConfig,
} from "@codesook/omp-shared-display/config-store";
import * as os from "node:os";
import * as path from "node:path";

export const GUARD_STRICTNESS_LEVELS = ["block-and-warn", "warn-only", "off"] as const;
export type GuardStrictness = (typeof GUARD_STRICTNESS_LEVELS)[number];

export const MIN_PANEL_SIZE = 1;
export const MAX_PANEL_SIZE = 5;

/** `behavior.pstack` in the Root Plugin Configuration. */
export interface PstackBehavior {
	suspendCaveman: boolean;
	suspendPonytail: boolean;
	maxPanelSize: number;
	guardStrictness: GuardStrictness;
}

export const DEFAULT_PSTACK_BEHAVIOR: Readonly<PstackBehavior> = {
	suspendCaveman: true,
	suspendPonytail: true,
	maxPanelSize: MAX_PANEL_SIZE,
	guardStrictness: "block-and-warn",
};

function isStrictness(value: unknown): value is GuardStrictness {
	return GUARD_STRICTNESS_LEVELS.includes(value as GuardStrictness);
}

function isPanelSize(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= MIN_PANEL_SIZE && (value as number) <= MAX_PANEL_SIZE;
}

/** Every field falls back to its default on its own, so one bad value never disturbs the others. Defaults are the safe settings. */
export function normalizePstackBehavior(raw: unknown): PstackBehavior {
	const source = isRecord(raw) ? raw : {};
	const defaults = DEFAULT_PSTACK_BEHAVIOR;
	return {
		suspendCaveman: typeof source.suspendCaveman === "boolean" ? source.suspendCaveman : defaults.suspendCaveman,
		suspendPonytail: typeof source.suspendPonytail === "boolean" ? source.suspendPonytail : defaults.suspendPonytail,
		maxPanelSize: isPanelSize(source.maxPanelSize) ? source.maxPanelSize : defaults.maxPanelSize,
		guardStrictness: isStrictness(source.guardStrictness) ? source.guardStrictness : defaults.guardStrictness,
	};
}

/** Read `behavior.pstack` out of a root document (the config-changed payload); undefined when `root` is not one. */
export function pstackBehaviorFromRoot(root: unknown): PstackBehavior | undefined {
	if (!isRecord(root) || root.version !== 1 || !isRecord(root.display) || !isRecord(root.behavior)) return undefined;
	return normalizePstackBehavior(root.behavior.pstack);
}

export interface BehaviorStoreOptions {
	configPath?: string;
	homeDirectory?: string;
	onWarning?: (message: string) => void;
}

export interface BehaviorStore {
	current(): PstackBehavior;
	/** Re-read the Root Plugin Configuration from disk. */
	reload(): void;
	dispose(): void;
}

/**
 * Holds the live Behavior Configuration: read at creation, replaced on every config-changed event.
 * A missing or unreadable file yields the defaults.
 */
export function createBehaviorStore(
	events: { on(channel: string, handler: (data: unknown) => void): () => void },
	options: BehaviorStoreOptions = {},
): BehaviorStore {
	const configPath = options.configPath ?? path.join(options.homeDirectory ?? os.homedir(), ".config", "codesook-omp", "config.json");
	let behavior: PstackBehavior = { ...DEFAULT_PSTACK_BEHAVIOR };

	const reload = (): void => {
		const root = readCodesookOmpConfig(configPath);
		if (root.exists && !root.valid) {
			options.onWarning?.(`Unable to parse the Root Plugin Configuration at ${configPath}; pstack uses its default behavior settings.`);
			behavior = { ...DEFAULT_PSTACK_BEHAVIOR };
			return;
		}
		behavior = pstackBehaviorFromRoot(root.value) ?? { ...DEFAULT_PSTACK_BEHAVIOR };
	};
	reload();

	const unsubscribe = events.on(CODESOOK_OMP_CONFIG_CHANGED, data => {
		if (!isRecord(data)) return;
		const next = pstackBehaviorFromRoot(data.config);
		if (next) behavior = next;
	});

	return { current: () => ({ ...behavior }), reload, dispose: unsubscribe };
}
