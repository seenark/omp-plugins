/** A file in a tree: bytes plus the executable bit, keyed by posix path relative to the tree root. */
export interface VFile {
	data: Buffer;
	executable: boolean;
}

export type Tree = Map<string, VFile>;

/** One literal or regex substitution over the text of matching files, applied in table order. */
export interface Rule {
	/** Unique across all groups, by convention `<group>/<name>`. */
	id: string;
	/** Why the Adaptation exists. Required: an Adaptation without a reason is drift. */
	rationale: string;
	/** Glob over package-relative paths. Defaults to every Markdown file. */
	files?: string;
	/** A string matches literally. A regex is applied globally. */
	pattern: string | RegExp;
	replacement: string | ((substring: string, ...args: any[]) => string);
}

/** A package-relative glob that is never vendored. */
export interface Exclusion {
	path: string;
	rationale: string;
}

/** A path that intentionally diverges from the sync output. */
export interface Fork {
	/** Package-relative path of the diverged file. */
	path: string;
	/** `patched`: 3-way merge Upstream changes into our edits. `rewritten`: keep ours, report any Upstream change as a conflict. */
	kind: "patched" | "rewritten";
	reason: string;
	/** Upstream version the divergence was introduced against. */
	since: string;
}

/** A skill renamed because its Upstream name collides with another discovered skill. */
export interface Rename {
	from: string;
	to: string;
	reason: string;
}

/** Cursor-specific terms scanned for in the output. Patterns are keyed by a human label. */
export interface TermCategory {
	id: string;
	/** Beads ticket (or `unassigned`) that removes these terms. */
	owner: string;
	patterns: Record<string, RegExp>;
}

/** One Adaptation group. Each group lives in its own file so tickets add rules without merge conflicts. */
export interface Group {
	name: string;
	rules?: readonly Rule[];
	exclusions?: readonly Exclusion[];
	forks?: readonly Fork[];
	renames?: readonly Rename[];
	terms?: readonly TermCategory[];
}

export interface Pin {
	repository: string;
	revision: string;
	version: string;
}
