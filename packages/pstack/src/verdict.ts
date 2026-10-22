import { FINDING_SEVERITIES, VERDICTS, type PanelSeat } from "./roles.ts";
import { SINGLE_VENDOR_WARNING, modelKey } from "./panel-rules.ts";

/*
 * Merge helpers for panel workflows. The skills import this file from an `eval` cell, so it must stay free of
 * extension-only imports. The judgment of "are two findings the same issue" is the host's `judge_batch`; everything
 * else here is deterministic.
 */

export type VerdictValue = (typeof VERDICTS)[number];
export type Severity = (typeof FINDING_SEVERITIES)[number];

export interface Finding {
	severity: Severity;
	file: string;
	line: number;
	claim: string;
	evidence: string;
}

/** The structured result of a critic agent (`output` in its frontmatter). */
export interface Verdict {
	verdict: VerdictValue;
	summary: string;
	findings: Finding[];
}

/** One seat's run, as the orchestrating agent saw it. `model` and `vendor` come from the activation roster. */
export interface SeatRun {
	seat: PanelSeat;
	model: string;
	vendor: string;
	/** The critic's structured result exactly as returned; anything that is not a valid verdict counts as no verdict. */
	verdict: unknown;
	/** Model the run moved to, when a dropout was reported for it. */
	fellBackTo?: string;
}

const SEVERITY_RANK: Record<Severity, number> = Object.fromEntries(FINDING_SEVERITIES.map((severity, index) => [severity, index])) as never;
const VERDICT_RANK: Record<VerdictValue, number> = Object.fromEntries(VERDICTS.map((verdict, index) => [verdict, index])) as never;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseFinding(value: unknown): Finding | undefined {
	if (!isObject(value)) return undefined;
	const { severity, file, line, claim, evidence } = value;
	if (!FINDING_SEVERITIES.includes(severity as Severity)) return undefined;
	if (typeof file !== "string" || typeof line !== "number" || typeof claim !== "string" || typeof evidence !== "string") return undefined;
	return { severity: severity as Severity, file, line, claim, evidence };
}

/** Undefined unless `value` is a complete verdict: one malformed finding makes the whole result unusable, so it cannot hide as an approval. */
export function parseVerdict(value: unknown): Verdict | undefined {
	if (!isObject(value) || !VERDICTS.includes(value.verdict as VerdictValue) || typeof value.summary !== "string" || !Array.isArray(value.findings)) return undefined;
	const findings = value.findings.map(parseFinding);
	if (findings.some(finding => finding === undefined)) return undefined;
	return { verdict: value.verdict as VerdictValue, summary: value.summary, findings: findings as Finding[] };
}

const refKey = (seat: PanelSeat, index: number): string => `${seat}${index}`;
const normalizedFile = (file: string): string => file.trim().replace(/^\.\//, "");

interface Ref {
	seat: PanelSeat;
	index: number;
	finding: Finding;
}

function refsOf(runs: readonly SeatRun[]): Ref[] {
	return runs.flatMap(run => (parseVerdict(run.verdict)?.findings ?? []).map((finding, index) => ({ seat: run.seat, index, finding })));
}

/** The question `judge_batch` answers for every candidate pair. */
export const SAME_ISSUE = {
	same: {
		type: "bool",
		instructions: "Do the two findings describe the same underlying defect, so that fixing one would fix the other? Different symptoms of one root cause count. Two defects in the same file do not.",
	},
} as const;

export interface IssuePair {
	a: Pick<Finding, "file" | "line" | "claim" | "evidence">;
	b: Pick<Finding, "file" | "line" | "claim" | "evidence">;
}

/**
 * Pairs of findings from different seats in the same file: the `states` for `judge_batch`, keyed `a0~b1`
 * (seat A's first finding with seat B's second). Same-seat findings are never merged, and findings in different files never are.
 */
export function duplicateCandidates(runs: readonly SeatRun[]): Record<string, IssuePair> {
	const refs = refsOf(runs);
	const pairs: Record<string, IssuePair> = {};
	refs.forEach((a, position) => {
		for (const b of refs.slice(position + 1)) {
			if (a.seat === b.seat || normalizedFile(a.finding.file) !== normalizedFile(b.finding.file)) continue;
			const { severity: _a, ...left } = a.finding;
			const { severity: _b, ...right } = b.finding;
			pairs[`${refKey(a.seat, a.index)}~${refKey(b.seat, b.index)}`] = { a: left, b: right };
		}
	});
	return pairs;
}

export interface MergedFinding extends Finding {
	/** Every seat that raised the issue, in seat order. Two or more is the strongest signal. */
	raisedBy: PanelSeat[];
}

export interface SeatReport {
	seat: PanelSeat;
	model: string;
	/** Undefined when the seat returned no usable verdict. */
	verdict?: VerdictValue;
	findings: number;
}

export interface MergedVerdict {
	/** The worst verdict any seat returned; "no verdict" when none did. */
	verdict: VerdictValue | "no verdict";
	seats: SeatReport[];
	findings: MergedFinding[];
	/** Stated beside the verdict: single vendor, fallbacks, gaps and seats that share a model. */
	notes: string[];
}

/**
 * One verdict from the seats' verdicts. `sameIssue` lists the candidate keys `judge_batch` judged duplicates;
 * duplicates join transitively into one finding that keeps the highest severity and names every seat that raised it.
 */
export function mergeVerdicts(runs: readonly SeatRun[], sameIssue: readonly string[]): MergedVerdict {
	const refs = refsOf(runs);
	const parent = new Map(refs.map(ref => [refKey(ref.seat, ref.index), refKey(ref.seat, ref.index)]));
	const root = (key: string): string => {
		let current = key;
		while (parent.get(current) !== current) current = parent.get(current)!;
		return current;
	};
	for (const pair of sameIssue) {
		const [a, b] = pair.split("~");
		if (a !== undefined && b !== undefined && parent.has(a) && parent.has(b)) parent.set(root(a), root(b));
	}

	const groups = new Map<string, Ref[]>();
	for (const ref of refs) {
		const key = root(refKey(ref.seat, ref.index));
		groups.set(key, [...(groups.get(key) ?? []), ref]);
	}
	const findings: MergedFinding[] = [...groups.values()].map(group => {
		const lead = group.reduce((best, ref) => (SEVERITY_RANK[ref.finding.severity] < SEVERITY_RANK[best.finding.severity] ? ref : best));
		const seats = [...new Set(group.map(ref => ref.seat))].sort();
		return { ...lead.finding, line: Math.min(...group.map(ref => ref.finding.line)), raisedBy: seats };
	});
	findings.sort((a, b) => b.raisedBy.length - a.raisedBy.length || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

	const parsed = runs.map(run => ({ run, verdict: parseVerdict(run.verdict) }));
	const seats = parsed.map(({ run, verdict }): SeatReport => ({ seat: run.seat, model: run.model, ...(verdict ? { verdict: verdict.verdict } : {}), findings: verdict?.findings.length ?? 0 }));
	const returned = parsed.flatMap(({ verdict }) => verdict?.verdict ?? []);
	const worst = returned.length === 0 ? "no verdict" : returned.reduce((a, b) => (VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b));

	const notes: string[] = [];
	const ran = parsed.filter(({ verdict }) => verdict !== undefined).map(({ run }) => run);
	if (ran.length > 0 && new Set(ran.map(run => run.vendor)).size === 1) notes.push(SINGLE_VENDOR_WARNING);
	for (const { run, verdict } of parsed) {
		const name = `Seat ${run.seat.toUpperCase()}`;
		if (!verdict) notes.push(`${name} returned no usable verdict: a gap, not an approval.`);
		else if (run.fellBackTo) notes.push(`${name} fell back from ${run.model} to ${run.fellBackTo}: its verdict came from a different model than configured.`);
	}
	const byModel = new Map<string, PanelSeat[]>();
	for (const run of ran) byModel.set(modelKey(run.model), [...(byModel.get(modelKey(run.model)) ?? []), run.seat]);
	for (const group of byModel.values()) {
		if (group.length > 1) notes.push(`Seats ${group.map(seat => seat.toUpperCase()).join(", ")} ran the same model: their agreement is one opinion, not independent evidence.`);
	}
	return { verdict: worst, seats, findings, notes };
}

/** The "Reviewers" lines of the final verdict: one per seat, naming its model. */
export function reviewerLines(merged: MergedVerdict): string[] {
	return merged.seats.map(seat => `Reviewer ${seat.seat.toUpperCase()}: ${seat.model}, ${seat.verdict ? `${seat.findings} finding${seat.findings === 1 ? "" : "s"}, ${seat.verdict}` : "no verdict"}`);
}
