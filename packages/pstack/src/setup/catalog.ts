import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";

export type ModelQuery = Pick<ExtensionContext["models"], "list" | "family">;

export interface ModelChoice {
	/** `provider/id`, the form written into a model role. */
	spec: string;
	provider: string;
	id: string;
	name: string;
	/** Lineage token from the models API: every Claude release shares one, Claude and GPT differ. */
	vendor: string;
	/** Thinking levels the registry lists for the model, least to most intensive; empty when it lists none. */
	efforts: readonly string[];
}

const PROVIDER_ORDER = ["anthropic", "openai-codex", "openai"];

function providerRank(provider: string): number {
	const index = PROVIDER_ORDER.indexOf(provider);
	return index === -1 ? PROVIDER_ORDER.length : index;
}

/** Only models the OMP registry can serve right now, in a stable order. */
export function listChoices(models: ModelQuery): ModelChoice[] {
	const seen = new Set<string>();
	const choices: ModelChoice[] = [];
	for (const model of models.list()) {
		const spec = `${model.provider}/${model.id}`;
		if (seen.has(spec)) continue;
		seen.add(spec);
		choices.push({ spec, provider: model.provider, id: model.id, name: model.name || model.id, vendor: models.family(model), efforts: model.reasoning ? (model.thinking?.efforts ?? []) : [] });
	}
	return choices.sort(
		(a, b) => providerRank(a.provider) - providerRank(b.provider) || a.spec.localeCompare(b.spec, undefined, { numeric: true }),
	);
}
