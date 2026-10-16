import { completeSimple } from "@oh-my-pi/pi-ai";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";

export type ProbeResult = { ok: true } | { ok: false; reason: string };

/** One real turn against `spec`. Tests inject a fake; setup never calls a provider any other way. */
export type ModelProbe = (spec: string) => Promise<ProbeResult>;

export interface ProbeFailure {
	spec: string;
	reason: string;
}

const PROBE_TIMEOUT_MS = 30_000;

export function createModelProbe(ctx: Pick<ExtensionContext, "models" | "modelRegistry">, timeoutMs = PROBE_TIMEOUT_MS): ModelProbe {
	return async spec => {
		const model = ctx.models.resolve(spec);
		if (!model) return { ok: false, reason: "the OMP registry does not serve it" };
		const reply = await completeSimple(
			model,
			{ messages: [{ role: "user", content: "Reply with the single word OK.", timestamp: Date.now() }] },
			{ apiKey: ctx.modelRegistry.resolver(model), signal: AbortSignal.timeout(timeoutMs), maxTokens: 64 },
		);
		return reply.stopReason === "error" || reply.stopReason === "aborted"
			? { ok: false, reason: reply.errorMessage ?? `the call ended with ${reply.stopReason}` }
			: { ok: true };
	};
}

/** Probe each distinct spec once; a throw counts as a failure. An empty result means every model answered. */
export async function probeAll(specs: Iterable<string>, probe: ModelProbe): Promise<ProbeFailure[]> {
	const results = await Promise.all(
		[...new Set(specs)].map(async (spec): Promise<ProbeFailure | undefined> => {
			try {
				const result = await probe(spec);
				return result.ok ? undefined : { spec, reason: result.reason };
			} catch (error) {
				return { spec, reason: error instanceof Error ? error.message : String(error) };
			}
		}),
	);
	return results.filter((failure): failure is ProbeFailure => failure !== undefined);
}
