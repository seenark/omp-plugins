import { describe, expect, it } from "bun:test";
import { SINGLE_VENDOR_WARNING } from "./panel-rules.ts";
import { duplicateCandidates, mergeVerdicts, parseVerdict, reviewerLines, type SeatRun } from "./verdict.ts";

const finding = (overrides: object = {}) => ({ severity: "major", file: "src/a.ts", line: 10, claim: "claim", evidence: "evidence", ...overrides });
const verdict = (value: string, findings: object[] = []) => ({ verdict: value, summary: "s", findings });
const run = (seat: SeatRun["seat"], model: string, vendor: string, result: unknown, extra: Partial<SeatRun> = {}): SeatRun => ({ seat, model, vendor, verdict: result, ...extra });

const THREE = [
	run("a", "anthropic/claude-x", "claude", verdict("concerns", [finding({ claim: "null deref", line: 12 }), finding({ file: "src/b.ts", severity: "nit" })])),
	run("b", "openai/gpt-y", "gpt", verdict("reject", [finding({ severity: "blocker", claim: "crash on null", line: 11 })])),
	run("c", "google/gemini-z", "gemini", verdict("approve")),
];

describe("parseVerdict", () => {
	it("accepts a complete verdict and rejects anything else, so a malformed result cannot read as an approval", () => {
		expect(parseVerdict(verdict("approve"))).toEqual({ verdict: "approve", summary: "s", findings: [] });
		expect(parseVerdict(verdict("maybe"))).toBeUndefined();
		expect(parseVerdict({ verdict: "approve", summary: "s" })).toBeUndefined();
		expect(parseVerdict(verdict("concerns", [finding({ severity: "critical" })]))).toBeUndefined();
		expect(parseVerdict(verdict("concerns", [finding({ line: "12" })]))).toBeUndefined();
		expect(parseVerdict(null)).toBeUndefined();
		expect(parseVerdict("approve")).toBeUndefined();
	});
});

describe("duplicateCandidates", () => {
	it("pairs findings of different seats in one file, and nothing else", () => {
		expect(Object.keys(duplicateCandidates(THREE))).toEqual(["a0~b0"]);
		const same = [run("a", "m/a", "v", verdict("concerns", [finding(), finding({ line: 40 })])), run("b", "m/b", "w", verdict("concerns", [finding({ file: "./src/a.ts" })]))];
		expect(Object.keys(duplicateCandidates(same))).toEqual(["a0~b0", "a1~b0"]);
	});

	it("skips seats without a usable verdict", () => {
		expect(duplicateCandidates([THREE[0]!, run("b", "m/b", "w", { nope: true })])).toEqual({});
	});
});

describe("mergeVerdicts", () => {
	it("merges duplicates into one finding that keeps the highest severity and names every seat", () => {
		const merged = mergeVerdicts(THREE, ["a0~b0"]);
		expect(merged.findings).toHaveLength(2);
		expect(merged.findings[0]).toMatchObject({ severity: "blocker", claim: "crash on null", line: 11, raisedBy: ["a", "b"] });
		expect(merged.findings[1]).toMatchObject({ file: "src/b.ts", raisedBy: ["a"] });
	});

	it("keeps both findings when the judge found no duplicate, and ignores unknown keys", () => {
		expect(mergeVerdicts(THREE, []).findings).toHaveLength(3);
		expect(mergeVerdicts(THREE, ["z9~a0", "garbage"]).findings).toHaveLength(3);
	});

	it("joins duplicates transitively", () => {
		const runs = [
			run("a", "m/a", "v", verdict("concerns", [finding()])),
			run("b", "m/b", "w", verdict("concerns", [finding()])),
			run("c", "m/c", "x", verdict("concerns", [finding()])),
		];
		const merged = mergeVerdicts(runs, ["a0~b0", "b0~c0"]);
		expect(merged.findings).toHaveLength(1);
		expect(merged.findings[0]!.raisedBy).toEqual(["a", "b", "c"]);
	});

	it("names each seat's model in one merged verdict and takes the worst verdict", () => {
		const merged = mergeVerdicts(THREE, ["a0~b0"]);
		expect(merged.verdict).toBe("reject");
		expect(merged.seats.map(seat => seat.model)).toEqual(["anthropic/claude-x", "openai/gpt-y", "google/gemini-z"]);
		expect(reviewerLines(merged)).toEqual([
			"Reviewer A: anthropic/claude-x, 2 findings, concerns",
			"Reviewer B: openai/gpt-y, 1 finding, reject",
			"Reviewer C: google/gemini-z, 0 findings, approve",
		]);
		expect(merged.notes).toEqual([]);
	});

	it("carries the single-vendor note for a one-vendor panel and not for a mixed one", () => {
		const claudeOnly = [
			run("a", "anthropic/claude-a", "claude", verdict("approve")),
			run("b", "anthropic/claude-b", "claude", verdict("approve")),
		];
		expect(mergeVerdicts(claudeOnly, []).notes).toContain(SINGLE_VENDOR_WARNING);
		expect(mergeVerdicts(THREE, []).notes).not.toContain(SINGLE_VENDOR_WARNING);
	});

	it("measures vendor over the seats that returned a verdict", () => {
		const runs = [run("a", "anthropic/claude-a", "claude", verdict("approve")), run("b", "openai/gpt", "gpt", null)];
		expect(mergeVerdicts(runs, []).notes).toContain(SINGLE_VENDOR_WARNING);
	});

	it("reports a seat without a verdict as a gap and a fallback beside its verdict", () => {
		const runs = [
			run("a", "anthropic/claude-a", "claude", verdict("approve"), { fellBackTo: "openai/gpt" }),
			run("b", "openai/gpt", "gpt", "garbage"),
		];
		const merged = mergeVerdicts(runs, []);
		expect(merged.seats[1]).toEqual({ seat: "b", model: "openai/gpt", findings: 0 });
		expect(merged.notes.some(note => note.includes("Seat B") && note.includes("gap"))).toBe(true);
		expect(merged.notes.some(note => note.includes("Seat A") && note.includes("openai/gpt"))).toBe(true);
		expect(reviewerLines(merged)[1]).toBe("Reviewer B: openai/gpt, no verdict");
	});

	it("flags seats that share a model as one opinion", () => {
		const runs = [run("a", "anthropic/claude-a", "claude", verdict("approve")), run("b", "bedrock/claude-a:high", "claude", verdict("approve"))];
		expect(mergeVerdicts(runs, []).notes.some(note => note.includes("A, B") && note.includes("same model"))).toBe(true);
	});

	it("has no verdict when no seat returned one", () => {
		expect(mergeVerdicts([run("a", "m/a", "v", undefined)], []).verdict).toBe("no verdict");
	});
});
