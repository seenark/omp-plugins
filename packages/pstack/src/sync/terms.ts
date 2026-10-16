import type { Tree, TermCategory } from "./types.ts";

export interface TermFinding {
	category: string;
	owner: string;
	file: string;
	term: string;
	count: number;
}

function globally(pattern: RegExp): RegExp {
	return new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
}

/** Counts matches per category, term and file over the text files of `files`. Informational: sync never fails on findings. */
export function scanTerms(files: Tree, categories: readonly TermCategory[]): TermFinding[] {
	const findings: TermFinding[] = [];
	for (const [file, { data }] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
		if (data.includes(0)) continue;
		const text = data.toString("utf8");
		for (const category of categories) {
			for (const [term, pattern] of Object.entries(category.patterns)) {
				const count = text.match(globally(pattern))?.length ?? 0;
				if (count > 0) findings.push({ category: category.id, owner: category.owner, file, term, count });
			}
		}
	}
	return findings;
}

export interface CategoryTotal {
	category: string;
	owner: string;
	files: number;
	matches: number;
}

export function totalsByCategory(findings: readonly TermFinding[], categories: readonly TermCategory[]): CategoryTotal[] {
	return categories.map(({ id, owner }) => {
		const own = findings.filter(finding => finding.category === id);
		return { category: id, owner, files: new Set(own.map(finding => finding.file)).size, matches: own.reduce((sum, finding) => sum + finding.count, 0) };
	});
}

export function renderTermReport(findings: readonly TermFinding[], categories: readonly TermCategory[]): string {
	const lines = ["## Remaining Cursor-specific terms (informational)", "", "Categories overlap: a line is counted under every category it matches.", ""];
	for (const total of totalsByCategory(findings, categories)) {
		lines.push(`### ${total.category} (owner: ${total.owner}): ${total.matches} matches in ${total.files} files`);
		const byFile = new Map<string, string[]>();
		for (const finding of findings.filter(entry => entry.category === total.category)) {
			byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), `${finding.term} x${finding.count}`]);
		}
		for (const [file, terms] of byFile) lines.push(`- ${file}: ${terms.join(", ")}`);
		lines.push("");
	}
	return lines.join("\n");
}
