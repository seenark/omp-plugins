import { skillNames } from "./source.ts";
import type { TermAllowance, TermCategory, Tree } from "./types.ts";

export interface TermFinding {
	category: string;
	file: string;
	term: string;
	count: number;
}

function globally(pattern: RegExp): RegExp {
	return new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
}

/** Counts matches per category, term and file over the text files of `files`. Sync itself never fails on findings; `gateTerms` is what the verify gate applies. */
export function scanTerms(files: Tree, categories: readonly TermCategory[]): TermFinding[] {
	const findings: TermFinding[] = [];
	const skills = skillNames(files.keys());
	for (const [file, { data }] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
		if (data.includes(0)) continue;
		const text = data.toString("utf8");
		for (const category of categories) {
			for (const [term, pattern] of Object.entries(category.patterns)) {
				const resolved = typeof pattern === "function" ? pattern(skills) : pattern;
				const count = text.match(globally(resolved))?.length ?? 0;
				if (count > 0) findings.push({ category: category.id, file, term, count });
			}
		}
	}
	return findings;
}

export interface GateResult {
	/** Findings no allowance covers exactly. */
	rejected: TermFinding[];
	/** Allowances no finding matches exactly: the term is gone or changed, so delete or update the entry. */
	expired: TermAllowance[];
}

export function gateTerms(findings: readonly TermFinding[], allowances: readonly TermAllowance[]): GateResult {
	const covers = (allowance: TermAllowance, finding: TermFinding) =>
		allowance.category === finding.category && allowance.file === finding.file && allowance.term === finding.term && allowance.count === finding.count;
	return {
		rejected: findings.filter(finding => !allowances.some(allowance => covers(allowance, finding))),
		expired: allowances.filter(allowance => !findings.some(finding => covers(allowance, finding))),
	};
}

export interface CategoryTotal {
	category: string;
	files: number;
	matches: number;
}

export function totalsByCategory(findings: readonly TermFinding[], categories: readonly TermCategory[]): CategoryTotal[] {
	return categories.map(({ id }) => {
		const own = findings.filter(finding => finding.category === id);
		return { category: id, files: new Set(own.map(finding => finding.file)).size, matches: own.reduce((sum, finding) => sum + finding.count, 0) };
	});
}

export function renderTermReport(findings: readonly TermFinding[], categories: readonly TermCategory[]): string {
	const lines = ["## Remaining Cursor-specific terms", "", "Categories overlap: a line is counted under every category it matches.", ""];
	for (const total of totalsByCategory(findings, categories)) {
		lines.push(`### ${total.category}: ${total.matches} matches in ${total.files} files`);
		const byFile = new Map<string, string[]>();
		for (const finding of findings.filter(entry => entry.category === total.category)) {
			byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), `${finding.term} x${finding.count}`]);
		}
		for (const [file, terms] of byFile) lines.push(`- ${file}: ${terms.join(", ")}`);
		lines.push("");
	}
	return lines.join("\n");
}
