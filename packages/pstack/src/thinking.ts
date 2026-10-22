/** Default-thinking values the user can pick; `max` exists only as the step above `xhigh`. */
export const THINKING_LEVELS = ["low", "medium", "high", "xhigh"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const DEFAULT_THINKING: ThinkingLevel = "medium";

const LADDER = [...THINKING_LEVELS, "max"] as const;
type Rung = (typeof LADDER)[number];

/** `level` moved `by` rungs along low < medium < high < xhigh < max, stopping at either end. */
export function stepThinking(level: ThinkingLevel, by: -1 | 0 | 1): Rung {
	return LADDER[Math.min(LADDER.length - 1, Math.max(0, LADDER.indexOf(level) + by))]!;
}

/**
 * The model-listed effort nearest to `level` (the lower one on a tie); undefined when the model lists none,
 * so the spec is written without a suffix instead of guessing a level the registry never named.
 */
export function clampThinking(level: Rung, efforts: readonly string[]): string | undefined {
	const rank = (effort: string): number => {
		const index = (LADDER as readonly string[]).indexOf(effort);
		return index === -1 ? (effort === "minimal" ? -1 : LADDER.length) : index;
	};
	const want = rank(level);
	let best: string | undefined;
	for (const effort of efforts) {
		const distance = Math.abs(rank(effort) - want);
		if (best === undefined || distance < Math.abs(rank(best) - want) || (distance === Math.abs(rank(best) - want) && rank(effort) < rank(best))) best = effort;
	}
	return best;
}
